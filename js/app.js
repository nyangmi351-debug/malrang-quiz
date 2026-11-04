// js/app.js — 앱의 시작점. 주소를 보고 "어느 화면을 보여 줄지" 정해요.
//   앱주소#present/방코드  → 발표 화면(TV)
//   앱주소?room=방코드      → 학생 입장(QR로 들어온 경우)
//   (교사가 방을 열어 둔 탭) → 교사 방 화면으로 복귀
//   저장된 방이 있으면      → 학생 자동 재입장
//   그 밖에는               → 처음 화면(학생/교사 고르기)

import { h, mount, parseRoomCode, storeGetJson, sessionGet } from './core.js';
import { mascot, initConnectionBanner, initFooter, setBanner } from './ui.js';
import { APP_VERSION } from './config.js';
import { startStudent } from './student.js';
import { startTeacher } from './teacher.js';
import { startPresent } from './present.js';

const root = document.getElementById('app');
const SAVED_KEY = 'malrang_student';

function showHome() {
  document.title = '말랑말랑 퀴즈 놀이터';
  mount(root, h('main', { class: 'screen center' },
    h('div', { class: 'card center-card hero' },
      mascot(128),
      h('h1', { class: 'logo' }, '말랑말랑 퀴즈 놀이터'),
      h('p', { class: 'muted' }, '국어 어휘를 친구들과 함께 놀면서 배워요!'),
      h('button', { class: 'btn primary big', type: 'button', onclick: () => startStudent(root, { onHome: showHome }) }, '학생으로 입장'),
      h('button', { class: 'btn ghost big', type: 'button', onclick: () => startTeacher(root, { onHome: showHome }) }, '교사용'))));
}

function route() {
  const hash = location.hash;
  if (hash.startsWith('#present/')) {
    startPresent(root, hash.slice('#present/'.length));
    return;
  }

  const urlRoom = parseRoomCode(new URLSearchParams(location.search).get('room') || '').code;
  const saved = storeGetJson(SAVED_KEY);
  const savedOk = saved && saved.room && saved.id;

  if (urlRoom && savedOk && saved.room === urlRoom) {
    startStudent(root, { onHome: showHome, autoSaved: saved });            // 같은 방 → 자동 재입장
  } else if (urlRoom) {
    startStudent(root, { onHome: showHome, prefillRoom: urlRoom });        // 다른 방(QR) → 새 방 코드를 채워서 입장 화면
  } else if (/^\d{4}$/.test(sessionGet('malrang_teacher_pin') || '') && sessionGet('malrang_teacher_room')) {
    startTeacher(root, { onHome: showHome });                              // 교사 창을 새로고침 → 열어 두었던 방으로 복귀
  } else if (savedOk) {
    startStudent(root, { onHome: showHome, autoSaved: saved });            // 저장된 방으로 자동 재입장
  } else {
    showHome();
  }
}

initFooter();
initConnectionBanner();

// 파일 버전이 서로 맞는지 확인해요. 업로드가 덜 됐거나 예전 파일이 남아 있으면 화면 위에 안내를 띄워요.
const RELOAD_TIP = 'Ctrl+Shift+R(맥은 ⌘+Shift+R)로 새로고침해 주세요. 그래도 같으면 GitHub에 올린 파일이 최신인지 확인해 주세요.';
function checkVersions() {
  if (window.MALRANG_BUILD && !APP_VERSION.startsWith(`v${window.MALRANG_BUILD}`)) {
    setBanner('stale', `파일 버전이 서로 달라요 (index.html ${window.MALRANG_BUILD} / 프로그램 ${APP_VERSION}). ${RELOAD_TIP}`);
  } else if (window.MALRANG_STALE) {
    setBanner('stale', `새 버전(${window.MALRANG_STALE})이 올라와 있어요. 지금 화면은 예전 버전(${APP_VERSION})이에요. ${RELOAD_TIP}`);
  }
}
checkVersions();
window.addEventListener('malrang-stale', checkVersions);
window.addEventListener('hashchange', () => location.reload());   // 주소 뒷부분(#...)이 바뀌면 처음부터 다시 시작
route();
window.__malrangBooted = true;   // index.html의 "시작이 안 됐어요" 안내를 끄는 표시
window.__malrangVersion = APP_VERSION;   // index.html이 "js 폴더가 예전 파일이 아닌지" 확인할 때 써요
