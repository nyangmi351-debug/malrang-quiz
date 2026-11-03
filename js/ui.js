// js/ui.js — 화면 부품(알림, 팝업, 말랑이 그림, 모둠 배지), 오류 안내, 효과음

import { h, storeGet, storeSet } from './core.js';
import { APP_VERSION, TIMES } from './config.js';

/* ───────── 1. 모둠 색·번호·아이콘 (색만으로 구분하지 않도록 번호와 아이콘도 함께) ───────── */
export const GROUPS = [
  null,
  { n: 1, color: '#FF6B6B', icon: '🍎', name: '빨강' },
  { n: 2, color: '#FF9F43', icon: '🍊', name: '주황' },
  { n: 3, color: '#FFC83D', icon: '🍋', name: '노랑' },
  { n: 4, color: '#3DBB7E', icon: '🍀', name: '초록' },
  { n: 5, color: '#4C8DF6', icon: '🐳', name: '파랑' },
  { n: 6, color: '#9B6BFF', icon: '🍇', name: '보라' }
];

export function groupBadge(groupId, opts = {}) {
  const g = GROUPS[groupId];
  if (!g) return h('span', { class: 'gbadge none' }, '모둠 미선택');
  return h('span', { class: 'gbadge', style: { '--gc': g.color } },
    h('span', { class: 'gicon', 'aria-hidden': 'true' }, g.icon),
    opts.compact ? String(g.n) : `${g.n}모둠`);
}

