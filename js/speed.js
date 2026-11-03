// js/speed.js — 스피드 퀴즈 두 가지: 모둠 스피드 퀴즈(SPEED_GROUP), 전체 스피드 퀴즈(SPEED_ALL)
//
// 규칙: 설명자 화면에는 단어만, 나머지는 정답 입력창. 정답이면 +1점하고 다음 설명자·다음 단어로, 패스해도 다음 설명자·다음 단어로.
// 진행 기록은 게임용 문서 하나에 모아요:  games/speed_{gameId}_g{모둠}  (전체는  speed_{gameId}_all)
//   { gameId, kind:'speed', key, pointer, round, explainerIdx, score, finished, step, endsAt }
//   - pointer/round : 섞은 단어 목록에서 지금 몇 번째인지 / 몇 바퀴째인지
//   - step          : 정답·패스·건너뛰기가 일어날 때마다 1씩 올라가요. "내가 본 step이 지금과 같을 때만" 처리해서 선착순 1명만 인정해요.
// 점수 요약은 games/summary 한 곳에 increment/arrayUnion으로 쌓아요(읽지 않고 쓰기만 해서 가벼워요).

import { h, mount, randomId } from './core.js';
import { TIMES } from './config.js';
import { WORD_TYPES, TYPE_LABEL, shuffle, isCorrect, judgeModeOf } from './text.js';
import { groupBadge, mascot, toast, confirmDialog, handleError, startCountdown, playSound, field } from './ui.js';
import { approvedItems } from './packs.js';
import { scoreboard } from './results.js';
import * as D from './db.js';
import * as G from './gamecore.js';

const MAX_WORDS = 300;   // 방 문서(1MiB 제한)가 너무 커지지 않게 단어는 최대 300개까지만 써요

/* ═════════ 1. 공용 계산 (모든 화면이 같은 코드를 써서 같은 순서를 만들어요) ═════════ */
export const speedDocId = (gameId, key) => `speed_${gameId}_${key}`;
export const keysOf = (payload) => (payload.groups ? Object.keys(payload.groups).map((g) => `g${g}`) : ['all']);
export const membersOf = (payload, key) => (key === 'all' ? payload.order : payload.groups[key.slice(1)]) || [];

const orderCache = new Map();
function orderOf(payload, key, round) {
  const id = `${payload.seed}|${key}|${round}`;
  if (!orderCache.has(id)) {
    if (orderCache.size > 60) orderCache.clear();
    orderCache.set(id, shuffle(payload.words.map((_, i) => i), id));   // 모둠마다·바퀴마다 시드가 달라요
  }
  return orderCache.get(id);
}
export function currentWord(payload, key, d) {
  const n = payload.words.length;
  return payload.words[orderOf(payload, key, d.round)[d.pointer % n]];
}
export function explainerOf(payload, key, d) {
  const m = membersOf(payload, key);
  return m.length ? m[d.explainerIdx % m.length] : '';
}
/** 정답·패스 처리에 필요한 묶음 */
export function speedCtx(gs, key, d) {
  const p = gs.payload;
  return { gameId: gs.gameId, key, n: p.words.length, memberCount: membersOf(p, key).length, word: currentWord(p, key, d) };
}

/* ═════════ 2. 정답·패스·건너뛰기 (트랜잭션) ═════════ */
function nextFields(d, ctx, ended) {
  if (ended) return { finished: true, step: d.step + 1 };
  let pointer = d.pointer + 1, round = d.round;
  if (pointer >= ctx.n) { pointer = 0; round += 1; }   // 다 썼으면 시드를 바꿔 다시 섞어요
  return { pointer, round, explainerIdx: (d.explainerIdx + 1) % Math.max(1, ctx.memberCount), step: d.step + 1 };
}

