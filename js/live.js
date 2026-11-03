// js/live.js — 라이브 퀴즈 (전체 수업 모드 + 카드 뽑기 투표)
//
// 흐름:  answering(답 쓰기) → reveal(정답 공개) → vote(카드 투표, 선택) → result(카드 공개·점수) → [다음 문제] → … → final
// 문제와 보기는 교사 화면이 한 번에 만들어 gameState.payload에 넣어 두고, 모든 학생이 똑같이 봐요.
// 진행 기록(임시 문서):
//   games/live_{gameId}_{문항}_{학생ID}   학생의 응답 { ok, skipped }   ← 학생이 직접 써요(문서 ID가 정해져 있어서 문항당 1개)
//   games/vote_{gameId}_{문항}_{학생ID}   카드 투표 { pick: 0~3 | -1(뽑지 않기) }
//   games/livecards                      교사 전용: 이번 문항의 카드 배치(투표가 끝나기 전에는 학생에게 보이지 않아요)
// 점수는 반 전체 점수 하나예요(음수도 가능). 기본 점수 = 맞힌 학생 수.

import { h, mount, sessionGet, sessionSet } from './core.js';
import { TIMES } from './config.js';
import { shuffle } from './text.js';
import { gradeAnswer, generateLiveQuiz, QTYPE_LABEL } from './quizgen.js';
import { approvedItems } from './packs.js';
import { toast, handleError, startCountdown, playSound, field, safeImg } from './ui.js';
import * as D from './db.js';

export const EFFECTS = {
  x2: { label: '점수 2배', icon: '✨' }, void: { label: '점수 무효', icon: '🚫' },
  p10: { label: '+10점', icon: '🎁' }, m10: { label: '-10점', icon: '💣' }, none: { label: '뽑지 않음', icon: '🙅' }
};
export function effectDelta(effect, base) {
  if (effect === 'x2') return base * 2;
  if (effect === 'void') return 0;
  if (effect === 'p10') return base + 10;
  if (effect === 'm10') return base - 10;
  return base;
}
export const liveDocId = (gameId, qi, sid) => `live_${gameId}_${qi}_${sid}`;
export const voteDocId = (gameId, qi, sid) => `vote_${gameId}_${qi}_${sid}`;
const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;

