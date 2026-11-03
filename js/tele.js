// js/tele.js — 텔레스트레이션 (교사 진행자 + 시작 준비 + 테스트용 가짜 학생)
//   한 라운드: 모든 학생이 체인 하나씩 맡아 동시에 그리거나 써요. 다 내면(또는 시간이 끝나고 2초 뒤) 다음 라운드로.
//   마지막 라운드가 끝나면 결과 번들을 만들어 저장하고, 발표 화면(TV)과 학생 태블릿에 결과를 보여 줘요.
//   판이 끝나면 교사가 [다음 판] 또는 [게임 종료]를 골라요.

import { h, mount } from './core.js';
import { TIMES } from './config.js';
import { groupBadge, handleError, field } from './ui.js';
import { approvedItems } from './packs.js';
import * as D from './db.js';
import * as G from './gamecore.js';
import { createTeleView } from './tele-view.js';
import { scribbleData } from './tele-draw.js';
import { makePlan, turnOf, authorOf, expectedCount, groupNums, pageList, buildChains, writeResults, submitStep, fillStep, stepId, tvId, typeOfStep } from './tele-core.js';

const TEXTS = ['고양이', '자동차', '나무', '바다', '사람', '집', '모르겠어요'];
const LEAD_MS = 1500;   // 다음 라운드로 넘어갈 때 앞 친구 작품을 불러올 여유