/** 정답 처리. 돌려주는 값: 'ok' | 'late'(다른 친구가 먼저) | 'gone' */
export async function speedAnswer(code, ctx, seenStep) {
  const ref = D.gameDoc(code, speedDocId(ctx.gameId, ctx.key));
  const sum = D.gameDoc(code, 'summary');
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (!snap.exists()) return 'gone';
    const d = snap.data();
    if (d.finished || d.step !== seenStep) return 'late';
    tx.update(ref, { ...nextFields(d, ctx, D.now() > d.endsAt), score: d.score + 1 });   // [쓰기]
    const add = ctx.key === 'all'
      ? { total: D.increment(1), solved: D.arrayUnion(ctx.word.w) }
      : { total: D.increment(1), groupScores: { [ctx.key]: D.increment(1) }, solved: { [ctx.key]: D.arrayUnion(ctx.word.w) } };
    tx.set(sum, add, { merge: true });   // [쓰기]
    return 'ok';
  });
}

/** 패스: 점수 없이 다음 설명자·다음 단어로 */
export async function speedPass(code, ctx, seenStep) {
  const ref = D.gameDoc(code, speedDocId(ctx.gameId, ctx.key));
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (!snap.exists()) return 'gone';
    const d = snap.data();
    if (d.finished || d.step !== seenStep) return 'late';
    tx.update(ref, nextFields(d, ctx, D.now() > d.endsAt));   // [쓰기]
    return 'ok';
  });
}

/** 교사: 설명자 건너뛰기(같은 단어, 다음 친구가 설명) */
export async function speedSkip(code, ctx, seenStep) {
  const ref = D.gameDoc(code, speedDocId(ctx.gameId, ctx.key));
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (!snap.exists()) return 'gone';
    const d = snap.data();
    if (d.finished || d.step !== seenStep) return 'late';
    tx.update(ref, { explainerIdx: (d.explainerIdx + 1) % Math.max(1, ctx.memberCount), step: d.step + 1 });   // [쓰기]
    return 'ok';
  });
}