/* ───────── 2. 말랑이(말풍선 캐릭터) — 그림 파일 없이 코드로 그려요 ───────── */
function mascotSvg(mood) {
  const mouth = mood === 'wow'
    ? '<ellipse cx="60" cy="72" rx="7" ry="9" fill="#2B2D42"/>'
    : '<path d="M49 68 Q60 80 71 68" stroke="#2B2D42" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" role="img" aria-label="말랑이">
  <path d="M60 12C30 12 10 32 10 56c0 16 9 28 22 36-1 7-5 13-12 18 14-1 26-6 34-11 2 .2 4 .3 6 .3 30 0 50-19.300 50-43.300C110 32 90 12 60 12z" fill="#4C8DF6"/>
  <path d="M30 30c8-9 20-13 32-12" stroke="#fff" stroke-opacity=".45" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="44" cy="54" r="7" fill="#2B2D42"/><circle cx="76" cy="54" r="7" fill="#2B2D42"/>
  <circle cx="46.500" cy="51.500" r="2.400" fill="#fff"/><circle cx="78.500" cy="51.500" r="2.400" fill="#fff"/>
  <ellipse cx="31" cy="68" rx="7" ry="5" fill="#FF9FB2" fill-opacity=".8"/><ellipse cx="89" cy="68" rx="7" ry="5" fill="#FF9FB2" fill-opacity=".8"/>
  ${mouth}
</svg>`;
}

export function mascot(size = 72, mood = 'smile') {
  const parsed = new DOMParser().parseFromString(mascotSvg(mood), 'image/svg+xml').documentElement;
  const svg = document.importNode(parsed, true);
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', 'mascot');
  return svg;
}

/* ───────── 3. 알림(토스트) ───────── */
export function toast(message, kind = 'info', opts = {}) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, h('span', null, message));
  if (opts.actionText && opts.onAction) {
    el.append(h('button', { class: 'toast-btn', type: 'button', onclick: () => { close(); opts.onAction(); } }, opts.actionText));
  }
  let closed = false;
  function close() { if (closed) return; closed = true; el.remove(); }
  box.append(el);
  const ms = opts.ms === undefined ? 3000 : opts.ms;   // ms가 0이면 직접 닫을 때까지 보여요
  if (ms > 0) setTimeout(close, ms);
  return { close };
}

/* ───────── 4. 팝업 ───────── */
export function showModal(content, opts = {}) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'dialog' }, content));
  function close() { overlay.remove(); if (opts.onClose) opts.onClose(); }
  if (opts.dismissable !== false) {
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  }
  document.body.append(overlay);
  return { el: overlay, close };
}

/** 예/아니오 팝업. await confirmDialog(...) 하면 true/false가 돌아와요. */
export function confirmDialog({ title, message, okText = '확인', cancelText = '취소', danger = false, hideCancel = false }) {
  return new Promise((resolve) => {
    const finish = (value) => { overlay.remove(); resolve(value); };
    const okBtn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', onclick: () => finish(true) }, okText);
    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'dialog' },
        h('h3', null, title),
        message ? h('p', { class: 'dialog-msg' }, message) : null,
        h('div', { class: 'dialog-actions' },
          hideCancel ? null : h('button', { class: 'btn ghost', type: 'button', onclick: () => finish(false) }, cancelText),
          okBtn)));
    document.body.append(overlay);
    okBtn.focus();
  });
}

/* ───────── 5. 화면 위쪽 띠(배너), 맨 아래 버전 표시 ───────── */
export function setBanner(key, text) {
  const box = document.getElementById('banners');
  let el = box.querySelector(`[data-key="${key}"]`);
  if (!text) { if (el) el.remove(); return; }
  if (!el) { el = h('div', { class: 'banner', dataset: { key } }); box.append(el); }
  el.textContent = text;
}

export function initConnectionBanner() {
  const update = () => setBanner('offline', navigator.onLine ? null : '인터넷 연결이 끊겼어요. 연결되면 자동으로 이어져요.');
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

export function initFooter() {
  const el = document.getElementById('version');
  if (el) el.textContent = APP_VERSION;
}

export function setFooterExtra(text) {
  const el = document.getElementById('version');
  if (el) el.textContent = text ? `${APP_VERSION} · ${text}` : APP_VERSION;
}

/* ───────── 6. 오류 안내 (3-14) ───────── */
let fatalEl = null;

export function showFatal({ title, body, extra, retry }) {
  if (fatalEl) return;
  fatalEl = h('div', { class: 'overlay fatal', role: 'alertdialog', 'aria-modal': 'true' },
    h('div', { class: 'dialog' },
      mascot(84, 'wow'),
      h('h3', null, title),
      body ? h('p', { class: 'dialog-msg' }, body) : null,
      extra ? h('p', { class: 'muted' }, extra) : null,
      h('div', { class: 'dialog-actions' },
        retry ? h('button', { class: 'btn ghost', type: 'button', onclick: () => { fatalEl.remove(); fatalEl = null; retry(); } }, '다시 시도') : null,
        h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, '새로고침'))));
  document.body.append(fatalEl);
}

/** Firestore 오류를 종류별로 알맞게 안내해요. opts.teacher가 true면 선생님용 설명이 더 붙어요. */
export function handleError(err, opts = {}) {
  console.error('[오류]', err);
  const code = (err && err.code) || '';
  const msg = String((err && err.message) || '');
  if (code === 'resource-exhausted') {
    showFatal({
      title: '오늘 사용 한도에 도달했어요',
      body: '내일 다시 이용해 주세요.',
      extra: opts.teacher ? '무료 사용량은 한국 시간 오후 4~5시쯤(11월 2일부터는 5시쯤) 초기화돼요.' : null
    });
  } else if (code === 'permission-denied') {
    showFatal({
      title: '데이터베이스 규칙이 게시되지 않았어요',
      body: opts.teacher
        ? 'Firebase 콘솔 → Firestore Database → 규칙 탭에서 완전 개방 규칙(allow read, write: if true)을 게시해 주세요.'
        : '선생님께 알려 주세요.'
    });
  } else if (code === 'unavailable' || code === 'deadline-exceeded' || /offline|network|Failed to fetch/i.test(msg)) {
    toast('인터넷 연결을 확인해 주세요.', 'warn', { ms: 6000, actionText: opts.retry ? '다시 시도' : null, onAction: opts.retry });
  } else {
    toast(`문제가 생겼어요: ${msg || code || '알 수 없는 오류'}`, 'error', { ms: 6000 });
  }
}

/* ───────── 7. 전체화면 ───────── */
export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { toast('이 기기에서는 전체화면을 쓸 수 없어요.', 'warn'); }
}

/* ───────── 8. 효과음 (Web Audio로 코드에서 만들어요. 소리 파일이 필요 없어요) ─────────
   기본값: 학생 켜짐, 발표 창 켜짐, 교사 창은 "발표 창이 열려 있으면 조용히" (3-9)
   브라우저는 사용자가 화면을 한 번 누르기 전에는 소리를 못 내게 막아서, 첫 터치 때 소리를 켜 둬요. */
let audioCtx = null;
let soundEnabled = true;
let soundRole = 'student';
let lastBeaconAt = 0;
let soundListenersReady = false;
let beaconChannel = null;

export function initSound(role) {
  soundRole = role;
  soundEnabled = storeGet(`malrang_sound_${role}`) !== '0';
  if (!soundListenersReady) {
    soundListenersReady = true;
    const unlock = () => { unlockAudio(); };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
  }
  if (role === 'teacher' && 'BroadcastChannel' in window) {
    try {
      const ch = new BroadcastChannel('malrang-present');
      ch.onmessage = () => { lastBeaconAt = Date.now(); };
    } catch { /* 무시 */ }
  }
}

/** 발표 창이 3초마다 "나 여기 있어요" 신호를 보내요(교사 창이 이걸 듣고 조용해져요). */
export function startBeacon() {
  if (!('BroadcastChannel' in window)) return;
  try {
    beaconChannel = new BroadcastChannel('malrang-present');
    const send = () => beaconChannel.postMessage('alive');
    send();
    setInterval(send, TIMES.beaconMs);
  } catch { /* 무시 */ }
}

export async function unlockAudio() {
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      audioCtx = new AC();
    }
    if (audioCtx.state !== 'running') await audioCtx.resume();
    return audioCtx.state === 'running';
  } catch { return false; }
}

function audible() {
  if (!soundEnabled) return false;
  if (soundRole === 'teacher' && Date.now() - lastBeaconAt < TIMES.beaconLostMs) return false;
  return true;
}

function tone(freq, startSec, durSec, type = 'sine', vol = 0.18, endFreq = null) {
  const t = audioCtx.currentTime + startSec;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + durSec);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durSec);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + durSec + 0.05);
}

const SOUNDS = {
  correct: () => { tone(1046, 0, 0.14); tone(1318, 0.12, 0.26); },
  wrong: () => { tone(220, 0, 0.2, 'sawtooth', 0.1); tone(165, 0.18, 0.32, 'sawtooth', 0.1); },
  flip: () => { tone(380, 0, 0.16, 'triangle', 0.14, 900); },
  tick: () => { tone(880, 0, 0.06, 'square', 0.05); },
  timeup: () => { tone(660, 0, 0.16, 'triangle'); tone(520, 0.2, 0.16, 'triangle'); tone(392, 0.4, 0.4, 'triangle'); },
  fanfare: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.13, 0.26, 'triangle')); tone(1318, 0.55, 0.6, 'sine'); }
};
export const SOUND_NAMES = [
  ['correct', '정답'], ['wrong', '오답'], ['flip', '카드 뒤집기'], ['tick', '카운트다운'], ['timeup', '시간 끝'], ['fanfare', '결과 팡파르']
];

/** 효과음 재생. opts.force가 true면 소리 끔/발표 창 조용 설정과 상관없이 들려줘요(소리 테스트용). */
export async function playSound(name, opts = {}) {
  if (!opts.force && !audible()) return;
  const ok = await unlockAudio();
  if (!ok || !SOUNDS[name]) return;
  SOUNDS[name]();
}

/** 화면 오른쪽 위에 놓는 소리 켬/끔 버튼 */
export function soundToggleButton() {
  const btn = h('button', { class: 'icon-btn', type: 'button' });
  const refresh = () => {
    btn.textContent = soundEnabled ? '🔊' : '🔇';
    btn.title = soundEnabled
      ? (soundRole === 'teacher' ? '소리 켜짐 (발표 창이 열려 있으면 TV에서만 나요)' : '소리 켜짐')
      : '소리 꺼짐';
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    storeSet(`malrang_sound_${soundRole}`, soundEnabled ? '1' : '0');
    refresh();
    if (soundEnabled) playSound('tick', { force: true });
  });
  refresh();
  return btn;
}

/* ───────── 9. 화면 위쪽 제목 띠 ───────── */
export function topBar({ title, sub, left, right }) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-left' }, left || null, mascot(40), h('div', { class: 'topbar-title' }, h('strong', null, title), sub ? h('span', { class: 'muted' }, sub) : null)),
    h('div', { class: 'topbar-right' }, right || null));
}
