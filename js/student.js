// js/student.js — 학생 화면: 방 코드 → 닉네임·모둠 → 입장 → 홈
// 자동 재입장(기간 제한 없음), 모둠 다시 고르기, [나가기], 접속 신호(하트비트)

import {
  h, mount, parseRoomCode, validateNickname, storeSetJson, storeRemove
} from './core.js';
import { HEARTBEAT_MS, TIMES } from './config.js';
import {
  GROUPS, groupBadge, mascot, toast, confirmDialog, showModal, handleError, initSound, soundToggleButton, topBar
} from './ui.js';
import * as D from './db.js';

const SAVED_KEY = 'malrang_student';   // 이 태블릿에 기억해 두는 {방 코드, 닉네임, 학생 ID}

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
  }

  // 지금 입장해 있는 방의 정보
  const S = { code: '', id: '', nickname: '', room: null, me: null, epoch: null, regroupModal: null, lastBeat: 0, hiddenAt: 0 };

  // 홈 화면의 틀(맨 위 띠와 상태 카드). 입장 전에 미리 만들어 둬요
  const headerBox = h('div');
  const statusBox = h('section', { class: 'card status-card' });

  if (autoSaved) autoReenter(autoSaved); else showCodeStep(prefillRoom);

  /* ═════════ 1단계: 방 코드 입력 ═════════ */
  function showCodeStep(prefill = '', message = '') {
    cleanup();
    const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' }, message);
    const input = h('input', {
      class: 'input code-input', type: 'text', maxlength: '8', autocomplete: 'off', autocapitalize: 'characters',
      placeholder: 'ABC234', value: prefill, 'aria-label': '방 코드 6글자'
    });
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
      } catch (e) {
        handleError(e, { retry: lookup });
        nextBtn.disabled = false;
      }
    }
    input.addEventListener('input', () => { input.value = input.value.toUpperCase(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookup(); });

    mount(root, h('main', { class: 'screen center' },
      h('div', { class: 'card center-card' },
        mascot(96), h('h2', null, '방에 들어가요'), h('p', { class: 'muted' }, '선생님이 알려 준 방 코드를 입력해 주세요.'),
        input, msg, nextBtn,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { cleanup(); onHome(); } }, '처음으로'))));
    input.focus();
    if (prefill) lookup();   // QR로 들어오면 바로 다음 단계로
  }

  /* ═════════ 2단계: 닉네임과 모둠 고르기 ═════════ */
  function showNameStep(code, room) {
    const groupCount = room.settings.groupCount;
    let chosen = 0;
    const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' });
    const nickInput = h('input', {
      class: 'input', type: 'text', maxlength: '10', autocomplete: 'off', placeholder: '닉네임 (10글자까지)', 'aria-label': '닉네임'
    });
    const buttons = Array.from({ length: groupCount }, (_, i) => {
      const g = GROUPS[i + 1];
      const btn = h('button', {
        class: 'group-btn', type: 'button', style: { '--gc': g.color }, 'aria-label': `${g.n}모둠`,
        onclick: () => { chosen = g.n; buttons.forEach((b, j) => b.classList.toggle('selected', j === i)); }
      }, h('span', { class: 'gicon' }, g.icon), h('strong', null, `${g.n}모둠`));
      return btn;
    });
    const enterBtn = h('button', { class: 'btn primary big', type: 'button', onclick: submit }, '입장하기');

    async function submit() {
      const v = validateNickname(nickInput.value);
      if (!v.ok) { msg.textContent = v.message; return; }
      if (!chosen) { msg.textContent = '우리 모둠을 골라 주세요.'; return; }
      msg.textContent = '';
      enterBtn.disabled = true;
      try {
        await tryEnter(code, room, v, chosen);
      } catch (e) {
        handleError(e, { retry: submit });
      }
      enterBtn.disabled = false;
    }
    nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) submit(); });

    mount(root, h('main', { class: 'screen center' },
      h('div', { class: 'card center-card wide' },
        mascot(72), h('h2', null, room.roomName), h('p', { class: 'muted' }, `방 코드 ${code}`),
        h('div', { class: 'form-col' }, h('label', null, '닉네임'), nickInput),
        h('div', { class: 'form-col' }, h('label', null, '우리 모둠'), h('div', { class: 'group-btns' }, buttons)),
        msg, enterBtn,
        h('button', { class: 'btn ghost', type: 'button', onclick: () => showCodeStep('') }, '다른 방 코드 입력'))));
    nickInput.focus();
  }

  /** 이미 같은 닉네임이 있으면 확인창, 없으면 새로 만들어서 들어가요. */
  async function tryEnter(code, room, v, groupId) {
    const existing = await D.getStudent(code, v.id);   // [읽기]
    if (existing.exists()) {
      await enterExisting(code, room, v, groupId, existing.data());
      return;
    }
    const { created } = await D.createStudentIfAbsent(code, v.id, v.nickname, groupId);   // [읽기][쓰기]
    if (created) {
      await enterRoom(code, v.id, v.nickname, room);
    } else {
      // 거의 동시에 같은 닉네임을 쓴 친구가 있었어요
      const again = await D.getStudent(code, v.id);
      await enterExisting(code, room, v, groupId, again.data());
    }
  }

  async function enterExisting(code, room, v, groupId, data) {
    const ok = await confirmDialog({
      title: '이미 있는 닉네임이에요', message: '본인이라면 계속 입장하세요. 다른 친구의 이름이라면 [다른 이름]을 눌러 주세요.',
      okText: '입장', cancelText: '다른 이름'
    });
    if (!ok) return;
    if (data.groupId >= 1 && data.groupId <= room.settings.groupCount && data.groupId !== groupId) {
      toast(`저장되어 있던 ${data.groupId}모둠으로 입장했어요.`, 'info', { ms: 4000 });
    }
    await enterRoom(code, v.id, data.nickname || v.nickname, room);
  }

  /* ═════════ 자동 재입장 ═════════ */
  async function autoReenter(saved) {
    mount(root, h('main', { class: 'screen center' }, h('div', { class: 'card center-card' }, mascot(80), h('p', null, '다시 들어가는 중이에요…'))));
    try {
      const roomSnap = await D.getRoom(saved.room);   // [읽기]
      const meSnap = roomSnap.exists() ? await D.getStudent(saved.room, saved.id) : null;   // [읽기]
      if (!roomSnap.exists() || !meSnap.exists()) {
        storeRemove(SAVED_KEY);
        showCodeStep(prefillRoom, roomSnap.exists() ? '' : '저장되어 있던 방이 사라졌어요. 새 방 코드를 입력해 주세요.');
        return;
      }
      await enterRoom(saved.room, saved.id, meSnap.data().nickname || saved.nickname, roomSnap.data(), { auto: true });
    } catch (e) {
      handleError(e, { retry: () => autoReenter(saved) });
      showCodeStep(prefillRoom);
    }
  }

  /* ═════════ 입장 → 홈 ═════════ */
  async function enterRoom(code, id, nickname, room, opts = {}) {
    cleanup();
    Object.assign(S, { code, id, nickname, room, me: null, epoch: null, regroupModal: null, lastBeat: Date.now(), hiddenAt: 0 });
    storeSetJson(SAVED_KEY, { room: code, nickname, id });

    // 서버 시계 보정 (3-4): 내 문서의 lastSeen에 서버 시각을 남기고 다시 읽어요
    try {
      await D.syncClock(() => D.touchStudent(code, id), D.studentRef(code, id), 'lastSeen');   // [쓰기][읽기]
    } catch (e) { handleError(e, {}); }

    await refreshMe();   // 내 모둠 정보를 먼저 읽어 두면 화면이 "모둠 미선택"으로 깜빡이지 않아요
    showHome();
    if (opts.auto) toast(`‘${room.roomName}’ 방에 입장했어요.`, 'ok', { ms: 3500 });

    // 방 문서 듣기: 게임 상태, 모둠 수 변경, 방 삭제를 알아차려요 (3-15)
    unsubs.push(D.onSnapshot(D.roomRef(code), (snap) => {   // [읽기] 처음 1번 + 바뀔 때마다
      if (!snap.exists()) { showRoomDeleted(); return; }
      S.room = snap.data();
      const epoch = S.room.settings.groupEpoch || 0;
      if (S.epoch !== null && S.epoch !== epoch) refreshMe();   // 모둠 수가 바뀌었어요 → 내 정보를 다시 읽어요
      S.epoch = epoch;
      renderHeader();
      renderStatus();
    }, (e) => handleError(e, {})));

    timers.push(setInterval(heartbeat, HEARTBEAT_MS));
    document.addEventListener('visibilitychange', onVisibility);
  }

  /** 내 학생 문서를 다시 읽어요(모둠 번호가 바뀌었는지 확인) */
  async function refreshMe() {
    try {
      const snap = await D.getStudent(S.code, S.id);   // [읽기]
      if (!snap.exists()) { storeRemove(SAVED_KEY); showRoomDeleted(); return; }
      S.me = snap.data();
      renderHeader();
      ensureGroup();
    } catch (e) { handleError(e, {}); }
  }

  /** 모둠이 없거나(모둠 수가 바뀐 뒤) 범위를 벗어나면 다시 고르게 해요 (2-4) */
  function ensureGroup() {
    const gc = S.room.settings.groupCount;
    const ok = S.me && S.me.groupId >= 1 && S.me.groupId <= gc;
    if (ok) {
      if (S.regroupModal) { S.regroupModal.close(); S.regroupModal = null; }
      return;
    }
    if (S.regroupModal) return;
    const buttons = Array.from({ length: gc }, (_, i) => {
      const g = GROUPS[i + 1];
      return h('button', {
        class: 'group-btn', type: 'button', style: { '--gc': g.color }, 'aria-label': `${g.n}모둠`,
        onclick: async () => {
          try {
            await D.setStudentGroup(S.code, S.id, g.n);   // [쓰기]
            S.me = { ...S.me, groupId: g.n };
            S.regroupModal.close();
            S.regroupModal = null;
            renderHeader();
            toast(`${g.n}모둠으로 정했어요!`, 'ok');
          } catch (e) { handleError(e, {}); }
        }
      }, h('span', { class: 'gicon' }, g.icon), h('strong', null, `${g.n}모둠`));
    });
    S.regroupModal = showModal(h('div', { class: 'center-col' },
      mascot(72, 'wow'), h('h3', null, '모둠이 바뀌었어요!'), h('p', { class: 'dialog-msg' }, '새 모둠을 골라 주세요.'),
      h('div', { class: 'group-btns' }, buttons)), { dismissable: false });
  }

  /* ═════════ 접속 신호(하트비트) ═════════ */
  async function heartbeat() {
    S.lastBeat = Date.now();
    try {
      await D.touchStudent(S.code, S.id);   // [쓰기] 5분에 1번
      await refreshMe();   // [읽기] 5분에 1번 (교사가 모둠을 바꿨는지 확인)
    } catch (e) { handleError(e, {}); }
  }

  async function onVisibility() {
    if (document.visibilityState === 'hidden') { S.hiddenAt = Date.now(); return; }
    // 화면이 다시 보여요
    const hiddenFor = S.hiddenAt ? Date.now() - S.hiddenAt : 0;
    S.hiddenAt = 0;
    try {
      if (hiddenFor >= TIMES.resyncHiddenMs) {
        await D.syncClock(() => D.touchStudent(S.code, S.id), D.studentRef(S.code, S.id), 'lastSeen');   // 오래 숨겨졌으면 시계를 다시 맞춰요
        S.lastBeat = Date.now();
        await refreshMe();
      } else if (Date.now() - S.lastBeat > 60000) {
        await heartbeat();
      }
    } catch (e) { handleError(e, {}); }
  }

  /* ═════════ 홈 화면 ═════════ */
  function showHome() {
    const upcoming = ['단어 내기', '문제 내기', '공부하기', '단어 카드'];
    mount(root, h('main', { class: 'screen' },
      headerBox, statusBox,
      h('section', { class: 'card' },
        h('h3', null, '곧 열려요'),
        h('div', { class: 'tile-grid' }, upcoming.map((t) => h('div', { class: 'tile disabled' }, h('strong', null, t), h('span', { class: 'muted' }, '다음 단계에서 열려요')))))));
    renderHeader();
    renderStatus();
  }

  function renderHeader() {
    mount(headerBox, topBar({
      title: S.room ? S.room.roomName : '', sub: S.nickname,
      right: [
        groupBadge(S.me ? S.me.groupId : null), soundToggleButton(),
        h('button', { class: 'btn small ghost', type: 'button', onclick: leave }, '나가기')
      ]
    }));
  }

  function renderStatus() {
    if (!S.room) return;
    const mode = S.room.gameState.mode;
    if (mode === 'idle' || mode === 'ranking') {
      mount(statusBox, mascot(88), h('h3', null, '선생님을 기다리고 있어요'), h('p', { class: 'muted' }, '게임이 시작되면 화면이 저절로 바뀌어요.'));
    } else {
      mount(statusBox, mascot(88, 'wow'), h('h3', null, '게임이 시작됐어요!'), h('p', { class: 'muted' }, '게임 화면은 다음 단계에서 만들어져요.'));
    }
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

  function showRoomDeleted() {
    storeRemove(SAVED_KEY);
    cleanup();
    if (S.regroupModal) { S.regroupModal.close(); S.regroupModal = null; }
    mount(root, h('main', { class: 'screen center' },
      h('div', { class: 'card center-card' }, mascot(96, 'wow'), h('h2', null, '방이 삭제되었어요'),
        h('p', { class: 'muted' }, '선생님이 방을 지웠어요.'),
        h('button', { class: 'btn primary big', type: 'button', onclick: onHome }, '처음으로'))));
  }
}