/* ═════════ 3. 학생·발표 화면 ═════════ */
function makeViewFactory(modeKey) {
  const isAll = modeKey === 'speed_all';
  return function createView({ role, code, getMe, getRoom }) {
    const el = h('div', { class: `speed-view ${role}`, dataset: { mode: modeKey } });
    const head = h('div', { class: 'speed-head' });
    const main = h('div', { class: 'speed-main' });
    mount(el, head, main);
    let gs = null, doc = null, docs = {}, unsub = null, stopCd = null, cdKey = '', mainKey = '', busy = false;
    const timerEl = h('strong', { class: 'timer-chip big', dataset: { stat: 'timer' } });

    function myKey() {
      if (isAll) return 'all';
      const me = getMe();
      return me.groupId ? `g${me.groupId}` : null;
    }
    function isPlayer() {
      const key = myKey();
      return !!key && !!gs.payload && membersOf(gs.payload, key).includes(getMe().id);
    }

    function subscribe() {
      if (unsub || !gs) return;
      if (role === 'present') {
        const q = D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'speed'));
        unsub = D.onSnapshot(q, (snap) => { docs = {}; snap.docs.forEach((d) => { docs[d.data().key] = d.data(); }); render(); }, (e) => handleError(e, {}));   // [읽기]
      } else if (isPlayer()) {
        const key = myKey();
        unsub = D.onSnapshot(D.gameDoc(code, speedDocId(gs.gameId, key)), (snap) => { doc = snap.exists() ? snap.data() : null; render(); }, (e) => handleError(e, {}));   // [읽기]
      }
    }

    function syncTimer() {
      const k = `${gs.phase}:${gs.phaseEndsAt}`;
      if (k === cdKey) return;
      cdKey = k;
      if (stopCd) { stopCd(); stopCd = null; }
      if (gs.phase === 'play' && gs.phaseEndsAt) {
        timerEl.hidden = false;
        stopCd = startCountdown(timerEl, gs.phaseEndsAt, { tick: false });
      } else { timerEl.hidden = true; }
    }

    function renderHead(scoreText, badge) {
      const closing = gs.phase === 'closing';
      mount(head, badge, h('strong', { class: 'speed-score', dataset: { stat: 'score' } }, scoreText),
        closing ? h('span', { class: 'chip warn', dataset: { stat: 'closing' } }, '마무리 중 · 지금 단어까지만!') : null, timerEl);
    }

    function render() {
      if (!gs) return;
      syncTimer();
      if (role === 'present') return renderPresent();
      const key = myKey();
      if (!isPlayer()) {
        renderHead('', key && !isAll ? groupBadge(getMe().groupId) : h('span'));
        mount(main, h('div', { class: 'center-col' }, mascot(80, 'smile'),
          h('h3', null, isAll ? '이번 게임은 구경만 해요' : (key ? '우리 모둠은 3명 미만이라 이번 게임에는 참여하지 못해요' : '모둠을 고르지 않아서 이번 게임에는 참여하지 못해요')),
          h('p', { class: 'muted' }, '게임이 끝나면 결과를 함께 볼 수 있어요.')));
        mainKey = 'spectator';
        return;
      }
      const badge = isAll ? h('span', { class: 'gbadge none' }, '우리 반') : groupBadge(getMe().groupId);
      if (!doc) { renderHead('', badge); mount(main, h('p', { class: 'muted center' }, '불러오는 중이에요…')); mainKey = 'loading'; return; }
      renderHead(`${doc.score}점`, badge);
      const me = getMe();
      const members = membersOf(gs.payload, key);
      const eid = explainerOf(gs.payload, key, doc);
      const mk = `${doc.step}:${doc.finished}:${eid === me.id}`;
      if (mk === mainKey) return;   // 같은 상태면 입력칸을 건드리지 않아요(쓰던 글자가 지워지지 않게)
      mainKey = mk;
      if (doc.finished) {
        mount(main, h('div', { class: 'center-col speed-done' }, mascot(96, 'wow'), h('h2', null, '마무리됐어요!'), h('p', { class: 'muted' }, '다른 모둠이 끝나면 결과가 나와요.')));
        return;
      }
      if (eid === me.id) renderExplainer(key); else renderAnswerer(key, eid, members);
    }

    function renderExplainer(key) {
      const word = currentWord(gs.payload, key, doc);
      const seen = doc.step;
      const pass = h('button', { class: 'btn big ghost', type: 'button', dataset: { act: 'pass' } }, '패스');
      pass.onclick = async () => {
        if (busy) return;
        busy = true; pass.disabled = true;
        try { const r = await speedPass(code, speedCtx(gs, key, doc), seen); if (r === 'late') toast('이미 넘어갔어요.', 'info'); }   // [읽기][쓰기]
        catch (e) { handleError(e, {}); }
        setTimeout(() => { busy = false; pass.disabled = false; }, TIMES.passCooldownMs);   // 연타 방지 2초
      };
      mount(main, h('div', { class: 'speed-explainer' },
        h('p', { class: 'speed-role' }, '🗣️ 내가 설명자예요! 말과 몸짓으로 설명해요'),
        h('div', { class: 'speed-word', dataset: { stat: 'word' } }, word.w),
        h('span', { class: 'chip' }, TYPE_LABEL[word.t] || word.t),
        h('p', { class: 'muted' }, '정답 글자를 그대로 말하면 안 돼요. 어렵다면 패스!'), pass));
    }

    function renderAnswerer(key, eid, members) {
      const word = currentWord(gs.payload, key, doc);
      const seen = doc.step;
      const input = h('input', { class: 'speed-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: false, enterKeyHint: 'done', placeholder: '정답을 입력하세요', dataset: { field: 'answer' } });
      const msg = h('p', { class: 'speed-msg', 'aria-live': 'polite' });
      const form = h('form', { class: 'speed-answer' }, input, h('button', { class: 'btn primary big', type: 'submit', dataset: { act: 'answer' } }, '정답!'));
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        if (busy) return;
        const text = input.value.trim();
        if (!text) return;
        const threshold = (getRoom() && getRoom().settings && getRoom().settings.similarityThreshold) || 0.85;
        if (!isCorrect(text, word.w, judgeModeOf(word.t), threshold)) {
          playSound('wrong');
          input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
          msg.textContent = '아쉬워요, 다시 생각해 봐요!';
          input.select();
          return;
        }
        busy = true;
        try {
          const r = await speedAnswer(code, speedCtx(gs, key, doc), seen);   // [읽기][쓰기]
          if (r === 'ok') { playSound('correct'); toast('정답! +1점 🎉', 'ok'); }
          else { msg.textContent = '다른 친구가 먼저 맞혔어요!'; toast('다른 친구가 먼저 맞혔어요!', 'info'); }
        } catch (e) { handleError(e, {}); }
        busy = false;
      };
      mount(main, h('div', { class: 'speed-answerer' },
        h('p', { class: 'speed-role' }, `👂 설명자: ${gs.payload.names[eid] || '친구'}`),
        h('div', { class: 'speed-ask' }, '설명을 듣고 정답을 입력하세요'), form, msg,
        h('p', { class: 'muted' }, `우리 ${isAll ? '반' : '모둠'} ${members.length}명이 차례로 설명해요`)));
      setTimeout(() => { try { input.focus(); } catch { /* 무시 */ } }, 50);
    }

    function renderPresent() {
      const p = gs.payload;
      const keys = keysOf(p);
      mount(head, h('h2', null, isAll ? '⚡ 전체 스피드 퀴즈' : '⚡ 모둠 스피드 퀴즈'),
        gs.phase === 'closing' ? h('span', { class: 'chip warn' }, '마무리 중') : null, timerEl);
      if (isAll) {
        const d = docs.all;
        mount(main, h('div', { class: 'center-col' },
          h('div', { class: 'total-big' }, h('span', null, '우리 반 점수'), h('strong', { dataset: { stat: 'total' } }, `${d ? d.score : 0}점`)),
          d && !d.finished ? h('h2', { class: 'speed-now' }, `🗣️ 지금 설명하는 친구: ${p.names[explainerOf(p, 'all', d)] || ''}`) : h('h2', null, d ? '마무리됐어요!' : '')));
        return;
      }
      const entries = keys.map((k) => ({ g: Number(k.slice(1)), score: docs[k] ? docs[k].score : 0 })).sort((a, b) => b.score - a.score || a.g - b.g);
      const who = h('div', { class: 'speed-who' }, keys.map((k) => {
        const d = docs[k];
        return h('div', { class: 'speed-who-row' }, groupBadge(Number(k.slice(1)), { compact: true }),
          d ? (d.finished ? '마무리됨' : `🗣️ ${p.names[explainerOf(p, k, d)] || ''}`) : '…');
      }));
      mount(main, scoreboard(entries, { title: '' }), who);
    }

    return {
      el,
      update(next) {
        const first = !gs || gs.gameId !== next.gameId;
        gs = next;
        if (first) { mainKey = ''; cdKey = ''; }
        subscribe();
        render();
      },
      destroy() { if (unsub) unsub(); if (stopCd) stopCd(); unsub = null; }
    };
  };
}

