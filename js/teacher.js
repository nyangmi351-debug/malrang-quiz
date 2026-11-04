// js/teacher.js — 교사 화면의 뼈대: PIN 로그인/새 PIN 만들기 → 방 목록 → 방 화면(탭)
// PIN은 "아이디" 역할이에요. 선생님마다 자기 PIN으로 로그인하면 자기가 만든 방만 보여요(비밀번호가 아니라서 보안용은 아니에요).

import { h, mount, clear, sessionGet, sessionSet, sessionRemove, getTabId, buildJoinUrl, buildPresentUrl, copyText, renderQr, formatDateTime } from './core.js';
import { APP_VERSION, ROOM_LIST_LIMIT } from './config.js';
import {
  mascot, toast, confirmDialog, showModal, handleError, initSound, soundToggleButton, playSound, SOUND_NAMES, topBar,
  toggleFullscreen, setFooterExtra, tabBar, errorCard
} from './ui.js';
import * as D from './db.js';
import { createTeacherData } from './teacher-data.js';
import { mountStudentsTab } from './teacher-students.js';
import { mountWordsTab } from './teacher-words.js';
import { mountGamesTab, createGameHost } from './teacher-games.js';
import { mountSettingsTab } from './teacher-settings.js';
import { createTestMode } from './testmode.js';

const ROOM_NAME_MAX = 20;
const PIN_KEY = 'malrang_teacher_pin';     // 로그인한 PIN (탭을 닫으면 사라져요)
const ROOM_KEY = 'malrang_teacher_room';   // 지금 열어 둔 방(새로고침해도 이 방으로 돌아오려고 기억해요)
const TAB_KEY = 'malrang_teacher_tab';

