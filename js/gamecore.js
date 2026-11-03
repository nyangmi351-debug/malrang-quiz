// js/gamecore.js — 게임 공통 부품: 게임 상태(gameState) 바꾸기, 시작/종료, 임시 문서 정리, 타이머 틱
//
// gameState는 방 문서 안에 있는 "지금 무슨 게임을 어디까지 했는지" 기록이에요.
//   { mode, phase, round, startedAt, phaseEndsAt, gameId, seq, driverId, payload, finalSummary }
// 상태를 바꾸는 일(전환)은 모두 "교사 화면 한 곳(driverId)"만 하고, 바꿀 때마다 seq가 1씩 올라가요.
// 트랜잭션으로 "내가 아는 seq가 맞을 때만" 바꾸기 때문에, 교사 창이 둘이어도 꼬이지 않아요.

import { randomId } from './core.js';
import { TIMES } from './config.js';
import * as D from './db.js';

export const GAME_MODES = ['live', 'tele', 'speed_group', 'speed_all'];
export const isGameMode = (m) => GAME_MODES.includes(m);
export const newGameId = () => randomId(6);

export const MODE_LABEL = { live: '라이브 퀴즈', tele: '텔레스트레이션', speed_group: '모둠 스피드 퀴즈', speed_all: '전체 스피드 퀴즈', confirm: '참가자 확인', ranking: '개인 점수 순위' };

export function idleState(seq) {
  return { mode: 'idle', phase: '', round: 0, startedAt: null, phaseEndsAt: null, gameId: '', seq, driverId: '', payload: null, finalSummary: null };
}

/* ═════════ 1. 상태 전환 (트랜잭션) ═════════ */

/**
 * 내가 아는 seq와 driverId가 맞을 때만 gameState를 바꿔요. patch의 키는 gameState 안의 이름이에요.
 * 예) { phase:'reveal', phaseEndsAt: 123, 'payload.results.q3': {...} }
 * 돌려주는 값: 성공하면 true, 이미 다른 곳에서 바꿨으면 false
 */
export async function transition(code, expectSeq, driverId, patch) {
  const ref = D.roomRef(code);
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const gs = snap.exists() ? snap.data().gameState : null;
    if (!gs || gs.seq !== expectSeq || (driverId && gs.driverId !== driverId)) return false;
    const upd = { 'gameState.seq': gs.seq + 1 };
    for (const [k, v] of Object.entries(patch)) upd[`gameState.${k}`] = v;
    tx.update(ref, upd);   // [쓰기]
    return true;
  });
}

/** 참가자 확인 시작(또는 다시 확인). idle/ranking/confirm 상태에서만 가능해요. */
export async function beginConfirm(code, driverId) {
  const ref = D.roomRef(code);
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const gs = snap.data().gameState;
    if (!['idle', 'ranking', 'confirm'].includes(gs.mode)) return null;
    const pingId = randomId(6);
    tx.update(ref, { gameState: { ...idleState(gs.seq + 1), mode: 'confirm', phase: 'ping', startedAt: D.now(), phaseEndsAt: D.now() + TIMES.pingWaitSec * 1000, gameId: newGameId(), driverId, payload: { pingId } } });   // [쓰기]
    return pingId;
  });
}

/** 게임 시작: confirm(또는 idle) 상태에서 새 게임 상태로 바꿔요. settingsPatch는 설정에 같이 기억해 둘 값이에요. */
export async function startGame(code, expectSeq, driverId, fields, settingsPatch = {}) {
  const ref = D.roomRef(code);
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const gs = snap.data().gameState;
    if (gs.seq !== expectSeq || !['idle', 'confirm'].includes(gs.mode)) return false;
    const upd = { gameState: { ...idleState(gs.seq + 1), startedAt: D.now(), driverId, finalSummary: null, round: 0, ...fields } };
    for (const [k, v] of Object.entries(settingsPatch)) upd[`settings.${k}`] = v;
    tx.update(ref, upd);   // [쓰기]
    return true;
  });
}

/** 게임 끝/중단: idle로 되돌려요. gameId를 주면 그 게임일 때만 해요. */
export async function resetToIdle(code, gameId) {
  const ref = D.roomRef(code);
  return D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const gs = snap.data().gameState;
    if (gameId !== undefined && gs.gameId !== gameId) return false;
    tx.update(ref, { gameState: idleState(gs.seq + 1) });   // [쓰기]
    return true;
  });
}

/** 다른 교사 창에서 진행 넘겨받기: driverId만 내 창으로 바꿔요 */
export async function takeover(code, driverId) {
  const ref = D.roomRef(code);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const gs = snap.data().gameState;
    tx.update(ref, { 'gameState.driverId': driverId, 'gameState.seq': gs.seq + 1 });   // [쓰기]
  });
}

