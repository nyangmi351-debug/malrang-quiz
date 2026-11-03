// js/tele-core.js — 텔레스트레이션 공용 부품 (계획 세우기, 누가 어느 체인을 맡는지, 단계 문서 쓰기, 결과 번들 만들기·읽기)
//
// 용어
//   판(play)  : 제시어를 바꿔 가며 여러 번 할 수 있어요.   체인(c) : 제시어 하나가 여러 사람 손을 거쳐 가는 줄.   단계(r) : 체인 안의 차례(1부터).
//   홀수 단계 = 그림, 짝수 단계 = 글.  마지막 단계는 반드시 글(그래서 단계 수 L은 짝수).
//   체인 c의 r단계 담당 = 모둠 순서표의 (c + r − 1) mod N 번째 친구  →  모든 친구가 매 라운드 체인 하나씩 맡아서 쉬는 사람이 없어요.

import { shuffle, utf8Bytes, isCorrect, judgeModeOf } from './text.js';
import { TIMES } from './config.js';
import * as D from './db.js';

export const stepId = (gameId, play, g, c, r) => `tele_${gameId}_${play}_g${g}_c${c}_r${r}`;
export const resId = (gameId, play, g, part) => `teleres_${gameId}_${play}_g${g}_${part}`;
export const tvId = (gameId) => `tvview_${gameId}`;
export const typeOfStep = (r) => (r % 2 === 1 ? 'draw' : 'text');
export const MAX_TEXT = 60;

const evenDown = (n) => (n % 2 === 0 ? n : n - 1);
/** 정한 단계 수를 모둠 인원에 맞춰요: 짝수이고 인원 N 이하, 최소 2 */
export function stepsFor(requestedL, N) {
  const L = Math.max(2, evenDown(requestedL));
  return L <= N ? L : Math.max(2, evenDown(N));
}

/**
 * 새 판 계획.  groups: { 1:[학생ID..] }  words: [{id,w,t}]  used: 이미 쓴 단어 id 목록
 * 돌려주는 값: { plan:{ g1:{ members, words, L } }, used, rounds }
 */
export function makePlan({ groups, requestedL, words, used = [] }) {
  const need = Object.values(groups).reduce((a, ids) => a + ids.length, 0);
  let usedSet = new Set(used);
  let pool = words.filter((w) => !usedSet.has(w.id));
  if (pool.length < need) { pool = [...words]; usedSet = new Set(); }   // 새 제시어가 모자라면 처음부터 다시 써요
  pool = shuffle(pool);
  const plan = {};
  let idx = 0;
  for (const [g, ids] of Object.entries(groups)) {
    const members = shuffle(ids);                       // 순서표 0~N−1은 무작위
    const ws = members.map(() => { const w = pool[idx % pool.length]; idx++; usedSet.add(w.id); return w; });
    plan[`g${g}`] = { members, words: ws, L: stepsFor(requestedL, members.length) };
  }
  return { plan, used: [...usedSet], rounds: Math.max(...Object.values(plan).map((p) => p.L)) };
}

/** 이 친구가 라운드 r에 맡을 체인. 모둠에 없으면 null, 이미 끝난 모둠이면 { idle:true } */
export function turnOf(planG, r, meId) {
  if (!planG) return null;
  const N = planG.members.length;
  const m = planG.members.indexOf(meId);
  if (m < 0) return null;
  if (r > planG.L) return { idle: true };
  const c = (((m - (r - 1)) % N) + N) % N;
  return { c, N, r, type: typeOfStep(r), word: r === 1 ? planG.words[c] : null, last: r === planG.L };
}
export const authorOf = (planG, c, r) => planG.members[(c + r - 1) % planG.members.length];

/** 라운드 r에 문서가 몇 개 모여야 하는지(끝난 모둠은 빼고 센다) */
export function expectedCount(plan, r) {
  return Object.values(plan).reduce((a, p) => a + (r <= p.L ? p.members.length : 0), 0);
}
export const groupNums = (plan) => Object.keys(plan).map((k) => Number(k.slice(1))).sort((a, b) => a - b);
/** 결과 페이지 순서: 1모둠의 체인들 → 2모둠의 체인들 … (마지막에 점수 순위 페이지를 더해요) */
export function pageList(plan) {
  const pages = [];
  groupNums(plan).forEach((g) => { for (let c = 0; c < plan[`g${g}`].members.length; c++) pages.push({ g, c }); });
  return pages;
}

