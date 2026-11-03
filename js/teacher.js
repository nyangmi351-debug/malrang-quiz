// js/teacher.js — 교사 화면: PIN → 방 목록(만들기/열기/삭제) → 방 화면(QR, 학생 모니터링, 모둠 수 설정)

import {
  h, mount, clear, sessionGet, sessionSet, sessionRemove, buildJoinUrl, buildPresentUrl, copyText, renderQr, formatDateTime
} from './core.js';
import { TEACHER_PIN, APP_VERSION, PRESENCE_WINDOW_MS } from './config.js';
import {
  GROUPS, groupBadge, mascot, toast, confirmDialog, showModal, handleError, initSound, soundToggleButton,
  playSound, SOUND_NAMES, topBar, toggleFullscreen, setFooterExtra
} from './ui.js';
import * as D from './db.js';

const ROOM_NAME_MAX = 20;
const PIN_KEY = 'malrang_teacher_ok';
const ROOM_KEY = 'malrang_teacher_room';   // 지금 열어 둔 방(새로고침해도 이 방으로 돌아오려고 기억해요)

export function startTeacher(root, { onHome }) {
  initSound('teacher');

  // 화면을 떠날 때 "실시간 듣기"와 타이머를 꼭 끊어 줘요(읽기 횟수를 아끼려고)
  let unsubs = [];
  let timers = [];
  function cleanup() {
    unsubs.forEach((u) => u());
    unsubs = [];
    timers.forEach((t) => clearInterval(t));
    timers = [];
  }

  if (sessionGet(PIN_KEY) !== '1') showPin();
  else if (sessionGet(ROOM_KEY)) showRoom(sessionGet(ROOM_KEY));   // 새로고침하면 열어 두었던 방으로 바로 돌아와요
  else showRoomList();

  /* ═════════ 1. PIN 입력 ═════════ */
  function showPin() {
    cleanup();
    const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' });
    const input = h('input', {
      class: 'input pin-input', type: 'password', inputmode: 'numeric', maxlength: '4',
      autocomplete: 'off', placeholder: '••••', 'aria-label': '교사 PIN 4자리'
    });
    const card = h('div', { class: 'card center-card' },
      mascot(96), h('h2', null, '교사용'), h('p', { class: 'muted' }, 'PIN 4자리를 입력해 주세요.'), input, msg,
      h('button', { class: 'btn primary big', type: 'button', onclick: check }, '확인'),
      h('button', { class: 'btn ghost', type: 'button', onclick: onHome }, '처음으로'));

    function check() {
      if (input.value === TEACHER_PIN) {
        sessionSet(PIN_KEY, '1');
        showRoomList();
        return;
      }
      msg.textContent = '번호가 달라요. 다시 입력해 주세요.';
      card.classList.remove('shake');
      void card.offsetWidth;   // 애니메이션을 다시 처음부터 재생하려는 꼼수
      card.classList.add('shake');
      input.value = '';
      input.focus();
    }
    input.addEventListener('input', () => { msg.textContent = ''; if (input.value.length === 4) check(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(); });
    mount(root, h('main', { class: 'screen center' }, card));
    input.focus();
  }

  function logout() {
    sessionRemove(PIN_KEY);
    sessionRemove(ROOM_KEY);
    cleanup();
    onHome();
  }

  /* ═════════ 2. 방 목록 ═════════ */
  function showRoomList() {
    cleanup();
    sessionRemove(ROOM_KEY);
    let lastDoc = null;

    const nameInput = h('input', {
      class: 'input', type: 'text', maxlength: String(ROOM_NAME_MAX), value: '우리 반 말랑말랑 놀이', 'aria-label': '방 이름'
    });
    const groupSel = h('select', { class: 'input', 'aria-label': '모둠 수' },
      [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n) }, `${n}개`)));
    groupSel.value = '4';
    const createBtn = h('button', { class: 'btn primary big', type: 'button', onclick: onCreate }, '방 만들기');
    const listBox = h('div', { class: 'room-list' });
    const moreBtn = h('button', { class: 'btn ghost', type: 'button', hidden: true, onclick: () => loadRooms(false) }, '더 보기');

    mount(root, h('main', { class: 'screen' },
      topBar({
        title: '교사용', sub: '방을 만들거나 열어요',
        right: [soundToggleButton(), h('button', { class: 'btn small ghost', type: 'button', onclick: logout }, '로그아웃')]
      }),
      h('section', { class: 'card' },
        h('h3', null, '새 방 만들기'),
        h('div', { class: 'form-row' }, h('label', null, '방 이름'), nameInput),
        h('div', { class: 'form-row' }, h('label', null, '모둠 수'), groupSel),
        createBtn),
      h('section', { class: 'card' }, h('h3', null, '이전 방 목록'), listBox, moreBtn),
      diagnosticsCard()));

    loadRooms(true);

    async function onCreate() {
      const name = nameInput.value.trim();
      if (!name) { toast('방 이름을 입력해 주세요.', 'warn'); return; }
      createBtn.disabled = true;
      try {
        const code = await D.createRoom(name, Number(groupSel.value));
        toast(`방이 만들어졌어요! 방 코드: ${code}`, 'ok');
        showRoom(code);
      } catch (e) {
        handleError(e, { teacher: true, retry: onCreate });
        createBtn.disabled = false;
      }
    }

    async function loadRooms(reset) {
      if (reset) { lastDoc = null; mount(listBox, h('p', { class: 'muted' }, '불러오는 중이에요…')); }
      try {
        const { docs, hasMore } = await D.fetchRoomList(lastDoc);
        if (reset) clear(listBox);
        if (reset && docs.length === 0) listBox.append(h('p', { class: 'muted' }, '아직 만든 방이 없어요.'));
        docs.forEach((d) => listBox.append(roomRow(d)));
        if (docs.length) lastDoc = docs[docs.length - 1];
        moreBtn.hidden = !hasMore;
      } catch (e) {
        mount(listBox, h('p', { class: 'msg warn' }, '방 목록을 불러오지 못했어요.'));
        handleError(e, { teacher: true, retry: () => loadRooms(true) });
      }
    }

    function roomRow(d) {
      const data = d.data();
      const created = data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0;
      return h('div', { class: 'room-row' },
        h('div', { class: 'room-main' },
          h('strong', null, data.roomName || '(이름 없음)'),
          h('span', { class: 'muted' }, `${d.id}${created ? ` · ${formatDateTime(created)}` : ''}`)),
        h('div', { class: 'room-actions' },
          h('button', { class: 'btn small primary', type: 'button', onclick: () => showRoom(d.id) }, '열기'),
          h('button', { class: 'btn small danger-ghost', type: 'button', onclick: () => onDelete(d.id, data.roomName) }, '삭제')));
    }

    async function onDelete(code, name) {
      const ok = await confirmDialog({
        title: '방을 삭제할까요?',
        message: `‘${name || code}’(${code}) 방의 학생, 단어, 문제가 모두 사라져요. 되돌릴 수 없어요.`,
        okText: '삭제', danger: true
      });
      if (!ok) return;
      const progress = toast('삭제하는 중이에요… 잠시만 기다려 주세요.', 'info', { ms: 0 });
      try {
        await D.deleteRoomCascade(code);
        progress.close();
        toast('방을 삭제했어요.', 'ok');
        loadRooms(true);
      } catch (e) {
        progress.close();
        handleError(e, { teacher: true });
      }
    }
  }

  /* ═════════ 3. 점검 도구 (연결 테스트, 소리 테스트) ═════════ */
  function diagnosticsCard() {
    const out = h('div', { class: 'diag-out' });
    const line = (ok, text) => out.append(h('p', { class: ok ? 'diag ok' : 'diag bad' }, `${ok ? '✓' : '✗'} ${text}`));

    const testBtn = h('button', {
      class: 'btn small primary', type: 'button',
      onclick: async () => {
        testBtn.disabled = true;
        clear(out);
        line(true, `Firebase 프로그램(SDK ${D.SDK_VERSION}) 불러오기 성공`);
        line(true, '학교 네트워크 대비(롱폴링 자동 감지) 켜짐');
        try {
          const r = await D.connectionTest();
          line(true, '데이터베이스 쓰기 성공');
          line(true, '데이터베이스 읽기 성공');
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
      h('p', { class: 'muted' }, `앱 버전: ${APP_VERSION}`),
      testBtn, out,
      h('p', { class: 'muted' }, '효과음 듣기 (소리가 안 나면 기기 음량과 무음 스위치를 확인해 주세요)'),
      h('div', { class: 'chips' }, SOUND_NAMES.map(([key, label]) =>
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => playSound(key, { force: true }) }, label))));
  }

  /* ═════════ 4. 방 화면 ═════════ */
  async function showRoom(code) {
    cleanup();
    let room = null;
    let students = [];
    let pendingRender = false;

    // 처음 한 번: 방이 정말 있는지 확인
    try {
      const snap = await D.getRoom(code);
      if (!snap.exists()) { toast('방을 찾을 수 없어요.', 'warn'); showRoomList(); return; }
      room = snap.data();
    } catch (e) {
      handleError(e, { teacher: true });
      showRoomList();
      return;
    }

    sessionSet(ROOM_KEY, code);
    const joinUrl = buildJoinUrl(code);
    const qrBox = h('div', { class: 'qr-box' });
    const infoCard = h('section', { class: 'card info-card' });
    const monitorBox = h('section', { class: 'card' });
    const settingsBox = h('section', { class: 'card' });
    const dangerBox = h('section', { class: 'card' },
      h('h3', null, '방 관리'),
      h('button', { class: 'btn danger-ghost', type: 'button', onclick: deleteThisRoom }, '이 방 삭제'));

    let presenting = false;
    const presentToggle = h('button', { class: 'btn small ghost', type: 'button', onclick: togglePresentMode }, '이 창을 발표 모드로');

    mount(root, h('main', { class: 'screen' },
      topBar({
        title: '방 화면', sub: '학생들이 들어오는 걸 지켜봐요',
        left: h('button', { class: 'icon-btn', type: 'button', title: '방 목록으로', onclick: showRoomList }, '←'),
        right: soundToggleButton()
      }),
      infoCard, monitorBox, settingsBox, dangerBox));

    renderInfo();
    renderQr(qrBox, joinUrl, 168);

    // 서버 시계와 내 시계의 차이를 재 둬요 (3-4). 화면에 만들어지는 걸 막지 않고 뒤에서 해요.
    D.syncClock(() => D.setDoc(D.clockRef(code), { t: D.serverTimestamp() }, { merge: true }), D.clockRef(code), 't')   // [쓰기][읽기]
      .then((offset) => setFooterExtra(`시계 오차 ${Math.round(offset)}ms`))
      .catch(() => { /* 시계 보정에 실패해도 화면은 계속 써요 */ });

    // 방 문서 듣기 (설정, 게임 상태가 바뀌면 자동으로 화면이 바뀌어요)
    unsubs.push(D.onSnapshot(D.roomRef(code), (snap) => {   // [읽기] 처음 1번 + 바뀔 때마다
      if (!snap.exists()) {
        toast('이 방이 삭제되었어요.', 'warn');
        showRoomList();
        return;
      }
      room = snap.data();
      renderInfo();
      renderSettings();
      renderMonitor();
    }, (e) => handleError(e, { teacher: true })));

    // 학생 목록 듣기
    unsubs.push(D.onSnapshot(D.studentsCol(code), (snap) => {   // [읽기] 학생 수만큼 + 바뀔 때마다
      students = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }));
      renderMonitor();
    }, (e) => handleError(e, { teacher: true })));

    // "접속 중" 표시를 30초마다 새로 계산
    timers.push(setInterval(renderMonitor, 30000));
    renderSettings();
    renderMonitor();

    /* ── 방 정보 카드 ── */
    function renderInfo() {
      mount(infoCard,
        h('div', { class: 'info-grid' },
          h('div', { class: 'info-text' },
            h('p', { class: 'muted' }, room.roomName || ''),
            h('div', { class: 'big-code', 'aria-label': `방 코드 ${code}` }, code),
            h('p', { class: 'muted' }, '학생은 이 코드를 입력하거나 QR을 찍어요.'),
            h('p', { class: 'join-url' }, joinUrl),
            h('div', { class: 'chips' },
              h('button', { class: 'btn small ghost', type: 'button', onclick: async () => toast((await copyText(joinUrl)) ? '접속 주소를 복사했어요.' : '복사하지 못했어요.', 'ok') }, '주소 복사'),
              h('button', { class: 'btn small ghost', type: 'button', onclick: showBigQr }, 'QR 크게 보기'),
              h('button', { class: 'btn small primary', type: 'button', onclick: openPresent }, '발표 화면 열기'),
              presentToggle)),
          qrBox));
    }

    function showBigQr() {
      const box = h('div', { class: 'qr-box big' });
      const modal = showModal(h('div', { class: 'center-col' },
        h('h3', null, `방 코드 ${code}`), box, h('p', { class: 'join-url' }, joinUrl),
        h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, '닫기')));
      renderQr(box, joinUrl, 320);
    }

    function openPresent() {
      const url = buildPresentUrl(code);
      const w = window.open(url, 'malrang_present');
      if (!w) {
        const modal = showModal(h('div', { class: 'center-col' },
          h('h3', null, '팝업이 막혔어요'),
          h('p', { class: 'dialog-msg' }, '브라우저가 새 창을 막았어요. 아래 주소를 복사해서 TV에 연결된 화면의 새 탭에 붙여 넣어 주세요.'),
          h('p', { class: 'join-url' }, url),
          h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn ghost', type: 'button', onclick: async () => toast((await copyText(url)) ? '복사했어요.' : '복사하지 못했어요.', 'ok') }, '주소 복사'),
            h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, '닫기'))));
      }
    }

    // 화면 미러링으로 TV를 쓸 때: 지금 창을 큰 글씨 + 전체화면으로 바꿔요
    async function togglePresentMode() {
      presenting = !presenting;
      document.body.classList.toggle('presenting', presenting);
      presentToggle.textContent = presenting ? '발표 모드 끄기' : '이 창을 발표 모드로';
      if (presenting !== !!document.fullscreenElement) await toggleFullscreen();
    }
    const onFsChange = () => {
      if (!document.fullscreenElement && presenting) {
        presenting = false;
        document.body.classList.remove('presenting');
        presentToggle.textContent = '이 창을 발표 모드로';
      }
    };
    document.addEventListener('fullscreenchange', onFsChange);
    unsubs.push(() => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.body.classList.remove('presenting');
      setFooterExtra('');
    });

    /* ── 설정 카드 (이번 단계는 모둠 수만) ── */
    function renderSettings() {
      const groupCount = room.settings.groupCount;
      const inGame = room.gameState.mode !== 'idle';
      const sel = h('select', { class: 'input', 'aria-label': '모둠 수', disabled: inGame },
        [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n) }, `${n}개`)));
      sel.value = String(groupCount);
      const btn = h('button', { class: 'btn primary', type: 'button', disabled: inGame, onclick: async () => {
        const n = Number(sel.value);
        if (n === groupCount) { toast('지금과 같은 모둠 수예요.', 'info'); return; }
        const ok = await confirmDialog({
          title: '모둠 수를 바꿀까요?', message: '모든 학생이 모둠을 다시 선택해요.', okText: '바꾸기'
        });
        if (!ok) return;
        btn.disabled = true;
        try {
          await D.changeGroupCount(code, n, students.map((s) => s.id));
          toast(`모둠 수를 ${n}개로 바꿨어요. 학생들이 새 모둠을 골라요.`, 'ok');
        } catch (e) {
          handleError(e, { teacher: true });
          btn.disabled = false;
        }
      } }, '모둠 수 바꾸기');
      mount(settingsBox,
        h('h3', null, '방 설정'),
        h('div', { class: 'form-row' }, h('label', null, '모둠 수'), sel, btn),
        inGame ? h('p', { class: 'msg warn' }, '게임 중에는 모둠 수를 바꿀 수 없어요.') : null,
        h('p', { class: 'muted' }, '단어·문제·게임 설정은 다음 단계에서 이곳에 추가돼요.'));
    }

    /* ── 학생 모니터링 ── */
    function renderMonitor() {
      // 선생님이 모둠 드롭다운을 열어 둔 동안 화면이 새로 그려지면 닫혀 버려서, 잠시 미뤄요
      const active = document.activeElement;
      if (active && active.tagName === 'SELECT' && monitorBox.contains(active)) { pendingRender = true; return; }
      pendingRender = false;

      const groupCount = room.settings.groupCount;
      const inGame = room.gameState.mode !== 'idle';
      const nowMs = D.now();
      const isOnline = (s) => {
        const t = s.lastSeen && s.lastSeen.toMillis ? s.lastSeen.toMillis() : 0;
        return nowMs - t < PRESENCE_WINDOW_MS;
      };
      const sorted = [...students].sort((a, b) => {
        const ta = a.joinedAt && a.joinedAt.toMillis ? a.joinedAt.toMillis() : 0;
        const tb = b.joinedAt && b.joinedAt.toMillis ? b.joinedAt.toMillis() : 0;
        return ta - tb || (a.id < b.id ? -1 : 1);
      });
      const picked = sorted.filter((s) => s.groupId >= 1 && s.groupId <= groupCount).length;
      const onlineCount = sorted.filter(isOnline).length;

      const columns = [];
      for (let g = 1; g <= groupCount; g++) columns.push({ g, list: sorted.filter((s) => s.groupId === g) });
      columns.push({ g: 0, list: sorted.filter((s) => !(s.groupId >= 1 && s.groupId <= groupCount)) });

      mount(monitorBox,
        h('h3', null, '학생 모니터링'),
        h('div', { class: 'chips' },
          h('span', { class: 'chip' }, `전체 ${sorted.length}명`),
          h('span', { class: 'chip ok' }, `접속 중 ${onlineCount}명`),
          h('span', { class: 'chip' }, `모둠 선택 완료 ${picked}/${sorted.length}`)),
        sorted.length === 0 ? h('p', { class: 'muted' }, '아직 들어온 학생이 없어요. 학생에게 방 코드를 알려 주세요.') : null,
        h('div', { class: 'group-grid' }, columns.map(({ g, list }) => {
          if (g === 0 && list.length === 0) return null;
          return h('div', { class: 'group-col' },
            h('div', { class: 'group-head' }, g === 0 ? h('span', { class: 'gbadge none' }, '모둠 미선택') : groupBadge(g), h('span', { class: 'muted' }, `${list.length}명`)),
            list.map((s) => studentTile(s, isOnline(s), groupCount, inGame)));
        })),
        inGame ? h('p', { class: 'muted' }, '게임 중에는 학생의 모둠을 바꿀 수 없어요.') : null);
    }

    function studentTile(s, online, groupCount, inGame) {
      const sel = h('select', { class: 'input mini', 'aria-label': `${s.nickname}의 모둠`, disabled: inGame },
        h('option', { value: '' }, '모둠 선택 안 함'),
        Array.from({ length: groupCount }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}모둠 ${GROUPS[i + 1].icon}`)));
      sel.value = s.groupId >= 1 && s.groupId <= groupCount ? String(s.groupId) : '';
      sel.addEventListener('change', async () => {
        try {
          await D.setStudentGroup(code, s.id, sel.value ? Number(sel.value) : null);
        } catch (e) { handleError(e, { teacher: true }); }
        sel.blur();
        if (pendingRender) renderMonitor();
      });
      sel.addEventListener('blur', () => { if (pendingRender) setTimeout(renderMonitor, 0); });
      return h('div', { class: `student-tile ${online ? 'online' : 'offline'}` },
        h('span', { class: 'dot', title: online ? '접속 중' : '접속 안 함' }),
        h('span', { class: 'sname' }, s.nickname),
        h('span', { class: 'sscore muted' }, `${s.studyScore || 0}점`),
        sel);
    }

    /* ── 방 삭제 ── */
    async function deleteThisRoom() {
      const ok = await confirmDialog({
        title: '이 방을 삭제할까요?',
        message: `‘${room.roomName}’(${code}) 방의 학생, 단어, 문제가 모두 사라져요. 되돌릴 수 없어요.`,
        okText: '삭제', danger: true
      });
      if (!ok) return;
      const progress = toast('삭제하는 중이에요… 잠시만 기다려 주세요.', 'info', { ms: 0 });
      try {
        await D.deleteRoomCascade(code);
        progress.close();
        toast('방을 삭제했어요.', 'ok');
      } catch (e) {
        progress.close();
        handleError(e, { teacher: true });
      }
    }
  }
}
