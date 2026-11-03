// js/present.js — 발표 화면(TV용). 읽기 전용이에요. 주소: 앱주소#present/방코드
// 이번 단계에는 "방 이름, 방 코드, QR, 지금 상태"만 보여 줘요. 게임 화면은 다음 단계부터 이곳에 추가돼요.

import { h, mount, parseRoomCode, buildJoinUrl, renderQr } from './core.js';
import { mascot, initSound, soundToggleButton, startBeacon, toggleFullscreen, handleError, unlockAudio } from './ui.js';
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
  const qrBox = h('div', { class: 'qr-box big' });
  const soundHint = h('button', { class: 'btn small ghost', type: 'button', onclick: async () => { await unlockAudio(); soundHint.remove(); } }, '🔈 소리를 켜려면 여기를 한 번 눌러 주세요');

  mount(root, h('main', { class: 'screen present' },
    h('div', { class: 'present-tools' }, soundHint, soundToggleButton(),
      h('button', { class: 'btn small ghost', type: 'button', onclick: toggleFullscreen }, '전체화면')),
    body));

  renderQr(qrBox, joinUrl, 260);

  // 방 문서 하나만 구독해요 (읽기를 아끼려고)
  D.onSnapshot(D.roomRef(code), (snap) => {   // [읽기] 처음 1번 + 바뀔 때마다
    if (!snap.exists()) {
      mount(body, mascot(120, 'wow'), h('h1', null, '방을 찾을 수 없어요'), h('p', { class: 'muted' }, `방 코드 ${code}`));
      return;
    }
    const room = snap.data();
    document.title = `발표 · ${room.roomName}`;
    const mode = room.gameState.mode;
    const waiting = mode === 'idle' || mode === 'ranking';
    mount(body,
      h('div', { class: 'present-head' }, mascot(120, waiting ? 'smile' : 'wow'), h('h1', null, '말랑말랑 퀴즈 놀이터')),
      h('h2', { class: 'present-room' }, room.roomName),
      h('div', { class: 'present-join' },
        h('div', null,
          h('p', { class: 'muted' }, '방 코드'),
          h('div', { class: 'big-code present-code' }, code),
          h('p', { class: 'join-url' }, joinUrl)),
        qrBox),
      h('p', { class: 'present-status' }, waiting ? '친구들이 들어오고 있어요. QR을 찍거나 방 코드를 입력해 주세요!' : '게임이 시작됐어요! (게임 화면은 다음 단계에서 만들어져요)'));
  }, (e) => handleError(e, {}));
}