/* ═════════ 1. 교사 진행자 ═════════ */
function createDriver(host) {
  const code = host.code;
  const steps = new Map();      // 'g:r:c' → 단계 문서 (이번 판 전체)
  const playIds = new Set();    // 이번 판에서 만든 임시 문서 ID (판이 끝나면 지워요)
  let playOf = 0, bodyEl = null, advancing = false, page = 0, auto = null, autoOn = false, keyFn = null;
  const P = () => host.gs.payload;
  const secFor = (r) => (r % 2 === 1 ? P().drawSec : P().textSec);
  const key = (g, r, c) => `${g}:${r}:${c}`;
  const tvRef = () => D.gameDoc(code, tvId(host.gs.gameId));

  function addStep(d) { steps.set(key(d.g, d.r, d.c), d); }
  function roundCount(r) { let n = 0; steps.forEach((d) => { if (d.r === r) n++; }); return n; }

  async function step(patch) {
    if (advancing) return;
    advancing = true;
    try { const ok = await host.go(patch); if (!ok) advancing = false; }
    catch (e) { advancing = false; handleError(e, { teacher: true }); }
  }

  /* 라운드 끝: 못 낸 칸을 빈 칸으로 채우고 다음으로 */
  async function fillAndAdvance() {
    if (advancing) return;
    const gs = host.gs, p = P(), r = gs.round;
    advancing = true;
    try {
      for (const g of groupNums(p.plan)) {
        const planG = p.plan[`g${g}`];
        if (r > planG.L) continue;
        for (let c = 0; c < planG.members.length; c++) {
          if (steps.has(key(g, r, c))) continue;
          const author = authorOf(planG, c, r);
          const s = { gameId: gs.gameId, play: p.play, g, c, r, type: typeOfStep(r), by: p.names[author] || '', sid: author };
          const made = await fillStep(code, s);   // [읽기][쓰기] 이미 있으면 건드리지 않아요
          const id = stepId(gs.gameId, p.play, g, c, r);
          host.track(id); playIds.add(id);
          if (made) addStep(made);
          else { const snap = await D.getDoc(D.gameDoc(code, id)); if (snap.exists()) addStep(snap.data()); }   // 방금 도착한 제출을 가져와요
        }
      }
    } catch (e) { advancing = false; handleError(e, { teacher: true }); return; }
    advancing = false;
    advance();
  }

  async function advance() {
    if (advancing) return;
    const gs = host.gs, p = P();
    if (gs.round < p.rounds) {
      step({ phase: 'play', round: gs.round + 1, phaseEndsAt: host.now() + secFor(gs.round + 1) * 1000 + LEAD_MS });
      return;
    }
    advancing = true;
    try { await buildResults(); } catch (e) { advancing = false; handleError(e, { teacher: true }); }   // 성공하면 새 상태가 올 때까지 true로 둬요(두 번 만들지 않게)
  }

  /* 판이 끝났어요 → 결과 번들 저장, 점수 누적, TV 페이지 0으로 */
  async function buildResults() {
    const gs = host.gs, p = P();
    const nums = groupNums(p.plan);
    const total = nums.reduce((a, g) => a + p.plan[`g${g}`].members.length * p.plan[`g${g}`].L, 0);
    if (steps.size < total) {   // 교사 창을 새로 열었다면 빠진 것을 한 번에 읽어 와요
      const snap = await D.getDocs(D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'tele'), D.where('play', '==', p.play)));   // [읽기]
      snap.docs.forEach((d) => { addStep(d.data()); host.track(d.id); playIds.add(d.id); });
    }
    const threshold = host.settings.similarityThreshold || 0.85;
    const res = {}, scores = { ...(p.scores || {}) }, add = { total: 0, groupScores: {}, solved: {} };
    for (const g of nums) {
      const planG = p.plan[`g${g}`];
      const map = new Map();
      steps.forEach((d) => { if (d.g === g) map.set(`${d.r}:${d.c}`, d); });
      const chains = buildChains(planG, map, (id) => p.names[id] || '', threshold);
      const w = await writeResults(code, gs.gameId, p.play, g, chains);
      w.ids.forEach((id) => { host.track(id); playIds.add(id); });
      res[`g${g}`] = { parts: w.parts, chains: w.chains };
      const right = chains.filter((c) => c.correct);
      scores[`g${g}`] = (scores[`g${g}`] || 0) + right.length;
      add.total += right.length;
      add.groupScores[`g${g}`] = D.increment(right.length);
      if (right.length) add.solved[`g${g}`] = D.arrayUnion(...right.map((c) => c.word));
    }
    await D.setDoc(D.gameDoc(code, 'summary'), { total: D.increment(add.total), groupScores: add.groupScores, solved: add.solved, plays: D.increment(1) }, { merge: true });   // [쓰기]
    const first = pageList(p.plan)[0];
    await D.setDoc(tvRef(), { gameId: gs.gameId, kind: 'tvview', play: p.play, p: 0, g: first.g, c: first.c });   // [쓰기]
    host.track(tvId(gs.gameId)); playIds.add(tvId(gs.gameId));
    page = 0;
    const ok = await host.go({ phase: 'result', phaseEndsAt: null, 'payload.res': res, 'payload.scores': scores });
    if (!ok) throw new Error('상태가 바뀌어서 결과 화면으로 넘어가지 못했어요.');
  }

  /* ── 결과 화면 조작 ── */
  const pages = () => pageList(P().plan);
  async function setPage(i) {
    const list = pages();
    const idx = Math.max(0, Math.min(list.length, i));   // list.length = 마지막(점수 순위) 페이지
    const at = list[Math.min(idx, list.length - 1)];
    page = idx;
    draw();
    try { await D.setDoc(tvRef(), { gameId: host.gs.gameId, kind: 'tvview', play: P().play, p: idx, g: at.g, c: at.c }); }   // [쓰기]
    catch (e) { handleError(e, { teacher: true }); }
  }
  function toggleAuto(on) {
    autoOn = on;
    if (auto) { clearInterval(auto); auto = null; }
    if (on) auto = setInterval(() => { if (page < pages().length) setPage(page + 1); else toggleAuto(false); }, 10000);
    draw();
  }
  function onKey(e) {
    if (host.gs.phase !== 'result' || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); setPage(page + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); setPage(page - 1); }
  }

  async function nextPlay() {
    if (advancing) return;
    advancing = true;
    const gs = host.gs, p = P();
    try {
      await G.cleanupPlayDocs(code, gs.gameId, p.play, [...playIds]);   // [삭제][읽기] 이번 판의 그림·번들·페이지 위치를 지워요
      playIds.forEach((id) => host.untrack(id));
      playIds.clear(); steps.clear();
      const words = approvedItems('words', await host.T.data.ensure('words')).map((w) => ({ id: w.id, w: w.word, t: w.type }));
      const mk = makePlan({ groups: p.groups, requestedL: p.requestedL, words, used: p.used || [] });
      toggleAuto(false);
      const ok = await host.go({ phase: 'play', round: 1, phaseEndsAt: host.now() + p.drawSec * 1000, 'payload.play': p.play + 1, 'payload.plan': mk.plan, 'payload.used': mk.used, 'payload.rounds': mk.rounds, 'payload.res': null });
      if (!ok) advancing = false;
    } catch (e) { advancing = false; handleError(e, { teacher: true }); }
  }

  async function endGame() {
    if (advancing) return;
    advancing = true;
    try {
      const snap = await D.getDoc(D.gameDoc(code, 'summary'));   // [읽기]
      const s = snap.exists() ? snap.data() : {};
      const nums = groupNums(P().plan);
      const summary = {
        mode: 'tele', groups: nums, plays: s.plays || P().play,
        groupScores: Object.fromEntries(nums.map((g) => [`g${g}`, (s.groupScores && s.groupScores[`g${g}`]) || 0])),
        solved: Object.fromEntries(nums.map((g) => [`g${g}`, (s.solved && s.solved[`g${g}`]) || []])), total: s.total || 0
      };
      toggleAuto(false);
      const ok = await host.finish(summary);
      if (!ok) advancing = false;
    } catch (e) { advancing = false; handleError(e, { teacher: true }); }
  }

  /* ── 진행 카드 ── */
  function draw() {
    if (!bodyEl || !bodyEl.isConnected) return;
    const gs = host.gs, p = P();
    const nums = groupNums(p.plan);
    if (gs.phase === 'play') {
      const rows = nums.map((g) => {
        const planG = p.plan[`g${g}`];
        const done = [...steps.values()].filter((d) => d.g === g && d.r === gs.round).length;
        return h('span', { class: 'chip', dataset: { stat: `ctl-prog-${g}` } }, groupBadge(g, { compact: true }), planG.L < gs.round ? ' 끝' : ` ${done}/${planG.members.length}`);
      });
      mount(bodyEl, h('div', { class: 'tele-ctl' },
        h('div', null, h('strong', null, `${p.play}번째 판 · ${gs.round}/${p.rounds}단계`), ' · ', gs.round % 2 === 1 ? '🎨 그림' : '✏️ 글', ` (모두 내면 바로 넘어가요)`),
        h('div', { class: 'row-between' }, h('div', { class: 'chips' }, rows), h('button', { class: 'btn small ghost', type: 'button', dataset: { act: 'close-now' }, onclick: fillAndAdvance }, '지금 마감'))));
    } else if (gs.phase === 'result') {
      const list = pages();
      const at = page < list.length ? list[page] : null;
      const label = at ? `${at.g}모둠 · ${p.plan[`g${at.g}`].words[at.c].w} (${at.c + 1}/${p.plan[`g${at.g}`].members.length})` : '모둠 점수 순위';
      mount(bodyEl, h('div', { class: 'tele-ctl' },
        h('div', { class: 'row-between' }, h('strong', { dataset: { stat: 'tv-label' } }, `TV: ${label}`), h('span', { class: 'muted' }, `${page + 1} / ${list.length + 1} (← → 키로도 넘겨요)`)),
        h('div', { class: 'chips' },
          h('button', { class: 'btn small', type: 'button', dataset: { act: 'tv-prev' }, onclick: () => setPage(page - 1) }, '← 이전'),
          h('button', { class: 'btn small primary', type: 'button', dataset: { act: 'tv-next' }, onclick: () => setPage(page + 1) }, '다음 →'),
          ...nums.map((g) => h('button', { class: 'btn small ghost', type: 'button', dataset: { act: 'tv-group', g: String(g) }, onclick: () => setPage(list.findIndex((x) => x.g === g)) }, groupBadge(g, { compact: true }))),
          h('label', { class: 'chip-check' }, h('input', { type: 'checkbox', checked: autoOn, onchange: (e) => toggleAuto(e.target.checked) }), ' 10초마다 자동 넘김')),
        h('div', { class: 'chips' },
          h('span', { class: 'muted' }, '이번 판까지 점수: '), ...nums.map((g) => h('span', { class: 'chip ok' }, groupBadge(g, { compact: true }), ` ${(p.scores && p.scores[`g${g}`]) || 0}점`))),
        h('div', { class: 'chips' },
          h('button', { class: 'btn primary', type: 'button', dataset: { act: 'next-play' }, onclick: nextPlay }, '다음 판'),
          h('button', { class: 'btn', type: 'button', dataset: { act: 'end-game' }, onclick: endGame }, '게임 종료 (최종 결과)'))));
    }
  }

  return {
    onState(gs) {
      advancing = false;
      const p = gs.payload;
      if (playOf !== p.play) { steps.clear(); playIds.clear(); playOf = p.play; }
      if (gs.phase === 'play') {
        const q = D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'tele'), D.where('play', '==', p.play), D.where('r', '==', gs.round));
        host.watch(q, (snap) => {   // [읽기] 라운드마다 제출 수만큼
          snap.docs.forEach((d) => { addStep(d.data()); host.track(d.id); playIds.add(d.id); });
          if (roundCount(gs.round) >= expectedCount(P().plan, gs.round)) advance();   // 전원 제출 → 바로 다음으로
          draw();
        }, 'state');
        host.at('close', gs.phaseEndsAt + TIMES.teleGraceMs, fillAndAdvance);   // 마감 뒤 2초 기다렸다가 빈 칸을 채워요
      } else if (gs.phase === 'result') {
        host.watch(tvRef(), (snap) => { if (snap.exists()) { page = snap.data().p; draw(); } }, 'state');   // [읽기] 페이지를 넘길 때마다 1건
        if (!keyFn) { keyFn = onKey; document.addEventListener('keydown', keyFn); }
      }
      if (gs.phase !== 'result') { toggleAuto(false); }
      draw();
    },
    renderControl(body) { bodyEl = body; draw(); },
    dispose() { toggleAuto(false); if (keyFn) document.removeEventListener('keydown', keyFn); keyFn = null; bodyEl = null; }
  };
}

