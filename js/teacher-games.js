// js/teacher-games.js — 교사 게임 화면의 중심
//   createGameHost(T) : 방 화면이 열려 있는 동안 계속 살아 있는 "게임 진행자". 상태 전환, 타이머, 구독, 정리를 맡아요.
//   mountGamesTab()   : [게임] 탭 — 참가자 확인 → 게임 고르기 → 시작
//   진행 카드(attachControl) : 게임 중에는 어느 탭에서든 맨 위에 보여요. [게임 중단] 버튼이 항상 있어요.

import { h, mount, clear } from './core.js';
import { PRESENCE_WINDOW_MS } from './config.js';
import { mascot, toast, confirmDialog, handleError, startCountdown, keepAwake, setBanner } from './ui.js';
import { toMs } from './text.js';
import { finalView } from './results.js';
import * as D from './db.js';
import * as G from './gamecore.js';
import { SPEED_GROUP, SPEED_ALL } from './speed.js';
import { LIVE } from './live.js';
import { TELE } from './tele.js';

export const GAMES = { speed_group: SPEED_GROUP, speed_all: SPEED_ALL, live: LIVE, tele: TELE };
const ORDER = ['live', 'speed_all', 'speed_group', 'tele'];

/* ═════════════════════════ 게임 진행자 ═════════════════════════ */
export function createGameHost(T) {
  const S = { gs: null, driver: null, driverGameId: '', ticker: null, schedules: new Map(), stateSubs: [], gameSubs: [], known: new Set(), controlEl: null, scores: null, stopCountdown: null, hiddenAt: 0, offs: [] };

  const host = {
    T, code: T.code,
    get gs() { return T.room.gameState; },
    get settings() { return T.room.settings; },
    isDriver: () => T.room.gameState.driverId === T.tabId,
    now: () => D.now(),

    /** 게임 상태를 바꿔요. seq를 주지 않으면 지금 알고 있는 값으로 해요. 성공하면 true */
    async go(patch, seq) {
      try { return await G.transition(T.code, seq ?? S.gs.seq, T.tabId, patch); }   // [읽기][쓰기]
      catch (e) { handleError(e, { teacher: true }); return false; }
    },
    /** now() 시각 ms가 되면 fn을 한 번 불러요. 상태가 바뀌면(seq 변경) 자동으로 취소돼요. */
    at(key, ms, fn) { S.schedules.set(key, { ms, fn }); },
    clearAt(key) { S.schedules.delete(key); },
    /** 실시간 듣기. scope 'state'는 다음 상태 전환 때 자동으로 끊고, 'game'은 게임이 끝날 때 끊어요. */
    watch(target, cb, scope = 'state') {
      const unsub = D.onSnapshot(target, cb, (e) => handleError(e, { teacher: true }));   // [읽기]
      (scope === 'game' ? S.gameSubs : S.stateSubs).push(unsub);
      return unsub;
    },
    track(id) { S.known.add(id); },
    untrack(id) { S.known.delete(id); },
    trackSnap(snap) { snap.docs.forEach((d) => S.known.add(d.id)); },
    setScores(scores) { S.scores = scores; T.emit('students'); },
    refresh() { renderControl(); },
    /** 최종 결과 화면으로 */
    async finish(summary, seq) { return host.go({ phase: 'final', phaseEndsAt: null, finalSummary: summary }, seq); },
    /** 결과를 닫고 임시 문서를 정리한 뒤 idle로 */
    async close() {
      const gameId = S.gs.gameId;
      const known = S.driver ? new Set(S.known) : null;
      try {
        await G.resetToIdle(T.code, gameId);   // [읽기][쓰기]
        await G.cleanupGameDocs(T.code, gameId, known);   // [삭제] 임시 문서와 요약
      } catch (e) { handleError(e, { teacher: true }); }
    }
  };

  /* ── 틱(타이머): 0.25초마다 예약된 일을 확인해요 ── */
  function onTick() {
    const nowMs = D.now();
    for (const [key, s] of [...S.schedules]) {
      if (nowMs >= s.ms) { S.schedules.delete(key); try { s.fn(); } catch (e) { console.error('[예약 실행 오류]', e); } }
    }
  }
  function ensureTicker() { if (!S.ticker) S.ticker = G.createTicker(onTick); }
  function stopTicker() { if (S.ticker) { S.ticker.stop(); S.ticker = null; } }

  /* ── 방 문서가 바뀔 때 ── */
  function onRoom() {
    const gs = T.room.gameState;
    const prev = S.gs;
    if (prev && prev.seq === gs.seq && prev.gameId === gs.gameId) { S.gs = gs; return; }
    const newGame = !prev || prev.gameId !== gs.gameId;
    S.gs = gs;
    S.schedules.clear();
    S.stateSubs.splice(0).forEach((u) => u());
    if (newGame) {
      S.gameSubs.splice(0).forEach((u) => u());
      S.known = new Set();
      S.scores = null;
      if (S.driver) { S.driver.dispose(); S.driver = null; }
    }
    const isGame = G.isGameMode(gs.mode);
    keepAwake(isGame || gs.mode === 'confirm');
    if (isGame && gs.driverId === T.tabId) {
      if (!S.driver) S.driver = GAMES[gs.mode].createDriver(host);
      ensureTicker();
      try { S.driver.onState(gs); } catch (e) { console.error('[진행 오류]', e); }
    } else {
      if (S.driver) { S.driver.dispose(); S.driver = null; }
      if (!isGame) stopTicker();
      if (!isGame) S.gameSubs.splice(0).forEach((u) => u());
    }
    if (T.test && T.test.onGameState) T.test.onGameState(gs, host);
    renderControl();
  }
  function onVisibility() {
    if (document.visibilityState === 'hidden') { S.hiddenAt = Date.now(); return; }
    if (S.driver && S.hiddenAt && Date.now() - S.hiddenAt > 2000) {
      setBanner('hiddenwarn', '교사 창이 가려져 있으면 진행이 늦어질 수 있어요.');
      setTimeout(() => setBanner('hiddenwarn', null), 6000);
    }
  }
  document.addEventListener('visibilitychange', onVisibility);
  S.offs.push(T.on('room', onRoom));

  /* ── 진행 카드 ── */
  function attachControl(el) { S.controlEl = el; renderControl(); }

  function renderControl() {
    const el = S.controlEl;
    if (!el) return;
    if (S.stopCountdown) { S.stopCountdown(); S.stopCountdown = null; }
    const gs = T.room.gameState;
    if (gs.mode === 'idle' || gs.mode === 'ranking') { clear(el); return; }
    if (gs.mode === 'confirm') {
      mount(el, h('section', { class: 'card control' }, h('div', { class: 'row-between' }, h('strong', null, '🙋 참가자 확인 중 — [게임] 탭에서 이어서 해요'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: cancelConfirm }, '취소'))));
      return;
    }
    const def = GAMES[gs.mode];
    const mine = gs.driverId === T.tabId;
    const timer = h('span', { class: 'timer-chip', hidden: !gs.phaseEndsAt, dataset: { stat: 'timer' } });
    const head = h('div', { class: 'row-between' },
      h('div', { class: 'chips' }, h('strong', { class: 'ctl-title' }, `${def ? def.icon : ''} ${def ? def.label : gs.mode}`), h('span', { class: 'chip', dataset: { stat: 'phase' } }, phaseText(gs)), timer),
      h('div', { class: 'chips' },
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => window.open(`${location.origin}${location.pathname}#present/${T.code}`, 'malrang_present') }, '발표 화면'),
        h('button', { class: 'btn small danger-ghost', type: 'button', dataset: { act: 'abort' }, onclick: abortGame }, '게임 중단')));
    const body = h('div', { class: 'ctl-body' });
    mount(el, h('section', { class: 'card control', dataset: { mode: gs.mode } }, head, body));
    if (gs.phaseEndsAt) S.stopCountdown = startCountdown(timer, gs.phaseEndsAt, { tick: false });
    if (gs.phase === 'final') {   // 최종 결과: 어느 교사 창에서든 닫을 수 있어요
      mount(body, finalView(gs.finalSummary), h('div', { class: 'chips center' },
        h('button', { class: 'btn primary big', type: 'button', dataset: { act: 'close-final' }, onclick: closeFinal }, '결과 닫기 (처음 화면으로)')));
      return;
    }
    if (!mine) {
      mount(body, h('p', { class: 'msg warn' }, '다른 교사 창이 진행 중이에요.'),
        h('div', { class: 'chips' },
          h('button', { class: 'btn small primary', type: 'button', onclick: doTakeover }, '진행 넘겨받기'),
          h('button', { class: 'btn small danger-ghost', type: 'button', onclick: abortGame }, '게임 중단하고 정리')));
      return;
    }
    if (S.driver) S.driver.renderControl(body, gs);
  }

  function phaseText(gs) {
    const map = { play: '진행 중', closing: '마무리 중', final: '최종 결과', answering: '답 쓰는 중', reveal: '정답 공개', vote: '카드 투표', result: '결과', fill: '정리 중' };
    return `${map[gs.phase] || gs.phase}${gs.round ? ` · ${gs.round}` : ''}`;
  }

  async function doTakeover() { try { await G.takeover(T.code, T.tabId); toast('이 창에서 진행해요.', 'ok'); } catch (e) { handleError(e, { teacher: true }); } }

  async function cancelConfirm() { try { await G.resetToIdle(T.code); } catch (e) { handleError(e, { teacher: true }); } }

  async function closeFinal() {
    await host.close();
    toast('결과를 닫았어요. 임시 기록을 정리했어요.', 'ok');
  }

  async function abortGame() {
    const ok = await confirmDialog({ title: '게임을 중단할까요?', message: '지금까지의 게임 기록은 사라지고 학생 화면은 홈으로 돌아가요.', okText: '게임 중단', danger: true });
    if (!ok) return;
    await host.close();
    toast('게임을 중단했어요.', 'ok');
  }

  /* ── 개인 점수 순위(발표 창 전용) ── */
  host.setRanking = (on) => G.setRankingMode(T.code, on);
  host.groupScores = () => S.scores;
  host.attachControl = attachControl;
  host.cancelConfirm = cancelConfirm;
  host.dispose = () => {
    S.offs.forEach((o) => o());
    document.removeEventListener('visibilitychange', onVisibility);
    if (S.driver) S.driver.dispose();
    S.stateSubs.splice(0).forEach((u) => u());
    S.gameSubs.splice(0).forEach((u) => u());
    if (S.stopCountdown) S.stopCountdown();
    stopTicker();
    keepAwake(false);
    setBanner('hiddenwarn', null);
  };
  onRoom();
  return host;
}