/* ═════════ 1. 학생·발표 화면 ═════════ */
function createView({ role, code, getMe, getRoom }) {
  const el = h('div', { class: `live-view ${role}` });
  const head = h('div', { class: 'live-head' });
  const main = h('div', { class: 'live-main' });
  mount(el, head, main);
  const timerEl = h('strong', { class: 'timer-chip big', dataset: { stat: 'timer' } });
  let gs = null, stopCd = null, cdKey = '', renderKey = '', busy = false, unsubResp = null, respKey = '', countsEl = null, mine = {}, loadedFor = '';
  const storeKey = () => `malrang_live_${gs.gameId}`;

  const qOf = () => gs.payload.questions[gs.round - 1];
  const ps = () => gs.payload.participants;
  const resultOf = () => (gs.payload.results && gs.payload.results[`q${gs.round - 1}`]) || null;

  function loadMine() {
    if (loadedFor === gs.gameId) return;
    loadedFor = gs.gameId;
    try { mine = JSON.parse(sessionGet(storeKey()) || '{}'); } catch { mine = {}; }
  }
  function saveMine() { sessionSet(storeKey(), JSON.stringify(mine)); }

  function syncTimer(onZero) {
    const k = `${gs.phase}:${gs.round}:${gs.phaseEndsAt}`;
    if (k === cdKey) return;
    cdKey = k;
    if (stopCd) { stopCd(); stopCd = null; }
    timerEl.hidden = !gs.phaseEndsAt;
    if (gs.phaseEndsAt) stopCd = startCountdown(timerEl, gs.phaseEndsAt, { tick: role === 'student', onZero });
  }

  function renderHead() {
    mount(head, h('span', { class: 'chip', dataset: { stat: 'qno' } }, `문제 ${gs.round} / ${gs.payload.questions.length}`),
      h('span', { class: 'chip ok', dataset: { stat: 'class-score' } }, `우리 반 ${gs.payload.score || 0}점`), timerEl);
  }

  /* 문제 그림 + 글 */
  function questionBlock(q, onImgFail) {
    return h('div', { class: 'live-q' },
      q.qtype && QTYPE_LABEL[q.qtype] ? h('span', { class: 'chip' }, QTYPE_LABEL[q.qtype]) : null,
      q.imageUrl ? safeImg(q.imageUrl, '문제 그림', 'live-img', onImgFail) : null,
      q.prompt ? h('div', { class: 'live-prompt', dataset: { stat: 'prompt' } }, q.prompt) : null);
  }

  /* ── 답 쓰기 ── */
  function renderAnswering() {
    const q = qOf();
    const qi = gs.round - 1;
    const me = getMe();
    const interactive = role === 'student';
    let input = null;
    const status = h('p', { class: 'live-status', 'aria-live': 'polite', dataset: { stat: 'status' } });
    const failBtn = h('button', { class: 'btn small ghost', type: 'button', hidden: true, dataset: { act: 'img-fail' }, onclick: () => submit(null, true) }, '그림이 안 보여요');
    const box = h('div', { class: 'live-box' }, questionBlock(q, () => { failBtn.hidden = false; }));

    function lock(info) {
      box.querySelectorAll('button.choice, form.live-short button, form.live-short input').forEach((b) => { b.disabled = true; });
      failBtn.hidden = true;
      status.textContent = info;
    }
    async function submit(response, skipped) {
      if (!interactive || busy || mine[qi]) return;
      if (D.now() > gs.phaseEndsAt + TIMES.liveGraceMs - 600) { status.textContent = '시간이 끝났어요.'; return; }
      busy = true;
      const ok = skipped ? false : gradeAnswer(q, response, (getRoom() && getRoom().settings && getRoom().settings.similarityThreshold) || 0.85);
      try {
        await D.setDoc(D.gameDoc(code, liveDocId(gs.gameId, qi, me.id)), { gameId: gs.gameId, kind: 'live', qi, sid: me.id, ok, skipped: !!skipped });   // [쓰기]
        mine[qi] = { ok, skipped: !!skipped }; saveMine();
        lock('제출했어요! ✅ 결과를 기다려요');
      } catch (e) { handleError(e, {}); }
      busy = false;
    }

    if (q.fmt === 'mc') {
      box.append(h('div', { class: 'choices' }, q.choices.map((c, i) => h('button', {
        class: 'choice', type: 'button', disabled: !interactive, dataset: { idx: String(i) },
        onclick: (ev) => { ev.currentTarget.classList.add('picked'); submit(i, false); }
      }, `${i + 1}. ${c}`))));
    } else if (interactive) {
      input = h('input', { class: 'speed-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: false, placeholder: '정답을 입력하세요', dataset: { field: 'live-answer' } });
      const form = h('form', { class: 'speed-answer live-short' }, input, h('button', { class: 'btn primary big', type: 'submit', dataset: { act: 'live-submit' } }, '제출'));
      form.onsubmit = (ev) => { ev.preventDefault(); if (input.value.trim()) submit(input.value.trim(), false); };
      box.append(form, h('p', { class: 'muted' }, '시간이 끝나면 쓰고 있던 답이 자동으로 제출돼요.'));
    } else {
      box.append(h('p', { class: 'muted center' }, '정답을 직접 써서 내는 문제예요'));
    }
    box.append(status);
    if (interactive) box.append(failBtn);
    countsEl = role === 'present' ? h('p', { class: 'live-counts', dataset: { stat: 'counts' } }, '') : null;
    if (countsEl) box.append(countsEl);
    mount(main, box);

    if (mine[qi]) lock('제출했어요! ✅ 결과를 기다려요');
    syncTimer(() => { if (interactive && input && !mine[qi] && input.value.trim()) submit(input.value.trim(), false); });   // 시간이 끝나면 쓰던 답을 자동 제출
    if (role === 'present') subscribeCounts();
  }

  function subscribeCounts() {
    const k = `${gs.gameId}:${gs.round}`;
    if (respKey === k) return;
    stopCounts();
    respKey = k;
    const q = D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'live'), D.where('qi', '==', gs.round - 1));
    unsubResp = D.onSnapshot(q, (snap) => {   // [읽기] 문항당 참가자 수만큼
      const set = new Set(ps());
      const rows = snap.docs.map((d) => d.data()).filter((r) => set.has(r.sid));
      if (countsEl) countsEl.textContent = `제출 ${rows.length} / ${ps().length}명 · 맞힌 친구 ${rows.filter((r) => r.ok).length}명`;
    }, (e) => handleError(e, {}));
  }
  function stopCounts() { if (unsubResp) { unsubResp(); unsubResp = null; } respKey = ''; }

  /* ── 정답 공개 ── */
  function renderReveal() {
    const q = qOf(), r = resultOf() || { correct: 0 };
    const my = mine[gs.round - 1];
    mount(main, h('div', { class: 'live-box reveal' },
      questionBlock(q),
      h('div', { class: 'live-answer', dataset: { stat: 'answer' } }, `정답: ${q.label}`),
      h('div', { class: 'total-big' }, h('span', null, '맞힌 친구'), h('strong', { dataset: { stat: 'correct' } }, `${r.correct}명`)),
      role === 'student' ? h('p', { class: `live-mine ${my && my.ok ? 'ok' : 'bad'}`, dataset: { stat: 'mine' } },
        my ? (my.ok ? '🎉 맞혔어요!' : (my.skipped ? '그림이 안 보여서 넘겼어요' : '아쉬워요, 다음엔 맞혀 봐요!')) : '제출하지 못했어요') : null));
    if (role === 'student') playSound(my && my.ok ? 'correct' : 'wrong');
    syncTimer();
  }

  /* ── 카드 투표 ── */
  function renderVote() {
    const qi = gs.round - 1, me = getMe();
    const interactive = role === 'student';
    const msg = h('p', { class: 'live-status', dataset: { stat: 'vote-status' } }, interactive ? '카드를 뽑을지 함께 정해요! 가장 많이 고른 쪽이 선택돼요.' : '카드를 뽑을까요? 태블릿에서 투표해요!');
    const cards = [0, 1, 2, 3].map((i) => h('button', { class: 'vcard', type: 'button', disabled: !interactive, dataset: { pos: String(i) }, onclick: () => vote(i) },
      h('span', { class: 'vc-back' }, '🎴'), h('strong', null, String(i + 1))));
    const skip = h('button', { class: 'btn ghost vote-skip', type: 'button', disabled: !interactive, dataset: { pos: '-1' }, onclick: () => vote(-1) }, '뽑지 않기');
    function mark(pick) {
      cards.forEach((c, i) => c.classList.toggle('picked', pick === i));
      skip.classList.toggle('picked', pick === -1);
    }
    async function vote(pick) {
      if (!interactive) return;
      mark(pick);
      try {
        await D.setDoc(D.gameDoc(code, voteDocId(gs.gameId, qi, me.id)), { gameId: gs.gameId, kind: 'vote', qi, sid: me.id, pick });   // [쓰기] 바꾸면 덮어써요
        mine[`v${qi}`] = pick; saveMine();
        msg.textContent = '투표했어요! 시간 안에는 바꿀 수 있어요.';
      } catch (e) { handleError(e, {}); }
    }
    mount(main, h('div', { class: 'live-box' }, h('h2', null, '🎴 카드를 뽑을까요?'), msg, h('div', { class: 'vcards' }, cards), skip));
    if (mine[`v${qi}`] !== undefined) mark(mine[`v${qi}`]);
    syncTimer();
  }

  /* ── 결과: 카드 공개 + 점수 ── */
  function renderResult() {
    const p = gs.payload, r = resultOf() || { correct: 0, delta: 0, effect: 'none' };
    const cards = p.cardVote && p.cards ? p.cards : null;
    const row = cards ? h('div', { class: 'vcards' }, cards.map((c, i) => h('div', { class: `vcard flip ${r.pick === i ? 'picked' : ''}`, dataset: { pos: String(i), effect: c } },
      h('div', { class: 'vc-inner' }, h('div', { class: 'vc-face front' }, h('span', { class: 'vc-back' }, '🎴'), h('strong', null, String(i + 1))),
        h('div', { class: 'vc-face back' }, h('span', { class: 'vc-icon' }, EFFECTS[c].icon), h('span', null, EFFECTS[c].label), h('small', null, `${(r.tally && r.tally[i]) || 0}표`)))))) : null;
    mount(main, h('div', { class: 'live-box result' },
      h('div', { class: 'live-answer', dataset: { stat: 'answer' } }, `정답: ${qOf().label}`),
      row,
      cards && r.tally ? h('p', { class: 'muted' }, `뽑지 않기 ${r.tally[4] || 0}표 · `, r.pick >= 0 && r.pick <= 3 ? `${r.pick + 1}번 카드가 뽑혔어요!` : '카드를 뽑지 않았어요') : null,
      h('div', { class: 'live-score-line', dataset: { stat: 'delta' } }, `맞힌 ${r.correct}명 → 기본 ${r.correct}점`, cards ? ` · ${EFFECTS[r.effect || 'none'].label}` : '', h('strong', null, ` = ${signed(r.delta)}점`)),
      h('div', { class: 'total-big' }, h('span', null, '우리 반 점수'), h('strong', { dataset: { stat: 'total' } }, `${p.score || 0}점`))));
    requestAnimationFrame(() => setTimeout(() => main.querySelectorAll('.vcard.flip').forEach((c, i) => setTimeout(() => c.classList.add('flipped'), i * 220)), 60));
    if (role === 'student') playSound(r.delta > 0 ? 'correct' : r.delta < 0 ? 'wrong' : 'tick');
    syncTimer();
  }

  function render() {
    renderHead();
    const key = `${gs.phase}:${gs.round}`;
    if (key === renderKey) return;
    renderKey = key;
    if (gs.phase !== 'answering') stopCounts();
    if (gs.phase === 'answering') renderAnswering();
    else if (gs.phase === 'reveal') renderReveal();
    else if (gs.phase === 'vote') renderVote();
    else if (gs.phase === 'result') renderResult();
  }

  return {
    el,
    update(next) {
      if (!gs || gs.gameId !== next.gameId) { renderKey = ''; cdKey = ''; loadedFor = ''; }
      gs = next;
      loadMine();
      render();
    },
    destroy() { stopCounts(); if (stopCd) stopCd(); }
  };
}