/* ═════════ 2. 시작 준비 ═════════ */
export const TELE = {
  key: 'tele', mode: 'tele', scope: 'group', icon: '🎨', label: '텔레스트레이션',
  desc: '그림 → 글 → 그림 → 글… 이어 그리기! 마지막 친구가 제시어를 맞혀요',

  renderForm(box, T, prev) {
    const s = T.room.settings;
    const b = prev || { steps: s.telestrationSteps || 6, drawSec: s.teleDrawSec || 30, textSec: s.teleTextSec || 20 };
    const steps = h('input', { type: 'number', min: '2', step: '2', value: String(b.steps), dataset: { field: 'tele-steps' } });
    const sel = (name, opts, val) => h('select', { dataset: { field: name } }, opts.map((v) => h('option', { value: String(v), selected: v === val }, `${v}초`)));
    const draw = sel('tele-draw', [20, 30, 45, 60], b.drawSec), text = sel('tele-text', [10, 20, 30], b.textSec);
    mount(box, h('div', { class: 'form-row' }, field('단계 수 (짝수)', steps, '모둠 인원보다 크면 그 모둠은 자동으로 줄어요'), field('그림 시간', draw), field('글 시간', text)));
    return { read: () => ({ steps: Math.max(2, Math.floor(Number(steps.value)) || 6), drawSec: Number(draw.value), textSec: Number(text.value) }) };
  },

  async prepare(T, o, { plan: gp, useGroups }) {
    const words = approvedItems('words', await T.data.ensure('words')).map((w) => ({ id: w.id, w: w.word, t: w.type }));
    if (words.length < 3) return { error: `승인된 말이 3개 이상 필요해요. (지금 ${words.length}개)` };
    const notes = [];
    let requested = o.steps;
    if (requested % 2 === 1) { requested -= 1; notes.push(`마지막 단계는 글이어야 해서 단계 수를 ${requested}개(짝수)로 바꿨어요.`); }
    const groups = Object.fromEntries(useGroups.map((g) => [g, gp.groups[g]]));
    const mk = makePlan({ groups, requestedL: requested, words });
    nums(mk.plan).forEach((g) => {
      const pg = mk.plan[`g${g}`];
      if (pg.L < requested) notes.push(`${g}모둠은 ${pg.members.length}명이라 단계를 ${pg.L}개로 줄여요.`);
    });
    if (gp.small.length) notes.push(`${gp.small.join(', ')}모둠은 3명 미만이라 참여하지 못해요.`);
    if (gp.noGroup.length) notes.push(`모둠을 고르지 않은 ${gp.noGroup.length}명은 제외돼요.`);
    let secs = 0;
    for (let r = 1; r <= mk.rounds; r++) secs += (r % 2 === 1 ? o.drawSec : o.textSec) + 3;
    const writes = nums(mk.plan).reduce((a, g) => a + mk.plan[`g${g}`].members.length * mk.plan[`g${g}`].L, 0);
    notes.push(`한 판 예상 시간: 약 ${Math.ceil(secs / 60)}분 · 제출 약 ${writes}건 (총 ${mk.rounds}단계)`);
    if (words.length < writes / 2) notes.push('승인된 말이 적어서 제시어가 겹칠 수 있어요.');
    const prepared = {
      phase: 'play', round: 1, notes, phaseEndsAt: D.now() + o.drawSec * 1000,
      payload: {
        play: 1, plan: mk.plan, used: mk.used, rounds: mk.rounds, requestedL: requested, drawSec: o.drawSec, textSec: o.textSec,
        scores: Object.fromEntries(nums(mk.plan).map((g) => [`g${g}`, 0])), res: null
      },
      settingsPatch: { telestrationSteps: requested, teleDrawSec: o.drawSec, teleTextSec: o.textSec }
    };
    prepared.setup = async (gameId) => {
      prepared.phaseEndsAt = D.now() + o.drawSec * 1000;
      const ks = nums(mk.plan).map((g) => `g${g}`);
      await D.setDoc(D.gameDoc(T.code, 'summary'), { gameId, kind: 'summary', mode: 'tele', total: 0, plays: 0, groupScores: Object.fromEntries(ks.map((k) => [k, 0])), solved: Object.fromEntries(ks.map((k) => [k, []])) });   // [쓰기]
    };
    return prepared;
  },

  createDriver,
  createView: createTeleView
};
const nums = groupNums;

