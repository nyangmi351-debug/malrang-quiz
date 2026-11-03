// js/packs.js — 승인된 단어·문제를 "번들"(여러 개를 묶은 문서)로 만들고, 학생이 그걸 읽어 가는 일
// 왜 묶나요? 학생 24명이 단어 300개를 하나씩 읽으면 읽기가 7,200번이에요. 묶어 두면 24~48번이면 돼요.

import { storeGet, storeSet, storeRemove } from './core.js';
import { TIMES } from './config.js';
import { utf8Bytes } from './text.js';
import * as D from './db.js';

const mem = new Map();   // '방코드|종류' → { v, items }  (이번 접속 동안 기억해 두는 곳)
const cacheKey = (code, kind, v) => `malrang_pk_${code}_${kind}_${v}`;

/* ═════════ 1. 교사: 번들 만들기 ═════════ */

/** 승인된 항목만 골라 가볍게 줄여요 */
export function approvedItems(kind, list) {
  if (kind === 'words') {
    return list.filter((w) => w.status === 'approved')
      .map((w) => ({ id: w.key, word: w.word, type: w.type, meaning: w.meaning, example: w.example || '', imageUrl: w.imageUrl || '' }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  return list.filter((q) => q.status === 'approved')
    .map((q) => ({
      id: q.id, qType: q.qType, question: q.question, imageUrl: q.imageUrl || '', answer: q.answer || '', wrongs: q.wrongs || [],
      answers: q.answers || [], judgeMode: q.judgeMode || 'exact', createdBy: q.createdBy || ''
    }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** 한 문서가 UTF-8 바이트로 약 800KB를 넘지 않게 조각으로 나눠요(한글은 한 글자가 3바이트예요). */
export function splitItems(items, maxBytes = TIMES.bundleSplitBytes) {
  if (!items.length) return [];
  const parts = [[]];
  let size = 0;
  for (const it of items) {
    const b = utf8Bytes(it) + 2;
    if (size + b > maxBytes && parts[parts.length - 1].length) { parts.push([]); size = 0; }
    parts[parts.length - 1].push(it);
    size += b;
  }
  return parts;
}

/** 번들을 저장하고 방 문서의 packMeta(버전)를 갱신해요. 마지막에 meta를 써야 학생이 중간 상태를 읽지 않아요. */
export async function writeBundle(code, kind, items, prevParts = 0) {
  const v = Math.round(D.now());
  const parts = splitItems(items);
  for (let i = 0; i < parts.length; i++) {
    await D.setDoc(D.packRef(code, `${kind}_${i}`), { v, part: i, parts: parts.length, items: parts[i] });   // [쓰기]
  }
  for (let i = parts.length; i < prevParts; i++) await D.deleteDoc(D.packRef(code, `${kind}_${i}`));   // [삭제] 줄어든 조각
  await D.updateDoc(D.roomRef(code), { [`packMeta.${kind}`]: { v, parts: parts.length } });   // [쓰기]
  mem.set(`${code}|${kind}`, { v, items });
  return { v, parts: parts.length };
}

/**
 * 교사 화면의 자동 번들 동기화. 승인/수정/삭제가 있으면 schedule(kind)를 불러요.
 * 3초 동안 더 바뀌는 게 없으면 한 번에 저장해요(쓰기를 아끼려고).
 */
export function createBundleSync({ code, getList, getParts, onStatus }) {
  const timers = {};
  const pending = new Set();
  let chain = Promise.resolve();
  let running = 0;
  const lastParts = {};
  const status = (s) => onStatus && onStatus(s);

  function schedule(kind) {
    pending.add(kind);
    status('pending');
    clearTimeout(timers[kind]);
    timers[kind] = setTimeout(() => flushKind(kind), TIMES.bundleDebounceMs);
  }

  function flushKind(kind) {
    clearTimeout(timers[kind]);
    if (!pending.has(kind)) return chain;
    pending.delete(kind);
    chain = chain.then(async () => {
      const list = getList(kind);
      if (!list) return;
      running++;
      status('saving');
      try {
        const prev = lastParts[kind] ?? getParts(kind);
        const r = await writeBundle(code, kind, approvedItems(kind, list), prev);   // [쓰기]
        lastParts[kind] = r.parts;
      } catch (e) {
        console.error('[번들 저장 실패]', e);
        status('error');
        running--;
        return;
      }
      running--;
      if (!pending.size && !running) status('done');
    });
    return chain;
  }

  /** 기다리지 않고 지금 바로 저장(화면을 떠나거나 숨길 때, 게임을 시작하기 직전) */
  function flushNow() {
    return Promise.all([...pending].map(flushKind)).then(() => chain);
  }
  return { schedule, flushNow, hasPending: () => pending.size > 0 || running > 0 };
}

/* ═════════ 2. 학생·교사: 번들 읽기 ═════════ */

function purgeOld(code, kind, keepV) {
  try {
    const prefix = `malrang_pk_${code}_${kind}_`;
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== cacheKey(code, kind, keepV)) drop.push(k);
    }
    drop.forEach((k) => storeRemove(k));
  } catch { /* 무시 */ }
}

/**
 * 번들을 가져와요. 이 기기에 같은 버전이 이미 있으면 읽지 않고(읽기 0건) 그걸 써요.
 * meta: 방 문서의 packMeta[kind] ({v, parts})
 */
export async function loadBundle(code, kind, meta, { force = false } = {}) {
  if (!meta || !meta.parts) return [];
  const mk = `${code}|${kind}`;
  const m = mem.get(mk);
  if (m && m.v >= meta.v && !force) return m.items;
  if (!force) {
    const cached = storeGet(cacheKey(code, kind, meta.v));
    if (cached) {
      try {
        const items = JSON.parse(cached);
        mem.set(mk, { v: meta.v, items });
        return items;
      } catch { /* 깨진 저장분이면 새로 읽어요 */ }
    }
  }
  let docs = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    docs = await Promise.all(Array.from({ length: meta.parts }, (_, i) => D.getDocFromServer(D.packRef(code, `${kind}_${i}`))));   // [읽기] 조각 수만큼
    const vs = new Set(docs.map((d) => (d.exists() ? d.data().v : -1)));
    if (vs.size === 1) break;   // 모든 조각의 버전이 같아야 해요(교사가 갱신하는 도중에 읽었다면 한 번 더 읽어요)
  }
  const items = docs.flatMap((d) => (d.exists() ? d.data().items : []));
  const v = docs[0] && docs[0].exists() ? docs[0].data().v : meta.v;
  mem.set(mk, { v, items });
  const saved = storeSet(cacheKey(code, kind, v), JSON.stringify(items));
  if (saved) purgeOld(code, kind, v);   // 저장 공간이 모자라면 저장하지 않고 이번 접속 동안만 기억해요
  return items;
}

export function forgetPacks(code) { mem.delete(`${code}|words`); mem.delete(`${code}|questions`); }