/* ═════════ 2. 교사 진행자 ═════════ */
function createDriver(host) {
  const code = host.code;
  let resp = {}, votes = {}, layout = null, advancing = false, bodyEl = null;
  const P = () => host.gs.payload;
  const qi = () => host.gs.round - 1;
  const partSet = () => new Set(P().participants);
  const myResp = () => Object.values(resp).filter((r) => partSet().has(r.sid));
  const myVotes = () => Object.values(votes).filter((r) => partSet().has(r.sid));

  async function step(patch, pre) {
    if (advancing) return;
    advancing = true;
    try {
      if (pre) await pre();
      const ok = await host.go(patch);
      if (!ok) advancing = false;
    } catch (e) { advancing = false; handleError(e, { teacher: true }); }
  }

  /* 답 쓰기가 끝났어요 → 정답 공개 */
  function endAnswering() {
    const rows = myResp();
    const r = { correct: rows.filter((x) => x.ok).length, answered: rows.length };
    const needCards = P().cardVote;
    step({ phase: 'reveal', phaseEndsAt: host.now() + TIMES.liveRevealSec * 1000, [`payload.results.q${qi()}`]: r }, async () => {
      if (needCards) {
        layout = shuffle(['x2', 'void', 'p10', 'm10']);   // 카드 위치는 문제마다 무작위
        await D.setDoc(D.gameDoc(code, 'livecards'), { gameId: host.gs.gameId, kind: 'livecards', qi: qi(), layout });   // [쓰기] 학생은 읽지 않아요
        host.track('livecards');
      }
    });
  }

  function afterReveal() {
    if (P().cardVote) step({ phase: 'vote', phaseEndsAt: host.now() + TIMES.liveVoteSec * 1000 });
    else finishQuestion('none', -1, null);
  }

  async function endVote() {
    if (!layout) {   // 교사 창을 새로 열었다면 카드 배치를 다시 읽어요
      const snap = await D.getDoc(D.gameDoc(code, 'livecards'));   // [읽기]
      layout = snap.exists() ? snap.data().layout : shuffle(['x2', 'void', 'p10', 'm10']);
    }
    const tally = [0, 0, 0, 0, 0];   // 카드 1~4, 뽑지 않기
    myVotes().forEach((v) => { if (v.pick >= 0 && v.pick <= 3) tally[v.pick]++; else if (v.pick === -1) tally[4]++; });
    const max = Math.max(...tally);
    let pick = 4;   // 유효표가 없으면 뽑지 않기
    if (max > 0) { const top = tally.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0); pick = top[Math.floor(Math.random() * top.length)]; }   // 동점은 무작위
    finishQuestion(pick === 4 ? 'none' : layout[pick], pick === 4 ? -1 : pick, tally);
  }

  function finishQuestion(effect, pick, tally) {
    const r = (P().results && P().results[`q${qi()}`]) || { correct: 0, answered: 0 };
    const delta = effectDelta(effect, r.correct);
    const patch = {
      phase: 'result', phaseEndsAt: null,
      [`payload.results.q${qi()}`]: { ...r, effect, delta, pick, tally: tally || null },
      'payload.score': (P().score || 0) + delta
    };
    if (P().cardVote && layout) patch['payload.cards'] = layout;   // 카드 배치는 이때 처음 공개돼요
    step(patch);
  }

  function nextQuestion() {
    if (qi() + 1 >= P().questions.length) {
      const results = P().questions.map((q, i) => {
        const r = (P().results && P().results[`q${i}`]) || {};
        return { prompt: q.prompt, label: q.label, correct: r.correct || 0, total: P().participants.length, effect: P().cardVote ? EFFECTS[r.effect || 'none'].label : '카드 없음', delta: r.delta || 0 };
      });
      step({ phase: 'final', phaseEndsAt: null, finalSummary: { mode: 'live', total: P().score || 0, results } });
    } else {
      layout = null;
      step({ phase: 'answering', round: host.gs.round + 1, phaseEndsAt: host.now() + P().timeLimit * 1000, 'payload.cards': null });   // 이전 문제의 카드 배치를 지워요
    }
  }

  function draw() {
    if (!bodyEl || !bodyEl.isConnected) return;
    const gs = host.gs, p = gs.payload, q = p.questions[qi()];
    if (!q) return;
    const r = (p.results && p.results[`q${qi()}`]) || null;
    const info = [];
    if (gs.phase === 'answering') {
      const rows = myResp();
      info.push(h('p', null, `제출 ${rows.length} / ${p.participants.length}명 · 맞힌 친구 ${rows.filter((x) => x.ok).length}명`, ' '),
        h('button', { class: 'btn small ghost', type: 'button', dataset: { act: 'close-now' }, onclick: () => endAnswering() }, '지금 마감'));
    } else if (gs.phase === 'reveal') info.push(h('p', null, `정답 공개 중 · 맞힌 친구 ${r ? r.correct : 0}명`));
    else if (gs.phase === 'vote') info.push(h('p', null, `카드 투표 중 · 투표 ${myVotes().length} / ${p.participants.length}명`));
    else if (gs.phase === 'result') {
      const last = qi() + 1 >= p.questions.length;
      info.push(h('p', null, `이번 문제 ${signed(r ? r.delta : 0)}점 (${r && p.cardVote ? EFFECTS[r.effect || 'none'].label : '카드 없음'})`),
        h('button', { class: 'btn primary', type: 'button', dataset: { act: 'next' }, onclick: nextQuestion }, last ? '결과 보기' : '다음 문제'));
    }
    mount(bodyEl, h('div', { class: 'live-ctl' },
      h('div', null, h('strong', null, `문제 ${gs.round}/${p.questions.length}`), ' · ', h('span', { class: 'muted' }, q.prompt || '(그림 문제)'), ' → ', h('strong', { dataset: { stat: 'ctl-answer' } }, q.label)),
      h('div', { class: 'row-between' }, h('strong', { dataset: { stat: 'ctl-score' } }, `우리 반 ${p.score || 0}점`), h('div', { class: 'chips' }, info))));
  }

  return {
    onState(gs) {
      advancing = false;
      resp = {}; votes = {};
      if (gs.phase === 'answering') {
        const q = D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'live'), D.where('qi', '==', qi()));
        host.watch(q, (snap) => {   // [읽기] 문항당 참가자 수만큼
          snap.docs.forEach((d) => { resp[d.data().sid] = d.data(); host.track(d.id); });
          if (myResp().length >= P().participants.length) endAnswering();   // 전원 제출 → 바로 마감
          draw();
        }, 'state');
        host.at('close', gs.phaseEndsAt + TIMES.liveGraceMs, endAnswering);   // 마감 뒤 1.5초 기다려 전송 중인 응답까지 세요
      } else if (gs.phase === 'reveal') {
        host.at('next', gs.phaseEndsAt, afterReveal);
      } else if (gs.phase === 'vote') {
        const q = D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'vote'), D.where('qi', '==', qi()));
        host.watch(q, (snap) => {   // [읽기] 투표 수만큼
          votes = {};
          snap.docs.forEach((d) => { votes[d.data().sid] = d.data(); host.track(d.id); });
          if (myVotes().length >= P().participants.length) endVote();
          draw();
        }, 'state');
        host.at('close', gs.phaseEndsAt + TIMES.liveGraceMs, endVote);
      }
      draw();
    },
    renderControl(body) { bodyEl = body; draw(); },
    dispose() { bodyEl = null; }
  };
}

