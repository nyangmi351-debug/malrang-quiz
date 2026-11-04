// js/core.js — 작은 도구 모음 (화면 조각 만들기, 글자 정리, 저장소, 주소 만들기, QR)
// 이 파일은 Firebase를 쓰지 않아요. 그래서 다른 파일 어디서든 안심하고 불러올 수 있어요.

import { LIMITS } from './config.js';

/* ───────── 1. 화면 조각 만들기 ─────────
   h('div', { class: 'card' }, '안녕') 처럼 쓰면 <div class="card">안녕</div> 이 만들어져요.
   글자는 항상 "글자 그대로" 들어가요(innerHTML을 쓰지 않아서 학생이 이상한 코드를 넣어도 안전해요). */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, val] of Object.entries(props)) {
      if (val === undefined || val === null || val === false) continue;
      if (key === 'class') {
        el.className = val;
      } else if (key === 'style' && typeof val === 'object') {
        for (const [sk, sv] of Object.entries(val)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (key === 'dataset') {
        Object.assign(el.dataset, val);
      } else if (key.startsWith('on') && typeof val === 'function') {
        el.addEventListener(key.slice(2), val);
      } else if (key in el) {
        el[key] = val;
      } else {
        el.setAttribute(key, val === true ? '' : String(val));
      }
    }
  }
  appendKids(el, children);
  return el;
}

function appendKids(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** 화면(root)의 내용을 통째로 바꿔요. */
export function mount(root, ...nodes) {
  clear(root);
  appendKids(root, nodes);
  return root;
}

/* ───────── 2. 글자 정리 ───────── */

/** 닉네임 → 학생 문서 ID. NFC, 앞뒤 공백 제거, 연속 공백 하나로, 영문 소문자. (3-1, 2-3) */
export function normalizeNickname(text) {
  return String(text ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 단어 → 단어 문서 ID와 중복 검사용 키. 공백·문장부호·기호를 모두 지워요. (3-1) */
export function normalizeKey(text) {
  return String(text ?? '').normalize('NFC').trim().replace(/[\p{P}\p{S}\p{Z}\s]/gu, '').toLowerCase();
}

const NICK_PATTERN = /^[0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ ]+$/;

/** 닉네임 검사. 통과하면 { ok:true, nickname, id }, 아니면 { ok:false, message } */
export function validateNickname(raw) {
  const nickname = String(raw ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!nickname) return { ok: false, message: '닉네임을 입력해 주세요.' };
  if ([...nickname].length > LIMITS.nickname) return { ok: false, message: `닉네임은 ${LIMITS.nickname}글자까지 쓸 수 있어요.` };
  if (!NICK_PATTERN.test(nickname)) return { ok: false, message: '닉네임에는 한글, 영문, 숫자, 띄어쓰기만 쓸 수 있어요.' };
  return { ok: true, nickname, id: normalizeNickname(nickname) };
}

/* ───────── 3. 방 코드 ───────── */

// 헷갈리는 0(영), O(오), 1(일), I(아이)는 쓰지 않아요 → 24 + 8 = 32가지 글자
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode() {
  const nums = new Uint32Array(6);
  crypto.getRandomValues(nums);
  return Array.from(nums, (n) => ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]).join('');
}

/** 사람이 입력한 방 코드를 정리해요. 소문자는 대문자로 바꿔 줘요. */
export function parseRoomCode(raw) {
  const code = String(raw ?? '').replace(/\s/g, '').toUpperCase();
  const hasBadChar = /[01OI]/.test(code);
  const valid = /^[A-HJ-NP-Z2-9]{6}$/.test(code);
  return { code, valid, hasBadChar };
}

/* ───────── 4. 저장소(브라우저 안에 기억해 두기) ───────── */
export function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
export function storeSet(key, val) { try { localStorage.setItem(key, val); return true; } catch { return false; } }
export function storeRemove(key) { try { localStorage.removeItem(key); } catch { /* 무시 */ } }
export function storeGetJson(key) { try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : null; } catch { return null; } }
export function storeSetJson(key, obj) { return storeSet(key, JSON.stringify(obj)); }

export function sessionGet(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
export function sessionSet(key, val) { try { sessionStorage.setItem(key, val); return true; } catch { return false; } }
export function sessionRemove(key) { try { sessionStorage.removeItem(key); } catch { /* 무시 */ } }

export function randomId(len = 6) {
  const nums = new Uint32Array(len);
  crypto.getRandomValues(nums);
  return Array.from(nums, (n) => ROOM_CODE_ALPHABET[n % ROOM_CODE_ALPHABET.length]).join('');
}

/** 이 브라우저 탭의 이름표. 교사 창이 여러 개일 때 구분하려고 써요(다음 단계부터). */
export function getTabId() {
  let id = sessionGet('malrang_tab_id');
  if (!id) { id = randomId(6); sessionSet('malrang_tab_id', id); }
  return id;
}

/* ───────── 5. 주소 만들기 ───────── */
// GitHub Pages는 주소가 https://아이디.github.io/저장소이름/ 처럼 되어 있어서
// location.origin + location.pathname 으로 "지금 이 앱의 주소"를 그대로 만들어요.
export function baseUrl() { return location.origin + location.pathname; }
export function buildJoinUrl(code) { return `${baseUrl()}?room=${code}`; }
export function buildPresentUrl(code) { return `${baseUrl()}#present/${code}`; }

/* ───────── 6. 기타 ───────── */
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

export function formatDateTime(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
      document.body.append(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch { return false; }
  }
}

/* ───────── 7. QR 코드 ─────────
   qrcode.js를 필요할 때 한 번만 불러와요. 못 불러오면(학교 네트워크가 막은 경우 등)
   QR 대신 "주소를 글자로" 보여 주는 안내를 띄워요. */
const QR_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
let qrPromise = null;

export function loadQrLib() {
  if (typeof window !== 'undefined' && window.QRCode) return Promise.resolve(true);
  if (!qrPromise) {
    qrPromise = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = QR_URL;
      script.async = true;
      const timer = setTimeout(() => resolve(false), 5000);
      script.onload = () => { clearTimeout(timer); resolve(!!window.QRCode); };
      script.onerror = () => { clearTimeout(timer); qrPromise = null; resolve(false); };
      document.head.append(script);
    });
  }
  return qrPromise;
}