/* ═════════ 단계 문서 쓰기 (트랜잭션: 이미 있으면 건드리지 않아요) ═════════ */
/** 학생 제출. 돌려주는 값: 'ok' | 'late'(이미 있음 — 마감으로 비워졌거나 두 번 눌렀어요) */
export async function submitStep(code, s, data) {
  const ref = D.gameDoc(code, stepId(s.gameId, s.play, s.g, s.c, s.r));
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (snap.exists()) return 'late';
    tx.set(ref, { gameId: s.gameId, kind: 'tele', play: s.play, g: s.g, c: s.c, r: s.r, type: s.type, data, by: s.by, sid: s.sid, locked: false });   // [쓰기]
    return 'ok';
  });
}
/** 교사: 마감까지 못 낸 단계를 빈 칸으로 채워요(locked). 이미 있으면 그대로 둬요. 새로 만들었으면 문서 데이터를, 아니면 null */
export async function fillStep(code, s) {
  const ref = D.gameDoc(code, stepId(s.gameId, s.play, s.g, s.c, s.r));
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (snap.exists()) return null;
    const doc = { gameId: s.gameId, kind: 'tele', play: s.play, g: s.g, c: s.c, r: s.r, type: s.type, data: '', by: s.by, sid: s.sid, locked: true };
    tx.set(ref, doc);   // [쓰기]
    return doc;
  });
}

/* ═════════ 결과 번들 ═════════ */
/** 한 모둠의 단계 문서들 → 체인 목록 */
export function buildChains(planG, steps, nameOf, threshold) {
  const N = planG.members.length;
  const chains = [];
  for (let c = 0; c < N; c++) {
    const w = planG.words[c];
    const list = [];
    for (let r = 1; r <= planG.L; r++) {
      const d = steps.get(r + ':' + c);
      list.push({ r, type: typeOfStep(r), data: d ? d.data : '', by: nameOf(authorOf(planG, c, r)), locked: d ? !!d.locked : true });
    }
    const final = list[list.length - 1];
    const answer = final && final.type === 'text' ? final.data : '';
    chains.push({ c, word: w.w, wtype: w.t, steps: list, final: answer, correct: !!answer && isCorrect(answer, w.w, judgeModeOf(w.t), threshold) });
  }
  return chains;
}

/** 번들 조각 나누기: 체인 경계에서만 나누고, 체인 하나가 너무 크면 단계 단위로 나눠요(cont:true로 이어 붙임 표시) */
export function splitChains(chains, maxBytes = TIMES.bundleSplitBytes) {
  const parts = [[]];
  let size = 0;
  const push = (item) => {
    const b = utf8Bytes(item) + 2;
    if (size + b > maxBytes && parts[parts.length - 1].length) { parts.push([]); size = 0; }
    parts[parts.length - 1].push(item); size += b;
  };
  for (const ch of chains) {
    if (utf8Bytes(ch) + 2 <= maxBytes) { push(ch); continue; }
    let piece = { ...ch, steps: [] }, psize = 0, first = true;
    for (const st of ch.steps) {
      const b = utf8Bytes(st) + 2;
      if (psize + b > maxBytes && piece.steps.length) { push(piece); piece = { c: ch.c, word: ch.word, wtype: ch.wtype, steps: [], cont: true }; psize = 0; first = false; }
      piece.steps.push(st); psize += b;
    }
    if (piece.steps.length) { if (!first) piece.final = ch.final; push(piece); }
  }
  return parts;
}

/** 번들 저장. 만든 문서 ID와 조각 수를 돌려줘요 */
export async function writeResults(code, gameId, play, g, chains) {
  const parts = splitChains(chains);
  const ids = parts.map((_, i) => resId(gameId, play, g, i));
  await D.batchEach(parts.map((p, i) => ({ p, i })), (b, { p, i }) => b.set(D.gameDoc(code, ids[i]), { gameId, kind: 'teleres', play, g, part: i, parts: parts.length, chains: p }));   // [쓰기] 조각 수만큼
  return { parts: parts.length, ids, chains: chains.length };
}

/** 번들 읽기(조각마다 1읽기). 체인 번호순으로 합쳐서 돌려줘요 */
export async function readResults(code, gameId, play, g, parts) {
  const snaps = await Promise.all(Array.from({ length: parts }, (_, i) => D.getDocFromServer(D.gameDoc(code, resId(gameId, play, g, i)))));   // [읽기] 조각 수만큼
  const byC = new Map();
  snaps.forEach((s) => {
    if (!s.exists()) return;
    for (const ch of s.data().chains) {
      const have = byC.get(ch.c);
      if (!have) byC.set(ch.c, { ...ch, steps: [...ch.steps] });
      else { have.steps.push(...ch.steps); if (ch.final !== undefined) { have.final = ch.final; have.correct = ch.correct; } }
    }
  });
  return [...byC.values()].map((ch) => ({ ...ch, steps: ch.steps.sort((a, b) => a.r - b.r) })).sort((a, b) => a.c - b.c);
}