export function startTeacher(root, { onHome }) {
  initSound('teacher');
  let cleanups = [];
  function cleanup() { cleanups.forEach((f) => { try { f(); } catch (e) { console.error(e); } }); cleanups = []; }
  let pin = sessionGet(PIN_KEY) || '';

  if (!/^\d{4}$/.test(pin)) showLogin();
  else if (sessionGet(ROOM_KEY)) showRoom(sessionGet(ROOM_KEY));   // 새로고침하면 열어 두었던 방으로 바로 돌아와요
  else showRoomList();

  /* ═════════ 1. 로그인 / 새 PIN 만들기 ═════════ */
  function showLogin(initialMode = 'login') {
    cleanup();
    let mode = initialMode;
    const box = h('div', { class: 'card center-card' });
    const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' });

    function pinInput(label, onDone) {
      const input = h('input', {
        class: 'input pin-input', type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', placeholder: '••••', 'aria-label': label
      });
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); msg.textContent = ''; if (onDone && input.value.length === 4) onDone(); });
      return input;
    }

    function draw() {
      clear(box);
      const seg = h('div', { class: 'seg' },
        h('button', { class: `seg-btn ${mode === 'login' ? 'on' : ''}`, type: 'button', onclick: () => { mode = 'login'; msg.textContent = ''; draw(); } }, '로그인'),
        h('button', { class: `seg-btn ${mode === 'create' ? 'on' : ''}`, type: 'button', onclick: () => { mode = 'create'; msg.textContent = ''; draw(); } }, '새 PIN 만들기'));
      box.append(mascot(88), h('h2', null, '교사용'), seg);

      if (mode === 'login') {
        const input = pinInput('PIN 4자리', login);
        async function login() {
          if (input.value.length !== 4) { msg.textContent = 'PIN 4자리를 입력해 주세요.'; return; }
          try {
            const snap = await D.getTeacher(input.value);   // [읽기]
            if (!snap.exists()) { fail('없는 PIN이에요. [새 PIN 만들기]에서 먼저 만들어 주세요.'); return; }
            pin = input.value;
            sessionSet(PIN_KEY, pin);
            showRoomList();
          } catch (e) { handleError(e, { teacher: true, retry: login }); }
        }
        function fail(text) {
          msg.textContent = text;
          box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
          input.value = ''; input.focus();
        }
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
        box.append(h('p', { class: 'muted' }, '내 PIN 4자리를 입력해 주세요.'), input, msg,
          h('button', { class: 'btn primary big', type: 'button', onclick: login }, '로그인'));
        setTimeout(() => input.focus(), 0);
      } else {
        const nameInput = h('input', { class: 'input', type: 'text', maxlength: '12', placeholder: '이름 (예: 김선생님, 선택)', 'aria-label': '이름' });
        const input = pinInput('새 PIN 4자리');
        const input2 = pinInput('PIN 한 번 더', null);
        async function create() {
          if (input.value.length !== 4) { msg.textContent = '숫자 4자리를 입력해 주세요.'; return; }
          if (input.value !== input2.value) { msg.textContent = '두 번 입력한 PIN이 달라요.'; return; }
          try {
            const r = await D.createTeacher(input.value, nameInput.value.trim());   // [읽기][쓰기]
            if (!r.created) { msg.textContent = '이미 다른 선생님이 쓰고 있는 PIN이에요. 다른 숫자를 입력해 주세요.'; return; }
            await confirmDialog({
              title: `PIN ${input.value} 이(가) 만들어졌어요`,
              message: '이 번호가 내 아이디예요. 잊지 않게 적어 두세요. 같은 번호를 입력하면 누구든 내 방을 볼 수 있어요.',
              okText: '확인', hideCancel: true
            });
            pin = input.value;
            sessionSet(PIN_KEY, pin);
            showRoomList();
          } catch (e) { handleError(e, { teacher: true, retry: create }); }
        }
        box.append(
          h('p', { class: 'muted' }, '숫자 4자리를 정해 주세요. 이 PIN이 내 아이디가 되어, 로그인하면 내가 만든 방만 보여요.'),
          nameInput, h('div', { class: 'form-col' }, h('label', null, '새 PIN'), input), h('div', { class: 'form-col' }, h('label', null, '한 번 더'), input2),
          msg, h('button', { class: 'btn primary big', type: 'button', onclick: create }, 'PIN 만들기'));
      }
      box.append(h('button', { class: 'btn ghost', type: 'button', onclick: onHome }, '처음으로'));
    }
    draw();
    mount(root, h('main', { class: 'screen center' }, box));
  }

  function logout() {
    sessionRemove(PIN_KEY);
    sessionRemove(ROOM_KEY);
    cleanup();
    onHome();
  }

  /* ═════════ 2. 방 목록 ═════════ */
  async function showRoomList() {
    cleanup();
    sessionRemove(ROOM_KEY);
    let all = [];
    let shown = ROOM_LIST_LIMIT;

    const nameInput = h('input', { class: 'input', type: 'text', maxlength: String(ROOM_NAME_MAX), value: '우리 반 말랑말랑 놀이', 'aria-label': '방 이름' });
    const groupSel = h('select', { class: 'input', 'aria-label': '모둠 수' }, [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n) }, `${n}개`)));
    groupSel.value = '4';
    const createBtn = h('button', { class: 'btn primary big', type: 'button', onclick: onCreate }, '방 만들기');
    const listBox = h('div', { class: 'room-list' });
    const moreBtn = h('button', { class: 'btn ghost', type: 'button', hidden: true, onclick: () => { shown += ROOM_LIST_LIMIT; drawList(); } }, '더 보기');

    mount(root, h('main', { class: 'screen' },
      topBar({ title: '교사용', sub: `PIN ${pin} · 방을 만들거나 열어요`, right: [soundToggleButton(), h('button', { class: 'btn small ghost', type: 'button', onclick: logout }, '로그아웃')] }),
      h('section', { class: 'card' }, h('h3', null, '새 방 만들기'),
        h('div', { class: 'form-row' }, h('label', null, '방 이름'), nameInput),
        h('div', { class: 'form-row' }, h('label', null, '모둠 수'), groupSel), createBtn),
      h('section', { class: 'card' }, h('h3', null, '내 방 목록'), listBox, moreBtn),
      h('section', { class: 'card' }, h('h3', null, '도움말'),
        h('a', { class: 'btn ghost', href: './guide.html', target: '_blank', rel: 'noopener' }, '📖 선생님 안내서 열기')),
      diagnosticsCard()));
    loadRooms();

    async function onCreate() {
      const name = nameInput.value.trim();
      if (!name) { toast('방 이름을 입력해 주세요.', 'warn'); return; }
      createBtn.disabled = true;
      try {
        const code = await D.createRoom(name, Number(groupSel.value), pin);   // [읽기][쓰기]
        toast(`방이 만들어졌어요! 방 코드: ${code}`, 'ok');
        showRoom(code);
      } catch (e) { handleError(e, { teacher: true, retry: onCreate }); createBtn.disabled = false; }
    }

    async function loadRooms() {
      mount(listBox, h('p', { class: 'muted' }, '불러오는 중이에요…'));
      try { all = await D.fetchRoomsByPin(pin); drawList(); }   // [읽기] 내 방 수만큼
      catch (e) { mount(listBox, h('p', { class: 'msg warn' }, '방 목록을 불러오지 못했어요.')); handleError(e, { teacher: true, retry: loadRooms }); }
    }

    function drawList() {
      clear(listBox);
      if (!all.length) listBox.append(h('p', { class: 'muted' }, '아직 만든 방이 없어요.'));
      all.slice(0, shown).forEach((r) => {
        const created = r.data.createdAt && r.data.createdAt.toMillis ? r.data.createdAt.toMillis() : 0;
        listBox.append(h('div', { class: 'room-row' },
          h('div', { class: 'room-main' }, h('strong', null, r.data.roomName || '(이름 없음)'), h('span', { class: 'muted' }, `${r.id}${created ? ` · ${formatDateTime(created)}` : ''}`)),
          h('div', { class: 'room-actions' },
            h('button', { class: 'btn small primary', type: 'button', onclick: () => showRoom(r.id) }, '열기'),
            h('button', { class: 'btn small danger-ghost', type: 'button', onclick: () => onDelete(r.id, r.data.roomName) }, '삭제'))));
      });
      moreBtn.hidden = all.length <= shown;
    }

    async function onDelete(code, name) {
      const ok = await confirmDialog({ title: '방을 삭제할까요?', message: `‘${name || code}’(${code}) 방의 학생, 단어, 문제가 모두 사라져요. 되돌릴 수 없어요.`, okText: '삭제', danger: true });
      if (!ok) return;
      const progress = toast('삭제하는 중이에요… 잠시만 기다려 주세요.', 'info', { ms: 0 });
      try { await D.deleteRoomCascade(code); progress.close(); toast('방을 삭제했어요.', 'ok'); loadRooms(); }
      catch (e) { progress.close(); handleError(e, { teacher: true }); }
    }
  }

  /* ═════════ 3. 점검 도구 ═════════ */
  function diagnosticsCard() {
    const out = h('div', { class: 'diag-out' });
    const line = (ok, text) => out.append(h('p', { class: ok ? 'diag ok' : 'diag bad' }, `${ok ? '✓' : '✗'} ${text}`));
    const testBtn = h('button', {
      class: 'btn small primary', type: 'button',
      onclick: async () => {
        testBtn.disabled = true; clear(out);
        line(true, `Firebase 프로그램(SDK ${D.SDK_VERSION}) 불러오기 성공`);
        line(true, '학교 네트워크 대비(롱폴링 자동 감지) 켜짐');
        try {
          const r = await D.connectionTest();
          line(true, '데이터베이스 쓰기 성공'); line(true, '데이터베이스 읽기 성공');
          line(true, `왕복 ${r.roundTripMs}ms${r.offsetMs !== null ? ` · 서버 시계와 ${r.offsetMs}ms 차이` : ''}`);
        } catch (e) {
          const code = (e && e.code) || '';
          line(false, `연결 실패: ${code || (e && e.message) || '알 수 없는 오류'}`);
          if (code === 'permission-denied') line(false, 'Firebase 콘솔 → Firestore Database → 규칙 탭에서 규칙이 게시되었는지 확인해 주세요.');
        }
        testBtn.disabled = false;
      }
    }, 'Firestore 연결 테스트');
    return h('details', { class: 'card' },
      h('summary', null, '점검 도구 (처음 한 번 확인해 보세요)'),
      h('p', { class: 'muted' }, `앱 버전: ${APP_VERSION}`), testBtn, out,
      h('p', { class: 'muted' }, '효과음 듣기 (소리가 안 나면 기기 음량과 무음 스위치를 확인해 주세요)'),
      h('div', { class: 'chips' }, SOUND_NAMES.map(([key, label]) => h('button', { class: 'btn small ghost', type: 'button', onclick: () => playSound(key, { force: true }) }, label))));
  }

  /* ═════════ 4. 방 화면 ═════════ */
  async function showRoom(code) {
    cleanup();
    let first;
    try {
      const snap = await D.getRoom(code);   // [읽기]
      if (!snap.exists()) { toast('방을 찾을 수 없어요.', 'warn'); showRoomList(); return; }
      first = snap.data();
    } catch (e) { handleError(e, { teacher: true }); showRoomList(); return; }
    if (first.teacherPin && first.teacherPin !== pin) { toast('다른 선생님의 방이에요.', 'warn'); showRoomList(); return; }

    sessionSet(ROOM_KEY, code);
    // T = 이 방 화면 전체가 함께 쓰는 "공용 보관함". 각 탭 파일이 여기서 방 정보와 학생 목록을 받아 가요.
    const handlers = { room: new Set(), students: new Set() };
    let mountScope = null;   // 탭을 그리는 동안 등록된 "알림 받기"를 모아 둬요(그리다 실패하면 한꺼번에 치워요)
    const T = {
      code, pin, tabId: getTabId(), room: first, students: [], root,
      on(evt, fn) { handlers[evt].add(fn); const off = () => handlers[evt].delete(fn); if (mountScope) mountScope.push(off); return off; },
      // 한 곳에서 오류가 나도 나머지 화면(탭 막대, 방 정보 등)은 계속 갱신되게 하나씩 안전하게 불러요
      emit(evt) { [...handlers[evt]].forEach((fn) => { try { fn(); } catch (e) { console.error(`[${evt}]`, e); } }); },
      addCleanup(fn) { cleanups.push(fn); },
      goTab: (key) => selectTab(key),
      leaveRoom: () => { showRoomList(); },
      refreshTabs: () => drawTabs()
    };
    T.data = createTeacherData(T);
    T.games = createGameHost(T);
    T.test = createTestMode(T);
    cleanups.push(() => { T.test.dispose(); T.games.dispose(); T.data.dispose(); setFooterExtra(''); document.body.classList.remove('presenting'); });

    const joinUrl = buildJoinUrl(code);
    const qrBox = h('div', { class: 'qr-box' });
    const infoCard = h('section', { class: 'card info-card' });
    const controlBox = h('div', { class: 'control-box' });
    const tabsBox = h('div');
    const tabBody = h('div', { class: 'tab-body' });
    let presenting = false;
    const presentToggle = h('button', { class: 'btn small ghost', type: 'button', onclick: togglePresentMode }, '이 창을 발표 모드로');

    mount(root, h('main', { class: 'screen' },
      topBar({ title: '방 화면', sub: `PIN ${pin} · ${APP_VERSION}`, left: h('button', { class: 'icon-btn', type: 'button', title: '방 목록으로', onclick: showRoomList }, '←'), right: soundToggleButton() }),
      infoCard, controlBox, tabsBox, tabBody));

    T.games.attachControl(controlBox);
    renderInfo();   // QR도 여기서 한 번 그려요

    // 서버 시계와 내 시계의 차이를 재 둬요 (3-4)
    D.syncClock(() => D.setDoc(D.clockRef(code), { t: D.serverTimestamp() }, { merge: true }), D.clockRef(code), 't')   // [쓰기][읽기]
      .then((offset) => setFooterExtra(`시계 오차 ${Math.round(offset)}ms`)).catch(() => {});

    // 방 문서 듣기 (설정, 게임 상태, 번들 버전이 바뀌면 자동으로 알려 줘요)
    cleanups.push(D.onSnapshot(D.roomRef(code), (snap) => {   // [읽기] 처음 1번 + 바뀔 때마다
      if (!snap.exists()) { toast('이 방이 삭제되었어요.', 'warn'); showRoomList(); return; }
      T.room = snap.data();
      T.emit('room');
    }, (e) => handleError(e, { teacher: true })));
    // 학생 목록 듣기
    cleanups.push(D.onSnapshot(D.studentsCol(code), (snap) => {   // [읽기] 학생 수만큼 + 바뀔 때마다
      T.students = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
      T.emit('students');
    }, (e) => handleError(e, { teacher: true })));
    // 방의 "자동 승인"이 켜져 있으면 학생 문제를 계속 지켜봐요
    const syncAutoWatch = (() => {
      let off = null;
      return () => {
        const on = !!T.room.settings.autoApproveQuestions;
        if (on && !off) off = T.data.watch('questions', 'auto');
        if (!on && off) { off(); off = null; }
      };
    })();
    T.on('room', syncAutoWatch);
    syncAutoWatch();
    T.on('room', renderInfo);
    T.on('room', drawTabs);
    T.data.on(() => drawTabs());

    /* ── 탭 ── */
    let tabKey = sessionGet(TAB_KEY) || 'students';
    let disposeTab = null;
    function pendingBadge() {
      const w = (T.data.get('words') || []).filter((x) => x.status === 'pending').length;
      const q = (T.data.get('questions') || []).filter((x) => x.status === 'pending').length;
      return w + q;
    }
    function drawTabs() {
      mount(tabsBox, tabBar([
        { key: 'students', label: '학생' }, { key: 'words', label: '단어·문제', badge: pendingBadge() },
        { key: 'games', label: '게임' }, { key: 'settings', label: '설정' }
      ], tabKey, selectTab));
    }
    function selectTab(key) {
      if (disposeTab) { try { disposeTab(); } catch (e) { console.error(e); } disposeTab = null; }
      tabKey = key;
      sessionSet(TAB_KEY, key);
      drawTabs();
      const mounts = { students: mountStudentsTab, words: mountWordsTab, games: mountGamesTab, settings: mountSettingsTab };
      mount(tabBody);
      mountScope = [];
      try {
        disposeTab = (mounts[key] || mountStudentsTab)(tabBody, T) || null;
      } catch (e) {
        // 탭을 그리다 오류가 나도 "빈 화면"으로 두지 않고, 원인과 다시 시도 버튼을 보여 줘요
        console.error('탭 그리기 오류', key, e);
        mountScope.forEach((off) => { try { off(); } catch { /* 무시 */ } });
        disposeTab = null;
        const actions = [{ label: '다시 시도', primary: true, act: 'tab-retry', onClick: () => selectTab(key) }];
        if (T.room.gameState && T.room.gameState.mode === 'confirm') actions.push({ label: '참가자 확인 취소', act: 'tab-cancel', onClick: () => T.games.cancelConfirm() });
        mount(tabBody, errorCard({ title: '이 탭을 그리다가 오류가 났어요', error: e, actions }));
      } finally { mountScope = null; }
    }
    cleanups.push(() => { if (disposeTab) disposeTab(); });
    selectTab(tabKey);

    /* ── 방 정보 카드 ── */
    function renderInfo() {
      mount(infoCard, h('div', { class: 'info-grid' },
        h('div', { class: 'info-text' },
          h('p', { class: 'muted' }, T.room.roomName || ''),
          h('div', { class: 'big-code', 'aria-label': `방 코드 ${code}` }, code),
          h('p', { class: 'muted' }, '학생은 이 코드를 입력하거나 QR을 찍어요.'),
          h('p', { class: 'join-url' }, joinUrl),
          h('div', { class: 'chips' },
            h('button', { class: 'btn small ghost', type: 'button', onclick: async () => toast((await copyText(joinUrl)) ? '접속 주소를 복사했어요.' : '복사하지 못했어요.', 'ok') }, '주소 복사'),
            h('button', { class: 'btn small ghost', type: 'button', onclick: showBigQr }, 'QR 크게 보기'),
            h('button', { class: 'btn small primary', type: 'button', onclick: openPresent }, '발표 화면 열기'),
            presentToggle)),
        qrBox));
      if (!qrBox.firstChild) renderQr(qrBox, joinUrl, 168);
    }
    function showBigQr() {
      const box = h('div', { class: 'qr-box big' });
      const modal = showModal(h('div', { class: 'center-col' }, h('h3', null, `방 코드 ${code}`), box, h('p', { class: 'join-url' }, joinUrl),
        h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, '닫기')));
      renderQr(box, joinUrl, 320);
    }
    function openPresent() {
      const url = buildPresentUrl(code);
      const w = window.open(url, 'malrang_present');
      if (!w) {
        const modal = showModal(h('div', { class: 'center-col' }, h('h3', null, '팝업이 막혔어요'),
          h('p', { class: 'dialog-msg' }, '브라우저가 새 창을 막았어요. 아래 주소를 복사해서 TV에 연결된 화면의 새 탭에 붙여 넣어 주세요.'),
          h('p', { class: 'join-url' }, url),
          h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn ghost', type: 'button', onclick: async () => toast((await copyText(url)) ? '복사했어요.' : '복사하지 못했어요.', 'ok') }, '주소 복사'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, '닫기'))));
      }
    }
    async function togglePresentMode() {
      presenting = !presenting;
      document.body.classList.toggle('presenting', presenting);
      presentToggle.textContent = presenting ? '발표 모드 끄기' : '이 창을 발표 모드로';
      if (presenting !== !!document.fullscreenElement) await toggleFullscreen();
    }
    const onFsChange = () => {
      if (!document.fullscreenElement && presenting) { presenting = false; document.body.classList.remove('presenting'); presentToggle.textContent = '이 창을 발표 모드로'; }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    cleanups.push(() => document.removeEventListener('fullscreenchange', onFsChange));
  }
}
