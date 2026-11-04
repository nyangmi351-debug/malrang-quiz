// js/student.js — 학생 화면: 방 코드 → 닉네임·모둠 → 입장 → 홈(단어·문제·공부하기) / 게임 화면 자동 전환
// 자동 재입장(기간 제한 없음), 모둠 다시 고르기, [나가기], 접속 신호(하트비트), 참가자 확인 자동 응답

import { h, mount, parseRoomCode, validateNickname, storeSetJson, storeRemove } from './core.js';
import { HEARTBEAT_MS, TIMES } from './config.js';
import {
  GROUPS, groupBadge, mascot, toast, confirmDialog, showModal, handleError, initSound, soundToggleButton, topBar, setBanner, keepAwake
} from './ui.js';
import * as D from './db.js';
import { screenWordNew, screenMyCards, screenMyWords, screenQuestionNew, screenMyQuestions } from './student-input.js';
import { screenStudy, screenCards } from './study.js';
import { createGameScreen } from './gamescreen.js';

const SAVED_KEY = 'malrang_student';   // 이 태블릿에 기억해 두는 {방 코드, 닉네임, 학생 ID}
const GAME_MODES = ['live', 'tele', 'speed_group', 'speed_all'];

const TILES = [
  ['wordNew', '단어 내기', '✏️', screenWordNew], ['myCards', '내 단어 카드', '🗂️', screenMyCards], ['myWords', '내가 낸 단어', '📚', screenMyWords],
  ['questionNew', '문제 내기', '❓', screenQuestionNew], ['myQuestions', '내가 낸 문제', '📝', screenMyQuestions],
  ['study', '공부하기', '🎯', screenStudy], ['cards', '단어 카드', '🃏', screenCards]
];

/**
 * opts.prefillRoom : QR로 들어온 방 코드(입력칸에 미리 채움)
 * opts.autoSaved   : 저장된 {room, nickname, id}가 있으면 자동 재입장을 시도
 */