/* ═════════ 3. 교사: 시작 준비 ═════════ */
export const LIVE = {
  key: 'live', mode: 'live', scope: 'all', icon: '🎬', label: '라이브 퀴즈',
  desc: '모두에게 같은 문제를 내요. 맞힌 친구 수만큼 우리 반 점수! 카드 뽑기 투표도 있어요',

  renderForm(box, T, prev) {
    const s = T.room.settings;
    const b = prev || { fmt: s.liveFormat || 'mc', qtype: s.liveQuizType || 'mixed', source: s.liveSource || 'words', time: s.liveTimeLimit || 20, count: s.liveQuestionCount || 10, cardVote: s.cardVoteEnabled !== false };
    const sel = (name, opts, val) => h('select', { dataset: { field: name } }, opts.map(([v, l]) => h('option', { value: String(v), selected: String(v) === String(val) }, l)));
    const fmt = sel('live-fmt', [['mc', '4지선다'], ['short', '단답형']], b.fmt);
    const qtype = sel('live-qtype', [['mixed', '섞어서'], ['meaning', '뜻 보고 단어 맞히기'], ['image', '그림 보고 단어 맞히기'], ['example', '예문 빈칸 채우기']], b.qtype);
    const source = sel('live-source', [['words', '단어에서 자동 생성'], ['questions', '친구들이 낸 문제'], ['mixed', '둘을 번갈아']], b.source);
    const time = sel('live-time', [[10, '10초'], [20, '20초'], [30, '30초']], b.time);
    const count = h('input', { type: 'number', min: '1', max: '50', value: String(b.count), dataset: { field: 'live-count' } });
    const card = h('input', { type: 'checkbox', checked: b.cardVote, dataset: { field: 'live-card' } });
    mount(box,
      h('div', { class: 'form-row' }, field('문제 형식', fmt), field('문제 유형', qtype)),
      h('div', { class: 'form-row' }, field('문제 출처', source), field('문제당 시간', time), field('문제 수', count)),
      h('label', { class: 'chip-check' }, card, ' 카드 뽑기 투표 사용'));
    return { read: () => ({ fmt: fmt.value, qtype: qtype.value, source: source.value, time: Number(time.value), count: Math.max(1, Math.min(50, Math.floor(Number(count.value)) || 10)), cardVote: card.checked }) };
  },

  async prepare(T, o, { participants }) {
    if (participants.length < 1) return { error: '참가자가 없어요.' };
    toast('문제를 만드는 중이에요… (그림 문제는 잠시 걸려요)', 'info', { ms: 2500 });
    const words = approvedItems('words', await T.data.ensure('words'));
    let qs = [];
    if (o.source !== 'words') qs = approvedItems('questions', await T.data.ensure('questions'));
    const { questions, notes } = await generateLiveQuiz(words, qs, { fmt: o.fmt, qtype: o.qtype, source: o.source, count: o.count });
    if (!questions.length) return { error: `출제할 수 있는 문제가 없어요. ${notes.join(' ')}`.trim() };
    const prepared = {
      phase: 'answering', round: 1, notes,
      payload: { questions, timeLimit: o.time, cardVote: o.cardVote, score: 0, results: {}, cards: null },
      settingsPatch: { liveFormat: o.fmt, liveQuizType: o.qtype, liveSource: o.source, liveTimeLimit: o.time, liveQuestionCount: o.count }
    };
    prepared.phaseEndsAt = D.now() + o.time * 1000;
    prepared.setup = async () => { prepared.phaseEndsAt = D.now() + o.time * 1000; };   // 시작 직전에 다시 계산
    return prepared;
  },

  createDriver,
  createView
};

