// js/tele-draw.js — 그림판(캔버스) 부품: 펜·지우개·되돌리기, 손바닥 방지, 그림 저장(작게 줄여 WebP/PNG 글자로)
// Firebase를 쓰지 않아요.

import { h, sessionGet, sessionSet, sessionRemove } from './core.js';

const W = 720, H = 540;            // 그리는 크기(화면에는 크게 보여요)
const MAX_DATA = 120 * 1024;       // 저장되는 그림 글자(data URL)는 120KB 이하

/** 캔버스를 줄여서 글자(data URL)로 만들어요. 너무 크면 품질 → 크기 순으로 낮춰 다시 만들어요. */
export function encodeCanvas(src) {
  const make = (w, hh, q) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, hh * 0, w, hh);
    x.drawImage(src, 0, 0, w, hh);
    return q ? c.toDataURL('image/webp', q) : c.toDataURL('image/png');
  };
  let out = make(360, 270, 0.7);
  const webp = out.startsWith('data:image/webp');   // 접두어로 실제 형식을 확인해요(지원 안 하면 PNG로 돌아와요)
  if (out.length <= MAX_DATA) return out;
  const sizes = [[360, 270], [288, 216], [216, 162]];
  for (const [w, hh] of sizes) {
    if (webp) { for (const q of [0.7, 0.6, 0.5, 0.4]) { out = make(w, hh, q); if (out.length <= MAX_DATA) return out; } }
    else { out = make(w, hh, 0); if (out.length <= MAX_DATA) return out; }   // PNG는 품질이 없어서 크기만 줄여요
  }
  return out;
}

/** 시험용 낙서 그림(가짜 학생이 써요) */
export function scribbleData() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#111'; x.lineWidth = 6; x.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    x.beginPath(); x.moveTo(Math.random() * W, Math.random() * H);
    x.bezierCurveTo(Math.random() * W, Math.random() * H, Math.random() * W, Math.random() * H, Math.random() * W, Math.random() * H);
    x.stroke();
  }
  return encodeCanvas(c);
}

/**
 * 그림판. 돌려주는 값: { el, canvas, setTool, undo, hasInk, toData, lock, destroy }
 * storageKey: 그리던 획을 2.5초마다 sessionStorage에 저장해 두었다가 새로고침하면 되살려요.
 */
export function createDrawPad({ storageKey }) {
  const canvas = h('canvas', { class: 'draw-canvas', width: W, height: H, 'aria-label': '그림판' });
  canvas.style.touchAction = 'none';
  const ctx = canvas.getContext('2d');
  let strokes = [], cur = null, tool = 'pen', penSeen = false, activeId = null, dirty = false, locked = false;

  function drawSeg(s, from) {
    ctx.strokeStyle = s.t === 'e' ? '#fff' : '#111';
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = s.w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const p = s.p;
    if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath(); ctx.moveTo(p[from], p[from + 1]);
    for (let i = from + 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }
  function paintAll() {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    strokes.forEach((s) => drawSeg(s, 0));
  }
  const pt = (e) => {
    const r = canvas.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) * W) / r.width), Math.round(((e.clientY - r.top) * H) / r.height)];
  };

  canvas.addEventListener('pointerdown', (e) => {
    if (locked) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch' && penSeen) return;     // 펜이 있으면 손가락(손바닥)은 무시
    if (activeId !== null) return;                        // 처음 닿은 하나만 그려요
    e.preventDefault();
    activeId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 무시 */ }
    cur = { t: tool === 'eraser' ? 'e' : 'p', w: tool === 'eraser' ? 30 : 5, p: pt(e) };
    strokes.push(cur);
    drawSeg(cur, 0);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId || !cur) return;
    e.preventDefault();
    const from = cur.p.length - 2;
    const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    (list.length ? list : [e]).forEach((ev) => cur.p.push(...pt(ev)));
    drawSeg(cur, from);
  });
  const end = (e) => {
    if (e.pointerId !== activeId) return;
    activeId = null; cur = null; dirty = true;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  // 그리던 획 임시 보관
  try { const saved = JSON.parse(sessionGet(storageKey) || 'null'); if (Array.isArray(saved)) strokes = saved; } catch { strokes = []; }
  paintAll();
  const saver = setInterval(() => { if (dirty) { dirty = false; sessionSet(storageKey, JSON.stringify(strokes)); } }, 2500);

  return {
    el: canvas, canvas,
    setTool(t) { tool = t; },
    undo() { if (locked || !strokes.length) return; strokes.pop(); paintAll(); dirty = true; },
    hasInk() { return strokes.some((s) => s.t === 'p'); },
    toData() { return encodeCanvas(canvas); },
    lock() { locked = true; },
    clearSaved() { sessionRemove(storageKey); },
    destroy() { clearInterval(saver); if (dirty) sessionSet(storageKey, JSON.stringify(strokes)); }
  };
}