export function startStudent(root, { onHome, prefillRoom = '', autoSaved = null }) {
  initSound('student');

  let unsubs = [];
  let timers = [];
  function cleanup() {
    unsubs.forEach((u) => u());
    unsubs = [];
    timers.forEach((t) => clearInterval(t));
    timers = [];
    document.removeEventListener('visibilitychange', onVisibility);
    closeScreen();
    destroyGame();
    keepAwake(false);
    setBanner('ping', null);
  }

  // 지금 입장해 있는 방의 정보
  const S = { code: '', id: '', nickname: '', room: null, me: null, epoch: null, regroupModal: null, lastBeat: 0, hiddenAt: 0, screen: 'home', lastPing: '', gameKey: '' };
  // 화면(단어 내기 등)이 함께 쓰는 보관함. drafts에는 입력하던 글이 들어 있어서, 게임이 끝나면 되살려요 (3-15)
  const SC = {
    drafts: {},
    get code() { return S.code; }, get id() { return S.id; }, get nickname() { return S.nickname; },
    room: () => S.room, me: () => S.me, refreshMe: () => refreshMe()
  };
  let goneHandled = false;   // (반드시 위쪽에 둬요: 아래 함수들이 자동 재입장 중에 불릴 수 있어요)
  const headerBox = h('div');
  const statusBox = h('section', { class: 'card status-card' });
  let screenDispose = null;
  let gameScreen = null;

  if (autoSaved) autoReenter(autoSaved); else showCodeStep(prefillRoom);

  /* ═════════ 1단계: 방 코드 입력 ═════════ */
  function showCodeStep(prefill = '', message = '') {
    cleanup();
    const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' }, message);
    const input = h('input', { class: 'input code-input', type: 'text', maxlength: '8', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'ABC234', value: prefill, 'aria-label': '방 코드 6글자' });
    const nextBtn = h('button', { class: 'btn primary big', type: 'button', onclick: lookup }, '다음');
    async function lookup() {
      const { code, valid, hasBadChar } = parseRoomCode(input.value);
      if (hasBadChar) { msg.textContent = '0(영), O(오), 1(일), I(아이)는 방 코드에 쓰지 않는 글자예요. 다시 확인해 주세요.'; return; }
      if (!valid) { msg.textContent = '방 코드는 6글자예요.'; return; }
      msg.textContent = '';
      nextBtn.disabled = true;
      try {
        const snap = await D.getRoom(code);   // [읽기]
        if (!snap.exists()) { msg.textContent = '방을 찾을 수 없어요. 코드를 다시 확인해 주세요.'; nextBtn.disabled = false; return; }
        showNameStep(code, snap.data());
      } catch (e) { handleError(e, { retry: lookup }); nextBtn.disabled = false; }
    }
    input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });
    mount(root, h('main', { class: 'screen center' },
      h('div', { class: 'card center-card' }, mascot(96), h('h2', null, '방에 들어가요'), h('p', { class: 'muted' }, '선생님이 알려 준 방 코드를 입력해 주세요.'),
        input, msg, nextBtn, h('button', { class: 'btn ghost', type: 'button', onclick: () => { cleanup(); onHome(); } }, '처음으로'))));
    input.focus();
    if (prefill) lookup();   // QR로 들어오면 바로 다음 단계로
  }

  /* ═════════ 2단계: 닉네임과 모둠 고르기 ═════════ */
  function showNameStep(code, room) {
    const groupCount = room.settings.groupCount;
    let chosen = 0;
    const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' });
    const nickInput = h('input', { class: 'input', type: 'text', maxlength: '10', autocomplete: 'off', placeholder: '닉네임 (10글자까지)', 'aria-label': '닉네임' });
    const buttons = Array.from({ length: groupCount }, (_, i) => {
      const g = GROUPS[i + 1];
      return h('button', {
        class: 'group-btn', type: 'button', style: { '--gc': g.color }, 'aria-label': `${g.n}모둠`,
        onclick: () => { chosen = g.n; buttons.forEach((b, j) => b.classList.toggle('selected', j === i)); }
      }, h('span', { class: 'gicon' }, g.icon), h('strong', null, `${g.n}모둠`));
    });
    const enterBtn = h('button', { class: 'btn primary big', type: 'button', onclick: submit }, '입장하기');
    async function submit() {
      const v = validateNickname(nickInput.value);
      if (!v.ok) { msg.textContent = v.message; return; }
      if (!chosen) { msg.textContent = '우리 모둠을 골라 주세요.'; return; }
      msg.textContent = '';
      enterBtn.disabled = true;
      try { await tryEnter(code, room, v, chosen); } catch (e) { handleError(e, { retry: submit }); }
      enterBtn.disabled = false;
    }
    nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) submit(); });
    mount(root, h('main', { class: 'screen center' },
      h('div', { class: 'card center-card wide' }, mascot(72), h('h2', null, room.roomName), h('p', { class: 'muted' }, `방 코드 ${code}`),
        h('div', { class: 'form-col' }, h('label', null, '닉네임'), nickInput),
        h('div', { class: 'form-col' }, h('label', null, '우리 모둠'), h('div', { class: 'group-btns' }, buttons)),
        msg, enterBtn, h('button', { class: 'btn ghost', type: 'button', onclick: () => showCodeStep('') }, '다른 방 코드 입력'))));
    nickInput.focus();
  }

  async function tryEnter(code, room, v, groupId) {
    const existing = await D.getStudent(code, v.id);   // [읽기]
    if (existing.exists()) { await enterExisting(code, room, v, groupId, existing.data()); return; }
    const { created } = await D.createStudentIfAbsent(code, v.id, v.nickname, groupId);   // [읽기][쓰기]
    if (created) await enterRoom(code, v.id, v.nickname, room);
    else { const again = await D.getStudent(code, v.id); await enterExisting(code, room, v, groupId, again.data()); }
  }

  async function enterExisting(code, room, v, groupId, data) {
    const ok = await confirmDialog({
      title: '이미 있는 닉네임이에요', message: '본인이라면 계속 입장하세요. 다른 친구의 이름이라면 [다른 이름]을 눌러 주세요.', okText: '입장', cancelText: '다른 이름'
    });
    if (!ok) return;
    if (data.groupId >= 1 && data.groupId <= room.settings.groupCount && data.groupId !== groupId) toast(`저장되어 있던 ${data.groupId}모둠으로 입장했어요.`, 'info', { ms: 4000 });
    await enterRoom(code, v.id, data.nickname || v.nickname, room);
  }

  async function autoReenter(saved) {
    mount(root, h('main', { class: 'screen center' }, h('div', { class: 'card center-card' }, mascot(80), h('p', null, '다시 들어가는 중이에요…'))));
    try {
      const roomSnap = await D.getRoom(saved.room);   // [읽기]
      const meSnap = roomSnap.exists() ? await D.getStudent(saved.room, saved.id) : null;   // [읽기]
      if (!roomSnap.exists() || !meSnap.exists()) {
        storeRemove(SAVED_KEY);
        if (roomSnap.exists()) {   // 선생님이 내보냈거나 학생 기록이 지워진 경우: 같은 방의 이름 입력 화면으로 바로 안내해요
          showCodeStep(saved.room);
          toast('이 방에서 이름이 지워져 있어요. 올바른 이름으로 다시 입장해 주세요.', 'info', { ms: 6000 });
        } else showCodeStep(prefillRoom, '저장되어 있던 방이 사라졌어요. 새 방 코드를 입력해 주세요.');
        return;
      }
      await enterRoom(saved.room, saved.id, meSnap.data().nickname || saved.nickname, roomSnap.data(), { auto: true });
    } catch (e) { handleError(e, { retry: () => autoReenter(saved) }); showCodeStep(prefillRoom); }
  }

  /* ═════════ 입장 → 홈 ═════════ */
  async function enterRoom(code, id, nickname, room, opts = {}) {
    cleanup();
    Object.assign(S, { code, id, nickname, room, me: null, epoch: null, regroupModal: null, lastBeat: Date.now(), hiddenAt: 0, screen: 'home', lastPing: '', gameKey: '' });
    SC.drafts = {};
    storeSetJson(SAVED_KEY, { room: code, nickname, id });
    try { await D.syncClock(() => D.touchStudent(code, id), D.studentRef(code, id), 'lastSeen'); }   // [쓰기][읽기] 서버 시계 보정 (3-4)
    catch (e) { handleError(e, {}); }
    await refreshMe();
    onRoomUpdate(true);
    if (opts.auto) toast(`‘${room.roomName}’ 방에 입장했어요.`, 'ok', { ms: 3500 });

    unsubs.push(D.onSnapshot(D.roomRef(code), (snap) => {   // [읽기] 처음 1번 + 바뀔 때마다
      if (!snap.exists()) { showRoomDeleted(); return; }
      S.room = snap.data();
      const epoch = S.room.settings.groupEpoch || 0;
      if (S.epoch !== null && S.epoch !== epoch) refreshMe();   // 모둠 수가 바뀌었어요 → 내 정보를 다시 읽어요
      S.epoch = epoch;
      onRoomUpdate(false);
    }, (e) => handleError(e, {})));
    // 내 학생 문서를 지켜봐요: 선생님이 내보내면(문서가 사라지면) 바로 안내 화면으로 가요 [읽기] 처음 1번 + 내 문서가 바뀔 때만
    unsubs.push(D.onSnapshot(D.studentRef(code, id), (snap) => {
      if (snap.exists() || (snap.metadata && snap.metadata.fromCache)) return;   // 인터넷이 끊겨서 비어 보이는 경우는 무시해요
      onStudentGone();
    }, (e) => console.error('[내 문서 듣기 오류]', e)));
    timers.push(setInterval(heartbeat, HEARTBEAT_MS));
    document.addEventListener('visibilitychange', onVisibility);
  }

  async function refreshMe() {
    try {
      const snap = await D.getStudent(S.code, S.id);   // [읽기]
      if (!snap.exists()) { await onStudentGone(); return; }
      S.me = snap.data();
      renderHeader();
      ensureGroup();
    } catch (e) { handleError(e, {}); }
  }

  function ensureGroup() {
    const gc = S.room.settings.groupCount;
    const ok = S.me && S.me.groupId >= 1 && S.me.groupId <= gc;
    if (ok) { if (S.regroupModal) { S.regroupModal.close(); S.regroupModal = null; } return; }
    if (S.regroupModal) return;
    const buttons = Array.from({ length: gc }, (_, i) => {
      const g = GROUPS[i + 1];
      return h('button', {
        class: 'group-btn', type: 'button', style: { '--gc': g.color }, 'aria-label': `${g.n}모둠`,
        onclick: async () => {
          try {
            await D.setStudentGroup(S.code, S.id, g.n);   // [쓰기]
            S.me = { ...S.me, groupId: g.n };
            S.regroupModal.close(); S.regroupModal = null;
            renderHeader();
            toast(`${g.n}모둠으로 정했어요!`, 'ok');
          } catch (e) { handleError(e, {}); }
        }
      }, h('span', { class: 'gicon' }, g.icon), h('strong', null, `${g.n}모둠`));
    });
    S.regroupModal = showModal(h('div', { class: 'center-col' }, mascot(72, 'wow'), h('h3', null, '모둠이 바뀌었어요!'), h('p', { class: 'dialog-msg' }, '새 모둠을 골라 주세요.'), h('div', { class: 'group-btns' }, buttons)), { dismissable: false });
  }

  /* ═════════ 접속 신호(하트비트) ═════════ */
  async function heartbeat() {
    S.lastBeat = Date.now();
    try { await D.touchStudent(S.code, S.id); await refreshMe(); }   // [쓰기][읽기] 5분에 1번
    catch (e) { handleError(e, {}); }
  }
  async function onVisibility() {
    if (document.visibilityState === 'hidden') { S.hiddenAt = Date.now(); return; }
    const hiddenFor = S.hiddenAt ? Date.now() - S.hiddenAt : 0;
    S.hiddenAt = 0;
    try {
      if (hiddenFor >= TIMES.resyncHiddenMs) {
        await D.syncClock(() => D.touchStudent(S.code, S.id), D.studentRef(S.code, S.id), 'lastSeen');   // 오래 숨겨졌으면 시계를 다시 맞춰요
        S.lastBeat = Date.now();
        await refreshMe();
      } else if (Date.now() - S.lastBeat > 60000) await heartbeat();
    } catch (e) { handleError(e, {}); }
  }

  /* ═════════ 방 문서가 바뀔 때: 게임 전환 규칙 (3-15) ═════════ */
  function onRoomUpdate(initial) {
    const gs = S.room.gameState;
    if (gs.mode === 'confirm') answerPing(gs);
    else setBanner('ping', null);
    if (GAME_MODES.includes(gs.mode)) { showGame(gs); return; }
    if (gameScreen) {   // 게임이 끝났어요 → 보던 화면으로 돌아와요
      const aborted = S.gamePhase !== 'final';   // 결과 화면을 거치지 않고 끝났다면 교사가 중단한 거예요
      destroyGame();
      showScreen(S.screen);
      if (aborted && gs.mode === 'idle') toast('선생님이 게임을 마쳤어요.', 'info', { ms: 4000 });
      return;
    }
    if (initial) showScreen(S.screen);
    else { renderHeader(); renderStatus(); }
  }

  /** 참가자 확인(핑): 화면이 켜져 있으면 자동으로 응답해요 */
  async function answerPing(gs) {
    const pingId = gs.payload && gs.payload.pingId;
    if (!pingId || S.lastPing === pingId) return;
    S.lastPing = pingId;
    setBanner('ping', '참가자 확인 중이에요…');
    try { await D.updateDoc(D.studentRef(S.code, S.id), { lastSeen: D.serverTimestamp(), pingId }); }   // [쓰기]
    catch (e) { handleError(e, {}); }
    setTimeout(() => setBanner('ping', null), 2500);
  }

  function showGame(gs) {
    const key = `${gs.mode}:${gs.gameId}`;
    if (!gameScreen || S.gameKey !== key) {
      closeScreen();
      destroyGame();
      S.gameKey = key;
      keepAwake(true);
      gameScreen = createGameScreen({ role: 'student', code: S.code, getMe: () => ({ id: S.id, nickname: S.nickname, groupId: S.me ? S.me.groupId : null }), getRoom: () => S.room });
      mount(root, h('main', { class: 'screen game-screen' }, headerBox, gameScreen.el));
      renderHeader(true);
    }
    S.gamePhase = gs.phase;
    gameScreen.update(S.room);
  }
  function destroyGame() {
    if (gameScreen) { gameScreen.destroy(); gameScreen = null; }
    S.gameKey = '';
    S.gamePhase = '';
    keepAwake(false);
    renderHeader();
  }

  /* ═════════ 홈 화면과 하위 화면 ═════════ */
  function closeScreen() { if (screenDispose) { try { screenDispose(); } catch (e) { console.error(e); } screenDispose = null; } }

  function showScreen(name) {
    closeScreen();
    S.screen = name;
    if (name === 'home') { showHome(); return; }
    const tile = TILES.find((t) => t[0] === name);
    if (!tile) { showHome(); return; }
    const body = h('div');
    mount(root, h('main', { class: 'screen' }, headerBox, h('div', null, h('button', { class: 'btn small ghost', type: 'button', onclick: () => showScreen('home') }, '← 홈으로')), body));
    renderHeader();
    screenDispose = tile[3](body, SC) || null;
  }

  function showHome() {
    mount(root, h('main', { class: 'screen' }, headerBox, statusBox,
      h('section', { class: 'card' }, h('h3', null, '무엇을 할까요?'),
        h('div', { class: 'tile-grid' }, TILES.map(([key, label, icon]) => h('button', { class: 'tile', type: 'button', dataset: { screen: key }, onclick: () => showScreen(key) },
          h('span', { class: 'tile-icon', 'aria-hidden': 'true' }, icon), h('strong', null, label)))))));
    renderHeader();
    renderStatus();
  }

  function renderHeader(inGame = false) {
    mount(headerBox, topBar({
      title: S.room ? S.room.roomName : '', sub: S.nickname,
      right: [groupBadge(S.me ? S.me.groupId : null), soundToggleButton(), h('button', { class: 'btn small ghost', type: 'button', onclick: leave }, '나가기')]
    }));
  }

  function renderStatus() {
    if (!S.room) return;
    const mode = S.room.gameState.mode;
    if (mode === 'ranking') mount(statusBox, mascot(72), h('h3', null, '공부하기 순위가 TV에 나오고 있어요'), h('p', { class: 'muted' }, 'TV를 봐요!'));
    else mount(statusBox, mascot(72), h('h3', null, '선생님을 기다리고 있어요'), h('p', { class: 'muted' }, '게임이 시작되면 화면이 저절로 바뀌어요. 그 전에는 단어와 문제를 내거나 공부해 봐요.'));
  }

  /* ═════════ 나가기, 방 삭제 ═════════ */
  async function leave() {
    const ok = await confirmDialog({ title: '방에서 나갈까요?', message: '다시 들어오려면 방 코드와 닉네임을 입력하면 돼요.', okText: '나가기' });
    if (!ok) return;
    storeRemove(SAVED_KEY);
    cleanup();
    if (S.regroupModal) { S.regroupModal.close(); S.regroupModal = null; }
    onHome();
  }
  /** 내 학생 문서가 사라졌어요 → 방이 지워진 건지, 선생님이 나를 내보낸 건지 구분해서 안내해요 */
  async function onStudentGone() {
    if (goneHandled) return;
    goneHandled = true;
    const code = S.code;
    let roomAlive = true;
    try { const r = await D.getRoom(code); roomAlive = r.exists(); } catch { /* 확인하지 못하면 내보낸 것으로 봐요 */ }   // [읽기]
    if (!roomAlive) { goneHandled = false; showRoomDeleted(); return; }
    storeRemove(SAVED_KEY);
    cleanup();
    if (S.regroupModal) { S.regroupModal.close(); S.regroupModal = null; }
    goneHandled = false;
    mount(root, h('main', { class: 'screen center' }, h('div', { class: 'card center-card', dataset: { part: 'kicked' } }, mascot(96, 'wow'), h('h2', null, '방에서 나왔어요'),
      h('p', { class: 'muted' }, '선생님이 이 이름을 방에서 퇴출했어요. 이 이름으로 만든 기록은 모두 지워졌어요. 이름을 잘못 썼다면 올바른 이름으로 다시 들어오면 돼요.'),
      h('button', { class: 'btn primary big', type: 'button', dataset: { act: 'rejoin' }, onclick: () => showCodeStep(code) }, '다시 입장하기'),
      h('button', { class: 'btn ghost', type: 'button', onclick: onHome }, '처음으로'))));
  }

  function showRoomDeleted() {
    storeRemove(SAVED_KEY);
    cleanup();
    if (S.regroupModal) { S.regroupModal.close(); S.regroupModal = null; }
    mount(root, h('main', { class: 'screen center' }, h('div', { class: 'card center-card' }, mascot(96, 'wow'), h('h2', null, '방이 삭제되었어요'),
      h('p', { class: 'muted' }, '선생님이 방을 지웠어요.'), h('button', { class: 'btn primary big', type: 'button', onclick: onHome }, '처음으로'))));
  }
}