/* ═════════ 4. 교사: 진행자(드라이버) ═════════ */
function makeDriverFactory(modeKey) {
  const isAll = modeKey === 'speed_all';
  return function createDriver(host) {
    const code = host.code;
    let docs = {}, sub = null, bodyEl = null, finishing = false;

    const keys = () => keysOf(host.gs.payload);
    function allDone() { const ks = keys(); return ks.every((k) => docs[k] && docs[k].finished); }

    function onDocs(snap) {
      snap.docs.forEach((d) => { docs[d.data().key] = d.data(); host.track(d.id); });
      if (!isAll) host.setScores(Object.fromEntries(Object.entries(docs).map(([k, d]) => [k, d.score])));
      const T = host.T;
      if (T.test && T.test.onSpeedDocs) T.test.onSpeedDocs(docs, host.gs, host);
      if (host.gs.phase === 'closing' && allDone()) finishAll();
      draw();
    }

    async function finishAll() {
      if (finishing) return;
      finishing = true;
      try {
        const snap = await D.getDoc(D.gameDoc(code, 'summary'));   // [읽기]
        const s = snap.exists() ? snap.data() : {};
        const ks = keys();
        const summary = isAll
          ? { mode: 'speed_all', total: s.total || 0, solved: s.solved || [] }
          : {
            mode: 'speed_group', groups: ks.map((k) => Number(k.slice(1))),
            groupScores: Object.fromEntries(ks.map((k) => [k, (s.groupScores && s.groupScores[k]) || 0])),
            solved: Object.fromEntries(ks.map((k) => [k, (s.solved && s.solved[k]) || []])), total: s.total || 0
          };
        const ok = await host.finish(summary);
        if (!ok) finishing = false;
      } catch (e) { finishing = false; handleError(e, { teacher: true }); }
    }

    async function skip(key) {
      const d = docs[key];
      if (!d) return;
      try { const r = await speedSkip(code, speedCtx(host.gs, key, d), d.step); if (r !== 'ok') toast('방금 바뀌었어요. 다시 눌러 주세요.', 'info'); }   // [읽기][쓰기]
      catch (e) { handleError(e, { teacher: true }); }
    }
    async function forceFinish() {
      const ok = await confirmDialog({ title: '결과를 볼까요?', message: '지금 바로 게임을 마치고 점수를 보여 줘요.', okText: '결과 보기' });
      if (ok) finishAll();
    }

    function draw() {
      if (!bodyEl || !bodyEl.isConnected) return;
      const gs = host.gs, p = gs.payload;
      const rows = keys().map((key) => {
        const d = docs[key];
        const label = key === 'all' ? h('strong', null, '우리 반') : groupBadge(Number(key.slice(1)));
        if (!d) return h('div', { class: 'speed-row' }, label, h('span', { class: 'muted' }, '준비 중…'));
        const eid = explainerOf(p, key, d);
        return h('div', { class: 'speed-row', dataset: { key } }, label,
          h('strong', { class: 'speed-score', dataset: { stat: `score-${key}` } }, `${d.score}점`),
          d.finished ? h('span', { class: 'chip ok', dataset: { stat: `done-${key}` } }, '마무리됨')
            : h('span', null, `설명자 ${p.names[eid] || '?'} · `, h('span', { class: 'muted', dataset: { stat: `word-${key}` } }, `단어 “${currentWord(p, key, d).w}”`)),
          d.finished ? null : h('button', { class: 'btn small ghost', type: 'button', dataset: { act: 'skip', key }, onclick: () => skip(key) }, '설명자 건너뛰기'));
      });
      const total = Object.values(docs).reduce((a, d) => a + (d.score || 0), 0);
      mount(bodyEl, h('div', { class: 'speed-ctl' }, ...rows,
        h('div', { class: 'row-between' },
          h('span', { class: 'muted' }, gs.phase === 'closing' ? '시간이 끝났어요. 모두 마무리되면 결과가 나와요.' : `전체 ${total}점 · 시간이 끝나면 지금 단어까지만 마쳐요.`),
          h('button', { class: 'btn small primary', type: 'button', dataset: { act: 'finish' }, onclick: forceFinish }, '결과 보기'))));
    }

    return {
      onState(gs) {
        if (gs.phase === 'final') { if (sub) sub(); sub = null; return; }   // 끝났으니 더 이상 듣지 않아요
        if (!sub) {
          const q = D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'speed'));
          sub = host.watch(q, onDocs, 'game');
        }
        if (gs.phase === 'play' && gs.phaseEndsAt) host.at('end', gs.phaseEndsAt, () => { host.go({ phase: 'closing', phaseEndsAt: null }); });
        if (gs.phase === 'closing' && allDone()) finishAll();
      },
      renderControl(body) { bodyEl = body; draw(); },
      dispose() { if (sub) sub(); sub = null; bodyEl = null; }
    };
  };
}