/** 개인 점수 순위를 TV(발표 창)에만 띄우거나 내려요 */
export async function setRankingMode(code, on) {
  const ref = D.roomRef(code);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const gs = snap.data().gameState;
    if (on && gs.mode === 'idle') tx.update(ref, { gameState: { ...idleState(gs.seq + 1), mode: 'ranking', phase: 'show' } });   // [쓰기]
    else if (!on && gs.mode === 'ranking') tx.update(ref, { gameState: idleState(gs.seq + 1) });   // [쓰기]
  });
}

/* ═════════ 2. 임시 문서 정리 ═════════ */
/**
 * 게임이 끝나거나 중단되면 그 gameId의 임시 문서(응답, 투표, 그림 단계, 결과 번들, 요약)를 지워요.
 * known: 교사 화면이 게임 중에 직접 본 문서 ID 모음. 있으면 읽지 않고 바로 지우고,
 * 마지막에 같은 gameId의 남은 문서가 없는지 한 번 확인해요(없으면 읽기 1건).
 */
export async function cleanupGameDocs(code, gameId, known) {
  if (!gameId) return 0;
  const ids = new Set(known || []);
  ids.add('summary'); ids.add('livecards'); ids.add(`tvview_${gameId}`);
  let n = 0;
  await D.batchEach([...ids], (b, id) => b.delete(D.gameDoc(code, id)));   // [삭제] 존재하지 않는 ID를 지워도 문제없어요
  n += ids.size;
  const rest = await D.getDocs(D.query(D.gamesCol(code), D.where('gameId', '==', gameId)));   // [읽기] 남은 것 확인
  if (!rest.empty) { await D.batchEach(rest.docs, (b, d) => b.delete(d.ref)); n += rest.size; }   // [삭제]
  return n;
}

/** 특정 판(텔레스트레이션)의 임시 문서만 지워요 */
export async function cleanupPlayDocs(code, gameId, play, known) {
  const ids = new Set(known || []);
  if (ids.size) await D.batchEach([...ids], (b, id) => b.delete(D.gameDoc(code, id)));   // [삭제]
  const rest = await D.getDocs(D.query(D.gamesCol(code), D.where('gameId', '==', gameId), D.where('play', '==', play)));   // [읽기]
  if (!rest.empty) await D.batchEach(rest.docs, (b, d) => b.delete(d.ref));   // [삭제]
}

/* ═════════ 3. 타이머 틱 ═════════
   교사 창이 가려져도 늦어지지 않게, 틱을 Web Worker(별도 일꾼)에서 만들어요. 만들 수 없으면 setInterval로 대신해요. */
export function createTicker(onTick, ms = 250) {
  let worker = null, timer = null, url = null;
  try {
    const blob = new Blob([`setInterval(function(){postMessage(1)}, ${ms});`], { type: 'text/javascript' });
    url = URL.createObjectURL(blob);
    worker = new Worker(url);
    worker.onmessage = () => onTick();
    worker.onerror = () => { stopWorker(); timer = setInterval(onTick, ms); };
  } catch { timer = setInterval(onTick, ms); }
  function stopWorker() { if (worker) { worker.terminate(); worker = null; } if (url) { URL.revokeObjectURL(url); url = null; } }
  return { stop() { stopWorker(); if (timer) { clearInterval(timer); timer = null; } }, usingWorker: () => !!worker };
}

/* ═════════ 4. 참가자와 모둠 계산 ═════════ */
const msOf = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : 0));

/** 학생들을 접속 순서(joinedAt, 같으면 ID순)로 정렬 */
export function sortByJoin(students) {
  return [...students].sort((a, b) => msOf(a.joinedAt) - msOf(b.joinedAt) || (a.id < b.id ? -1 : 1));
}

/**
 * 참가자 ID 목록 → 모둠별 접속 순서 목록과 이름표.
 * 돌려주는 값: { groups: {'1':[id,..]}, names: {id: 닉네임}, small: [작아서 참여 못 하는 모둠 번호], valid: [참여 가능한 모둠 번호] }
 */
export function planGroups(students, participantIds, groupCount, minSize = 3) {
  const set = new Set(participantIds);
  const chosen = sortByJoin(students.filter((s) => set.has(s.id)));
  const groups = {}, names = {};
  chosen.forEach((s) => { names[s.id] = s.nickname; });
  for (let g = 1; g <= groupCount; g++) groups[g] = chosen.filter((s) => s.groupId === g).map((s) => s.id);
  const valid = [], small = [];
  for (let g = 1; g <= groupCount; g++) {
    if (groups[g].length >= minSize) valid.push(g);
    else if (groups[g].length > 0) small.push(g);
  }
  return { groups, names, valid, small, noGroup: chosen.filter((s) => !(s.groupId >= 1 && s.groupId <= groupCount)).map((s) => s.id) };
}

/** 점수판용: 모둠 번호 → 점수 */
export function groupScoreList(scores, groupNums) {
  return groupNums.map((g) => ({ g, score: (scores && (scores[g] ?? scores[`g${g}`])) || 0 })).sort((a, b) => b.score - a.score || a.g - b.g);
}