/* ═════════ 4. 테스트 모드: 가짜 학생의 응답 ═════════ */
export function fakeLive(api, gs, host) {
  const code = api.T.code;
  const ids = api.fakes().map((s) => s.id).filter((id) => gs.payload.participants.includes(id));
  const qi = gs.round - 1;
  if (gs.phase === 'answering') {
    const span = Math.max(1500, (gs.phaseEndsAt - host.now()) * 0.7);
    ids.forEach((sid) => {
      if (!api.once(`lv:${gs.gameId}:${qi}:${sid}`)) return;
      api.later(() => D.setDoc(D.gameDoc(code, liveDocId(gs.gameId, qi, sid)), { gameId: gs.gameId, kind: 'live', qi, sid, ok: Math.random() * 100 < api.accuracy, skipped: false }).catch(() => {}), api.rand(400, span));
    });
  } else if (gs.phase === 'vote') {
    ids.forEach((sid) => {
      if (!api.once(`lvv:${gs.gameId}:${qi}:${sid}`)) return;
      const pick = Math.floor(Math.random() * 5) - 1;   // -1(뽑지 않기) ~ 3
      api.later(() => D.setDoc(D.gameDoc(code, voteDocId(gs.gameId, qi, sid)), { gameId: gs.gameId, kind: 'vote', qi, sid, pick }).catch(() => {}), api.rand(300, TIMES.liveVoteSec * 800));
    });
  }
}