/* ═════════ 5. 교사: 시작 준비 ═════════ */
function makeDef(modeKey) {
  const isAll = modeKey === 'speed_all';
  return {
    key: modeKey, mode: modeKey, scope: isAll ? 'all' : 'group', icon: isAll ? '🙋' : '⚡',
    label: isAll ? '전체 스피드 퀴즈' : '모둠 스피드 퀴즈',
    desc: isAll ? '반 전체에서 한 명씩 돌아가며 설명해요. 맞히면 우리 반 +1점' : '모둠끼리 동시에 설명하고 맞혀요. 모둠 점수 경쟁',

    renderForm(box, T, prev) {
      const base = prev || { minutes: T.room.settings.speedTotalMinutes || 5, types: WORD_TYPES };
      const minutes = h('select', { dataset: { field: 'minutes' } }, [1, 2, 3, 5, 7, 10, 15, 20].map((m) => h('option', { value: String(m), selected: m === base.minutes }, `${m}분`)));
      const boxes = WORD_TYPES.map((t) => ({ t, cb: h('input', { type: 'checkbox', checked: base.types.includes(t), dataset: { type: t } }) }));
      mount(box,
        field('게임 시간', minutes, '시간이 지나면 모두 지금 단어까지만 마치고 끝나요.'),
        field('나올 말', h('div', { class: 'chips' }, boxes.map((b) => h('label', { class: 'chip-check' }, b.cb, ` ${TYPE_LABEL[b.t]}`)))));
      return { read: () => ({ minutes: Number(minutes.value), types: boxes.filter((b) => b.cb.checked).map((b) => b.t) }) };
    },

    async prepare(T, opts, { participants, plan, useGroups }) {
      const list = await T.data.ensure('words');   // 처음 한 번만 읽어요
      const all = approvedItems('words', list).filter((w) => opts.types.includes(w.type));
      if (all.length < 3) return { error: `승인된 말이 3개 이상 필요해요. (선택한 종류는 지금 ${all.length}개)` };
      if (isAll && participants.length < 2) return { error: '참가자가 2명 이상이어야 해요.' };
      const words = shuffle(all).slice(0, MAX_WORDS).map((w) => ({ id: w.id, w: w.word, t: w.type }));
      const notes = [];
      if (all.length > MAX_WORDS) notes.push(`말이 ${all.length}개라서 무작위로 ${MAX_WORDS}개만 써요.`);
      if (!isAll) {
        if (plan.small.length) notes.push(`${plan.small.join(', ')}모둠은 3명 미만이라 참여하지 못해요.`);
        if (plan.noGroup.length) notes.push(`모둠을 고르지 않은 ${plan.noGroup.length}명은 제외돼요.`);
      }
      const pset = new Set(participants);
      const order = isAll ? G.sortByJoin(T.students.filter((s) => pset.has(s.id))).map((s) => s.id) : null;   // 설명 순서 = 접속 순서
      const ms = opts.minutes * 60000;
      const prepared = {
        phase: 'play', round: 0, phaseEndsAt: D.now() + ms, notes,
        payload: { words, seed: randomId(6), minutes: opts.minutes, order },
        settingsPatch: { speedTotalMinutes: opts.minutes }
      };
      prepared.setup = async (gameId) => {
        const endsAt = D.now() + ms;   // 시작 직전에 다시 계산해요(확인창을 오래 보고 있었어도 시간이 정확하게)
        prepared.phaseEndsAt = endsAt;
        const ks = isAll ? ['all'] : useGroups.map((g) => `g${g}`);
        await D.batchEach(ks, (b, key) => b.set(D.gameDoc(T.code, speedDocId(gameId, key)), { gameId, kind: 'speed', key, pointer: 0, round: 0, explainerIdx: 0, score: 0, finished: false, step: 0, endsAt }));   // [쓰기]
        await D.setDoc(D.gameDoc(T.code, 'summary'), isAll   // [쓰기] 이전 게임의 점수가 섞이지 않게 새로 덮어써요
          ? { gameId, kind: 'summary', mode: modeKey, total: 0, solved: [] }
          : { gameId, kind: 'summary', mode: modeKey, total: 0, groupScores: Object.fromEntries(ks.map((k) => [k, 0])), solved: Object.fromEntries(ks.map((k) => [k, []])) });
      };
      return prepared;
    },

    createDriver: makeDriverFactory(modeKey),
    createView: makeViewFactory(modeKey)
  };
}

export const SPEED_GROUP = makeDef('speed_group');
export const SPEED_ALL = makeDef('speed_all');
