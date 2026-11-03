// js/present.js — 발표 화면(TV용). 읽기 전용이에요. 주소: 앱주소#present/방코드
//   방 문서 하나를 구독해서 지금 상태에 맞는 화면을 보여 줘요.
//   대기(idle): 방 코드·QR / 점수 순위(ranking): 공부하기 개인 순위 / 참가자 확인(confirm) / 게임(live·tele·speed_*)

import { h, mount, parseRoomCode, buildJoinUrl, renderQr } from './core.js';
import { mascot, initSound, soundToggleButton, startBeacon, toggleFullscreen, handleError, unlockAudio } from './ui.js';
import { studyRanking } from './results.js';
import { createGameScreen } from './gamescreen.js';
import { GAME_MODES } from './gamecore.js';
import * as D from './db.js';

export function startPresent(root, rawCode) {
  initSound('present');
  startBeacon();   // 교사 창이 "발표 창이 열려 있구나" 알 수 있게 3초마다 신호를 보내요

  const { code, valid } = parseRoomCode(rawCode);
  if (!valid) {
    mount(root, h('main', { class: 'screen center present' },
      h('div', { class: 'card center-card' }, mascot(96, 'wow'), h('h2', null, '방 코드가 올바르지 않아요'),
        h('p', { class: 'muted' }, '교사 화면의 [발표 화면 열기] 버튼으로 다시 열어 주세요.'))));
    return;
  }

  document.body.classList.add('present-mode');
  const joinUrl = buildJoinUrl(code);
  const body = h('div', { class: 'present-body' });
  const soundHint = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { await unlockAudio(); soundHint.remove(); } }, '🔈 소리를 켜려면 여기를 한 번 눌러 주세요');

  mount(root, h('main', { class: 'screen present' },
    h('div', { class: 'present-tools' }, soundHint, soundToggleButton(),
      h('button', { class: 'btn small ghost', type: 'button', onclick: toggleFullscreen }, '전체화면')),
    body));

  let room = null, screenKey = '', gameScreen = null, studentsUnsub = null, rankingBox = null, students = [];

  function stopGame() { if (gameScreen) { gameScreen.destroy(); gameScreen = null; } }
  function stopStudents() { if (studentsUnsub) { studentsUnsub(); studentsUnsub = null; } rankingBox = null; }

  function joinCard(statusText, mood) {
    const qrBox = h('div', { class: 'qr-box big' });
    renderQr(qrBox, joinUrl, 260);
    return [
      h('div', { class: 'present-head' }, mascot(120, mood), h('h1', null, '말랑말랑 퀴즈 놀이터')),
      h('h2', { class: 'present-room' }, room.roomName),
      h('div', { class: 'present-join' },
        h('div', null, h('p', { class: 'muted' }, '방 코드'), h('div', { class: 'big-code present-code' }, code), h('p', { class: 'join-url' }, joinUrl)),
        qrBox),
      h('p', { class: 'present-status' }, statusText)];
  }

  function render() {
    const gs = room.gameState;
    const mode = gs.mode;
    document.title = `발표 · ${room.roomName}`;

    if (GAME_MODES.includes(mode)) {
      stopStudents();
      const k = `${mode}:${gs.gameId}`;
      if (!gameScreen || screenKey !== k) {
        stopGame();
        screenKey = k;
        gameScreen = createGameScreen({ role: 'present', code, getMe: () => ({ id: '', nickname: '', groupId: null }), getRoom: () => room });
        mount(body, gameScreen.el);
      }
      gameScreen.update(room);
      return;
    }
    stopGame();

    if (mode === 'ranking') {
      if (screenKey !== 'ranking') {
        screenKey = 'ranking';
        rankingBox = h('div');
        mount(body, rankingBox);
        studentsUnsub = D.onSnapshot(D.studentsCol(code), (snap) => {   // [읽기] 순위를 보는 동안만 학생 목록을 들어요
          students = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          if (rankingBox) mount(rankingBox, studyRanking(students));
        }, (e) => handleError(e, {}));
      }
      return;
    }
    stopStudents();

    const want = `${mode === 'confirm' ? 'confirm' : 'idle'}:${room.roomName}`;
    if (screenKey === want) return;   // 같은 화면이면 다시 그리지 않아요(QR이 깜빡이지 않게)
    screenKey = want;
    if (mode === 'confirm') mount(body, ...joinCard('참가자를 확인하고 있어요. 태블릿 화면을 켜 두세요!', 'wow'));
    else mount(body, ...joinCard('친구들이 들어오고 있어요. QR을 찍거나 방 코드를 입력해 주세요!', 'smile'));
  }

  // 방 문서 하나만 구독해요 (읽기를 아끼려고)
  D.onSnapshot(D.roomRef(code), (snap) => {   // [읽기] 처음 1번 + 바뀔 때마다
    if (!snap.exists()) {
      mount(body, mascot(120, 'wow'), h('h1', null, '방을 찾을 수 없어요'), h('p', { class: 'muted' }, `방 코드 ${code}`));
      return;
    }
    room = snap.data();
    render();
  }, (e) => handleError(e, {}));
}