/* ═════════════════════════ [게임] 탭 ═════════════════════════ */
export function mountGamesTab(box, T) {
  const host = T.games;
  const body = h('div');
  mount(box, body);
  const picked = new Set();      // "응답 없음"인데 선생님이 직접 넣기로 한 학생
  let selected = ORDER[0];
  let formApi = null;
  let lastGameKey = '';
  let timer = null;

  const offs = [T.on('room', onRoom), T.on('students', () => { if (T.room.gameState.mode === 'confirm') drawConfirm(); })];
  onRoom();

  function onRoom() {
    const gs = T.room.gameState;
    const key = `${gs.mode}:${gs.gameId}:${gs.seq}`;
    if (key === lastGameKey) return;
    lastGameKey = key;
    draw();
  }

  function draw() {
    clearInterval(timer);
    const gs = T.room.gameState;
    if (G.isGameMode(gs.mode)) {
      mount(body, h('section', { class: 'card' }, mascot(72, 'wow'), h('h3', null, '게임이 진행 중이에요'), h('p', { class: 'muted' }, '위쪽의 진행 카드에서 조작해요. 게임이 끝나면 여기서 새 게임을 시작할 수 있어요.')));
      return;
    }
    if (gs.mode === 'confirm') { drawConfirm(true); return; }
    mount(body, h('section', { class: 'card' },
      h('h3', null, '1. 참가자 확인'),
      h('p', { class: 'muted' }, '게임을 시작하기 전에 지금 화면이 켜져 있는 학생을 확인해요. 학생 화면은 자동으로 응답해요. 약 10초 걸려요.'),
      h('button', { class: 'btn primary big', type: 'button', dataset: { act: 'confirm' }, onclick: startConfirm }, '참가자 확인 시작'),
      gs.mode === 'ranking' ? h('p', { class: 'muted' }, '(TV의 개인 점수 순위가 내려가요)') : null));
  }

  async function startConfirm() {
    try { picked.clear(); const id = await G.beginConfirm(T.code, T.tabId); if (!id) toast('지금은 참가자 확인을 시작할 수 없어요.', 'warn'); }   // [읽기][쓰기]
    catch (e) { handleError(e, { teacher: true }); }
  }

  /* ── 참가자 확인 결과 + 게임 고르기 ──
     화면 뼈대(buildConfirm)는 한 번만 만들고, 학생 응답이 들어올 때는 확인 카드(refreshConfirm)만 새로 그려요.
     그래야 선생님이 게임 설정을 입력하는 중에 입력칸이 지워지지 않아요. */
  let ui = null;   // { confirmCard, groupInfo, startBtn, formBox }

  function currentParticipants() {
    const gs = T.room.gameState;
    const pingId = gs.payload && gs.payload.pingId;
    const nowMs = D.now();
    const sorted = G.sortByJoin(T.students);
    const confirmed = sorted.filter((s) => s.pingId === pingId);
    const idle = sorted.filter((s) => s.pingId !== pingId && nowMs - toMs(s.lastSeen) < PRESENCE_WINDOW_MS);
    const participants = [...confirmed.map((s) => s.id), ...idle.filter((s) => picked.has(s.id)).map((s) => s.id)];
    return { confirmed, idle, participants, waiting: nowMs < gs.phaseEndsAt };
  }

  function drawConfirm(rebuild) {
    if (T.room.gameState.mode !== 'confirm') return;
    if (!ui || rebuild || !body.contains(ui.confirmCard)) buildConfirm(); else refreshConfirm();
  }

  function buildConfirm() {
    const def = GAMES[selected];
    const confirmCard = h('section', { class: 'card', dataset: { part: 'confirm' } });
    const groupInfo = h('div', { class: 'chips' });
    const formBox = h('div', { class: 'game-form-inner' });
    const startBtn = h('button', { class: 'btn primary big', type: 'button', dataset: { act: 'start' }, onclick: start }, '게임 시작');
    const gamesCard = h('section', { class: 'card', dataset: { part: 'games' } }, h('h3', null, '2. 게임 고르기'),
      h('div', { class: 'game-picks' }, ORDER.map((k) => h('button', {
        class: `game-pick ${selected === k ? 'on' : ''}`, type: 'button', dataset: { game: k },
        onclick: () => { selected = k; formApi = null; drawConfirm(true); }
      }, h('span', { class: 'gp-icon' }, GAMES[k].icon), h('strong', null, GAMES[k].label), h('span', { class: 'muted' }, GAMES[k].desc)))),
      h('div', { class: 'game-form' }, formBox, groupInfo, startBtn));
    mount(body, confirmCard, gamesCard);
    formApi = def.renderForm(formBox, T, formApi ? formApi.read() : undefined);
    ui = { confirmCard, groupInfo, startBtn, formBox };
    refreshConfirm();
  }

  function refreshConfirm() {
    const gs = T.room.gameState;
    const def = GAMES[selected];
    const groupCount = T.room.settings.groupCount;
    const { confirmed, idle, participants, waiting } = currentParticipants();
    const plan = G.planGroups(T.students, participants, groupCount);
    const cdEl = h('strong', { class: 'timer-chip' });
    const list = (arr, withCheck) => h('div', { class: 'chips' }, arr.map((s) => withCheck
      ? h('label', { class: 'chip-check' }, h('input', { type: 'checkbox', checked: picked.has(s.id), onchange: (e) => { if (e.target.checked) picked.add(s.id); else picked.delete(s.id); refreshConfirm(); } }), ` ${s.nickname} (${s.groupId || '-'}모둠)`)
      : h('span', { class: 'chip ok' }, `${s.nickname} (${s.groupId || '-'}모둠)`)));
    mount(ui.confirmCard,
      h('div', { class: 'row-between' }, h('h3', null, '1. 참가자 확인'),
        h('div', { class: 'chips' }, h('button', { class: 'btn small ghost', type: 'button', dataset: { act: 'reping' }, onclick: startConfirm }, '다시 확인'), h('button', { class: 'btn small ghost', type: 'button', onclick: () => host.cancelConfirm() }, '취소'))),
      waiting ? h('p', { class: 'muted' }, '학생 화면의 응답을 기다리고 있어요… ', cdEl, '초') : h('p', { class: 'muted' }, '확인이 끝났어요.'),
      h('div', { class: 'chips' }, h('span', { class: 'chip ok', dataset: { stat: 'confirmed' } }, `확인됨 ${confirmed.length}명`), h('span', { class: 'chip', dataset: { stat: 'idle' } }, `응답 없음 ${idle.length}명`)),
      confirmed.length ? list(confirmed, false) : null,
      idle.length ? h('div', null, h('p', { class: 'muted' }, '응답은 없지만 최근 접속한 학생이에요(화면이 꺼진 태블릿일 수 있어요). 체크하면 참가자에 넣어요.'), list(idle, true)) : null);
    if (waiting) startCountdown(cdEl, gs.phaseEndsAt, { tick: false, onZero: () => { if (T.room.gameState.mode === 'confirm') refreshConfirm(); } });

    clear(ui.groupInfo);
    if (def.scope === 'group') {
      for (let g = 1; g <= groupCount; g++) {
        const n = plan.groups[g].length;
        ui.groupInfo.append(h('span', { class: `chip ${n >= 3 ? 'ok' : 'warn'}`, dataset: { ginfo: String(g) } }, `${g}모둠 ${n}명${n >= 3 ? '' : n === 0 ? ' (없음)' : ' (3명 미만이라 참여 불가)'}`));
      }
      if (plan.noGroup.length) ui.groupInfo.append(h('span', { class: 'chip warn' }, `모둠 미선택 ${plan.noGroup.length}명은 제외돼요`));
    } else ui.groupInfo.append(h('span', { class: 'chip ok', dataset: { ginfo: 'all' } }, `참가자 ${participants.length}명`));
    ui.startBtn.disabled = waiting || !participants.length;
  }

  async function start() {
    const gs = T.room.gameState;
    if (gs.mode !== 'confirm') return;
    const def = GAMES[selected];
    const groupCount = T.room.settings.groupCount;
    const { participants } = currentParticipants();
    ui.startBtn.disabled = true;
    try {
      const opts = formApi.read();
      const plan = G.planGroups(T.students, participants, groupCount);
      const useGroups = def.scope === 'group' ? plan.valid : [];
      if (def.scope === 'group' && !useGroups.length) { toast('3명 이상 모인 모둠이 없어서 시작할 수 없어요.', 'warn'); ui.startBtn.disabled = false; return; }
      await T.data.flushBeforeGame();   // [쓰기] 저장 대기 중인 번들을 먼저 저장
      const prepared = await def.prepare(T, opts, { participants, plan, useGroups });
      if (prepared.error) { toast(prepared.error, 'warn'); ui.startBtn.disabled = false; return; }
      if (prepared.notes && prepared.notes.length) {
        const go = await confirmDialog({ title: '이대로 시작할까요?', message: prepared.notes.join('\n'), okText: '시작' });
        if (!go) { ui.startBtn.disabled = false; return; }
      }
      const gameId = G.newGameId();
      if (prepared.setup) await prepared.setup(gameId);   // [쓰기] 게임용 문서를 미리 만들어요
      const payload = { participants, names: plan.names, groups: def.scope === 'group' ? Object.fromEntries(useGroups.map((g) => [g, plan.groups[g]])) : null, ...prepared.payload };
      const ok = await G.startGame(T.code, T.room.gameState.seq, T.tabId, { mode: def.mode, phase: prepared.phase, round: prepared.round || 0, phaseEndsAt: prepared.phaseEndsAt || null, gameId, payload }, prepared.settingsPatch || {});
      if (!ok) { toast('상태가 바뀌어서 시작하지 못했어요. 다시 시도해 주세요.', 'warn'); ui.startBtn.disabled = false; }
    } catch (e) { handleError(e, { teacher: true }); if (ui) ui.startBtn.disabled = false; }
  }

  return () => { offs.forEach((o) => o()); clearInterval(timer); };
}