export async function renderQr(container, text, size = 168) {
  // 같은 상자에 여러 번 그려 달라고 해도 "마지막 요청" 하나만 그려요.
  // (예전에는 QR 라이브러리를 불러오는 동안 두 번 요청되면 QR이 2개 겹쳐 보였어요.)
  const mine = (container._qrSeq = (container._qrSeq || 0) + 1);
  clear(container);
  const ok = await loadQrLib();
  if (container._qrSeq !== mine) return false;   // 그 사이에 더 새로운 요청이 있었어요
  clear(container);                               // 혹시 남은 그림이 있으면 지우고 그려요
  if (ok) {
    try {
      new window.QRCode(container, { text, width: size, height: size, correctLevel: window.QRCode.CorrectLevel.M });
      return true;
    } catch { /* 아래 안내로 */ }
  }
  container.append(h('p', { class: 'qr-fallback' }, 'QR을 불러오지 못했어요. 아래 주소를 직접 입력해 주세요.'));
  return false;
}


/** 주소 뒤에 "새로 받기 표시(_r)"를 붙여서 다시 열어요. 브라우저가 기억해 둔 예전 파일 대신 새 파일을 받아 와요.
 *  (index.html이 파일 이름 뒤에 _r 값을 붙여서 불러와요) */
export function hardReload() {
  try {
    const u = new URL(location.href);
    u.searchParams.set('_r', Date.now().toString(36));
    location.replace(u.toString());
  } catch { location.reload(); }
}
