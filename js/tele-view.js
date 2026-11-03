// js/tele-view.js — 텔레스트레이션 학생 태블릿 화면과 발표 화면(TV)
//   play   : 학생은 자기 차례 하나만 보여요(그림 그리기 / 글 쓰기). TV는 진행 현황만 보여요.
//   result : 학생은 자기 모둠의 체인 결과를 직접 넘겨 봐요. TV는 교사가 넘기는 페이지(tvview 문서)를 따라가요.

import { h, mount, sessionGet, sessionSet } from './core.js';
import { mascot, groupBadge, handleError, startCountdown } from './ui.js';
import { chainPage, scoreboard } from './results.js';
import { groupScoreList } from './gamecore.js';
import { createDrawPad } from './tele-draw.js';
import { stepId, tvId, turnOf, submitStep, readResults, groupNums, pageList, MAX_TEXT } from './tele-core.js';
import * as D from './db.js';

export function createTeleView({ role, code, getMe }) {
  const el = h('div', { class: `tele-view ${role}` });
  const head = h('div', { class: 'tele-head' });
  const main = h('div', { class: 'tele-main' });
  mount(el, head, main);
  const timerEl = h('strong', { class: 'timer-chip big', dataset: { stat: 'timer' } });
  let gs = null, renderKey = '', cdKey = '', stopCd = null, pad = null, unsubs = [], token = 0;
  const bundles = new Map();   // 'play:g' → 약속(체인 목록)

  const stopSubs = () => { unsubs.splice(0).forEach((u) => u()); };
  function stopPad() { if (pad) { pad.destroy(); pad = null; } }

  let onZeroFn = null;
  function syncTimer(fn) {
    if (fn !== undefined) onZeroFn = fn;   // 시간이 끝났을 때 할 일은 나중에 정해질 수도 있어서 따로 기억해 둬요
    const k = `${gs.phase}:${gs.round}:${gs.phaseEndsAt}`;
    if (k === cdKey) return;
    cdKey = k;
    if (stopCd) { stopCd(); stopCd = null; }
    timerEl.hidden = !gs.phaseEndsAt;
    if (gs.phaseEndsAt) stopCd = startCountdown(timerEl, gs.phaseEndsAt, { tick: role === 'student', onZero: () => { if (onZeroFn) onZeroFn(); } });
  }
  function renderHead() {
    const p = gs.payload;
    const kind = gs.phase === 'play' ? (gs.round % 2 === 1 ? '🎨 그림' : '✏️ 글') : '';
    mount(head, h('span', { class: 'chip', dataset: { stat: 'play' } }, `${p.play}번째 판`),
      gs.phase === 'play' ? h('span', { class: 'chip ok', dataset: { stat: 'round' } }, `${gs.round} / ${p.rounds} 단계 ${kind}`) : h('span', { class: 'chip ok' }, '결과 보기'),
      timerEl);
  }
  const message = (face, title, text) => h('div', { class: 'center-col tele-msg' }, mascot(88, face), h('h2', null, title), text ? h('p', { class: 'muted' }, text) : null);

  /* ═════════ 학생: 내 차례 ═════════ */
  async function renderTurn(myToken) {
    const me = getMe(), p = gs.payload;
    const planG = p.plan[`g${me.groupId}`];
    const turn = turnOf(planG, gs.round, me.id);
    if (!turn) { mount(main, message('smile', '이번 게임에는 참여하지 못해요', '모둠에 3명 이상 모일 때 함께할 수 있어요. 결과를 같이 봐요!')); return; }
    if (turn.idle) { mount(main, message('smile', '우리 모둠은 모두 끝났어요!', '다른 모둠을 기다려요.')); return; }
    const tag = `${gs.gameId}_${p.play}_${gs.round}`;
    const subKey = `malrang_tsub_${tag}`;
    if (sessionGet(subKey)) { mount(main, message('smile', '제출했어요! ✅', '다른 친구들을 기다려요.')); return; }

    mount(main, h('p', { class: 'muted center' }, '앞 친구의 작품을 불러오는 중이에요…'));
    let prev = null;
    if (gs.round > 1) {
      for (let i = 0; i < 2 && !prev; i++) {
        try { const snap = await D.getDocFromServer(D.gameDoc(code, stepId(gs.gameId, p.play, me.groupId, turn.c, gs.round - 1))); prev = snap.exists() ? snap.data() : { data: '', locked: true }; }   // [읽기] 1개
        catch (e) { if (i === 1) { handleError(e, {}); prev = { data: '', locked: true }; } }
      }
    }
    if (myToken !== token) return;   // 그 사이에 단계가 바뀌었어요

    const ctx = { gameId: gs.gameId, play: p.play, g: me.groupId, c: turn.c, r: gs.round, type: turn.type, by: me.nickname, sid: me.id };
    let submitted = false, input = null;
    const status = h('p', { class: 'live-status', 'aria-live': 'polite', dataset: { stat: 'status' } });
    const doneBtn = h('button', { class: 'btn primary big', type: 'button', dataset: { act: 'tele-done' } }, turn.type === 'draw' ? '다 그렸어요' : '다 썼어요');

    async function submit(data) {
      if (submitted) return;
      submitted = true; doneBtn.disabled = true;
      if (input) input.disabled = true;
      if (pad) pad.lock();
      try {
        const r = await submitStep(code, ctx, data);   // [읽기][쓰기]
        sessionSet(subKey, '1');
        if (pad) pad.clearSaved();
        mount(main, message(r === 'ok' ? 'smile' : 'wow', r === 'ok' ? '제출했어요! ✅' : '시간이 끝나서 이번 칸은 비워졌어요', '다른 친구들을 기다려요.'));
      } catch (e) { submitted = false; doneBtn.disabled = false; if (input) input.disabled = false; handleError(e, {}); }
    }

    if (turn.type === 'draw') {
      stopPad();
      pad = createDrawPad({ storageKey: `malrang_td_${tag}` });
      const tools = [['pen', '✏️ 펜'], ['eraser', '🧽 지우개']].map(([t, label]) => h('button', {
        class: `btn small ghost tool ${t === 'pen' ? 'on' : ''}`, type: 'button', dataset: { tool: t },
        onclick: (ev) => { pad.setTool(t); tools.forEach((b) => b.classList.remove('on')); ev.currentTarget.classList.add('on'); }
      }, label));
      const brief = turn.word
        ? h('div', { class: 'tele-brief' }, h('span', { class: 'muted' }, '제시어'), h('strong', { class: 'tele-word', dataset: { stat: 'word' } }, turn.word.w), h('p', { class: 'muted' }, '그림으로만 알려 줘요. 글자와 숫자는 쓰지 않아요!'))
        : h('div', { class: 'tele-brief' }, h('span', { class: 'muted' }, '앞 친구가 이렇게 썼어요'),
          h('div', { class: 'bubble', dataset: { stat: 'prev-text' } }, prev && prev.data ? prev.data : '(앞 친구가 쓰지 못했어요. 마음대로 그려 봐요!)'),
          h('p', { class: 'muted' }, '이 말을 그림으로 그려 보세요.'));
      doneBtn.onclick = () => submit(pad.toData());
      mount(main, h('div', { class: 'tele-box' }, brief,
        h('div', { class: 'draw-wrap' }, pad.el),
        h('div', { class: 'draw-tools' }, ...tools, h('button', { class: 'btn small ghost', type: 'button', dataset: { act: 'undo' }, onclick: () => pad.undo() }, '↩️ 되돌리기'), doneBtn), status));
      syncTimer(() => { if (!submitted && pad && pad.hasInk()) submit(pad.toData()); });   // 시간이 끝나면 그리던 그림을 자동 제출
    } else {
      input = h('input', { class: 'speed-input', type: 'text', maxLength: MAX_TEXT, autocomplete: 'off', spellcheck: false, placeholder: turn.last ? '정답을 써요' : '무엇일까요?', dataset: { field: 'tele-text' } });
      doneBtn.onclick = () => { if (input.value.trim()) submit(input.value.trim()); else status.textContent = '글을 써 주세요.'; };
      input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); doneBtn.click(); } };
      const pic = prev && prev.data && !prev.locked ? h('img', { class: 'tele-prev', src: prev.data, alt: '앞 친구의 그림', dataset: { stat: 'prev-img' } }) : h('div', { class: 'tele-prev blank' }, '(앞 친구가 그리지 못했어요)');
      mount(main, h('div', { class: 'tele-box' }, h('span', { class: 'muted' }, '앞 친구의 그림'), pic,
        h('h3', null, turn.last ? '마지막이에요! 정답이 뭘까요?' : '이 그림은 무엇일까요?'), h('div', { class: 'speed-answer' }, input, doneBtn), status));
      syncTimer(() => { if (!submitted && input.value.trim()) submit(input.value.trim()); });
      setTimeout(() => { try { input.focus(); } catch { /* 무시 */ } }, 50);
    }
  }

  /* ═════════ TV: 진행 현황 ═════════ */
  function renderProgress() {
    const p = gs.payload;
    const nums = groupNums(p.plan);
    const cells = nums.map((g) => h('div', { class: 'tele-prog', dataset: { g: String(g) } }, groupBadge(g), h('strong', { dataset: { stat: `prog-${g}` } }, p.plan[`g${g}`].L < gs.round ? '모두 끝!' : `0 / ${p.plan[`g${g}`].members.length}`)));
    mount(main, h('div', { class: 'center-col' },
      h('h1', null, gs.round % 2 === 1 ? '🎨 그림을 그려요!' : '✏️ 글을 써요!'),
      h('p', { class: 'muted' }, gs.round === 1 ? '제시어를 보고 그림으로만 알려 줘요' : '앞 친구의 작품만 보고 이어서 해요'),
      h('div', { class: 'tele-progs' }, cells)));
    const q = D.query(D.gamesCol(code), D.where('gameId', '==', gs.gameId), D.where('kind', '==', 'tele'), D.where('play', '==', p.play), D.where('r', '==', gs.round));
    unsubs.push(D.onSnapshot(q, (snap) => {   // [읽기] 라운드마다 제출 수만큼
      const cnt = {};
      snap.docs.forEach((d) => { const g = d.data().g; cnt[g] = (cnt[g] || 0) + 1; });
      nums.forEach((g) => { const e = main.querySelector(`[data-stat="prog-${g}"]`); if (e && p.plan[`g${g}`].L >= gs.round) e.textContent = `${cnt[g] || 0} / ${p.plan[`g${g}`].members.length}`; });
    }, (e) => handleError(e, {})));
    syncTimer();
  }

  /* ═════════ 결과 ═════════ */
  function getChains(g) {
    const p = gs.payload, k = `${p.play}:${g}`;
    if (!bundles.has(k)) {
      const info = p.res && p.res[`g${g}`];
      bundles.set(k, info ? readResults(code, gs.gameId, p.play, g, info.parts) : Promise.resolve([]));
    }
    return bundles.get(k);
  }
  const rankPage = () => h('div', { class: 'tele-rank' }, scoreboard(groupScoreList(gs.payload.scores, groupNums(gs.payload.plan)), { title: `모둠 점수 순위 (${gs.payload.play}번째 판까지)` }));

  async function renderStudentResult(myToken) {
    const me = getMe(), p = gs.payload;
    if (!p.plan[`g${me.groupId}`]) { mount(main, h('div', { class: 'tele-box' }, rankPage())); return; }
    mount(main, h('p', { class: 'muted center' }, '결과를 불러오는 중이에요…'));
    let chains = [];
    try { chains = await getChains(me.groupId); } catch (e) { handleError(e, {}); }
    if (myToken !== token) return;
    const total = chains.length + 1;
    let idx = 0;
    const page = h('div', { class: 'tele-result-page' });
    const label = h('span', { class: 'chip', dataset: { stat: 'page-no' } });
    const prevBtn = h('button', { class: 'btn small ghost', type: 'button', dataset: { act: 'prev-page' }, onclick: () => go(idx - 1) }, '← 이전');
    const nextBtn = h('button', { class: 'btn small primary', type: 'button', dataset: { act: 'next-page' }, onclick: () => go(idx + 1) }, '다음 →');
    function go(i) {
      idx = Math.max(0, Math.min(total - 1, i));
      mount(page, idx < chains.length ? chainPage(chains[idx], { label: `${me.groupId}모둠 · ${idx + 1}/${chains.length}` }) : rankPage());
      label.textContent = `${idx + 1} / ${total}`;
      prevBtn.disabled = idx === 0; nextBtn.disabled = idx === total - 1;
    }
    mount(main, h('div', { class: 'tele-box wide' }, h('div', { class: 'row-between' }, prevBtn, label, nextBtn), page));
    go(0);
  }

  async function renderTvResult(myToken) {
    const p = gs.payload, pages = pageList(p.plan), total = pages.length + 1;
    const holder = h('div', { class: 'tele-tv' });
    mount(main, holder);
    let shown = -1;
    async function show(idx) {
      idx = Math.max(0, Math.min(total - 1, idx));
      shown = idx;
      if (idx >= pages.length) { mount(holder, rankPage()); return; }
      const { g, c } = pages[idx];
      let chains = [];
      try { chains = await getChains(g); } catch (e) { handleError(e, {}); }
      if (myToken !== token || shown !== idx) return;
      const ch = chains.find((x) => x.c === c);
      mount(holder, ch ? chainPage(ch, { label: `${g}모둠 · ${c + 1}/${p.plan[`g${g}`].members.length}` }) : h('p', { class: 'muted' }, '결과를 불러오지 못했어요'));
      const nextG = pages[idx + 1] && pages[idx + 1].g;
      if (nextG && nextG !== g) getChains(nextG).catch(() => {});   // 다음 모둠 것을 미리 읽어 둬요
    }
    unsubs.push(D.onSnapshot(D.gameDoc(code, tvId(gs.gameId)), (snap) => { show(snap.exists() ? snap.data().p : 0); }, (e) => handleError(e, {})));   // [읽기] 페이지를 넘길 때마다 1건
  }

  function render() {
    renderHead();
    const key = `${gs.phase}:${gs.payload.play}:${gs.round}`;
    if (key === renderKey) return;
    renderKey = key;
    token++;
    stopSubs(); stopPad();
    onZeroFn = null;
    if (gs.phase === 'play') {
      syncTimer(); if (role === 'student') renderTurn(token); else renderProgress(); }
    else if (gs.phase === 'result') { syncTimer(); if (role === 'student') renderStudentResult(token); else renderTvResult(token); }
  }

  return {
    el,
    update(next) {
      if (!gs || gs.gameId !== next.gameId) { renderKey = ''; cdKey = ''; bundles.clear(); }
      gs = next;
      render();
    },
    destroy() { token++; stopSubs(); stopPad(); if (stopCd) stopCd(); }
  };
}