/* ═════════ 3. 테스트 모드: 가짜 학생의 그림·글 ═════════ */
export function fakeTele(api, gs, host) {
  if (gs.phase !== 'play') return;
  const p = gs.payload, code = api.T.code;
  api.fakes().forEach((s) => {
    if (!p.participants.includes(s.id) || !s.groupId) return;
    const planG = p.plan[`g${s.groupId}`];
    const turn = turnOf(planG, gs.round, s.id);
    if (!turn || turn.idle) return;
    if (!api.once(`tl:${gs.gameId}:${p.play}:${gs.round}:${s.id}`)) return;
    const span = Math.max(1500, (gs.phaseEndsAt - host.now()) * 0.6);
    api.later(() => {
      let data;
      if (turn.type === 'draw') data = scribbleData();
      else if (turn.last && Math.random() * 100 < api.accuracy) data = planG.words[turn.c].w;   // 마지막 단계: 정답률만큼 제시어를 맞혀요
      else data = TEXTS[Math.floor(Math.random() * TEXTS.length)];
      submitStep(code, { gameId: gs.gameId, play: p.play, g: s.groupId, c: turn.c, r: gs.round, type: turn.type, by: s.nickname, sid: s.id }, data).catch(() => {});
    }, api.rand(800, span));
  });
}
