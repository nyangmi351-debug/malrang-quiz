// js/db.js — Firebase(데이터베이스)와 이야기하는 모든 일을 이 파일에서 해요.
// 다른 파일들은 Firebase 주소를 직접 쓰지 않고, 여기서 내보내는 함수만 불러다 써요.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  initializeFirestore, doc, collection, getDoc, getDocs, getDocFromServer, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, startAfter, writeBatch, runTransaction,
  serverTimestamp, increment, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig, ROOM_LIST_LIMIT } from './config.js';
import { makeRoomCode } from './core.js';

export const SDK_VERSION = '10.14.1';

// 다른 파일에서 쓸 수 있도록 그대로 다시 내보내요
export {
  doc, collection, getDoc, getDocs, getDocFromServer, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, startAfter, writeBatch, runTransaction,
  serverTimestamp, increment, arrayUnion
};

/* ───────── 1. 시작하기 ───────── */
const app = initializeApp(firebaseConfig);
// 학교 네트워크(프록시·방화벽)에서 연결이 막히면 자동으로 다른 방식(롱폴링)으로 바꿔 줘요.
// 오프라인 저장(IndexedDB)은 쓰지 않고 메모리 캐시만 써요.
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

/* ───────── 2. 서버 시각 보정 (3-4) ─────────
   태블릿마다 시계가 조금씩 달라요. 서버에 시각을 남기는 쓰기를 한 번 하고,
   그 값을 읽어서 "내 시계와 서버 시계의 차이"를 알아 둬요. 앞으로 모든 타이머는 now()로 계산해요. */
let clockOffset = 0;
export function now() { return Date.now() + clockOffset; }
export function getClockOffset() { return clockOffset; }

/** writeFn: serverTimestamp를 ref의 field에 쓰는 함수. 끝나면 오차(ms)를 돌려줘요. */
export async function syncClock(writeFn, ref, field) {
  const t0 = Date.now();
  await writeFn();
  const t1 = Date.now();
  const snap = await getDocFromServer(ref);   // [읽기]
  const ts = snap.get(field);
  if (ts && typeof ts.toMillis === 'function') {
    clockOffset = ts.toMillis() - (t0 + t1) / 2;   // 쓰기 왕복의 한가운데에 서버가 시각을 찍었다고 봐요
  }
  return clockOffset;
}

/* ───────── 3. 주소(경로) 만들기 ───────── */
export const roomRef = (code) => doc(db, 'rooms', code);
export const studentsCol = (code) => collection(db, 'rooms', code, 'students');
export const studentRef = (code, id) => doc(db, 'rooms', code, 'students', id);
export const clockRef = (code) => doc(db, 'rooms', code, 'games', 'clock');

/* ───────── 4. 연결 테스트 (점검 도구) ─────────
   데이터베이스에 정말 쓰고 읽을 수 있는지 확인해요. diagnostics/ping 문서 하나만 써요. */
export async function connectionTest() {
  const ref = doc(db, 'diagnostics', 'ping');
  const t0 = Date.now();
  await setDoc(ref, { t: serverTimestamp(), by: 'connection-test' }, { merge: true });   // [쓰기]
  const t1 = Date.now();
  const snap = await getDocFromServer(ref);   // [읽기]
  const ts = snap.get('t');
  return {
    write: true,
    read: true,
    roundTripMs: Date.now() - t0,
    offsetMs: ts && ts.toMillis ? Math.round(ts.toMillis() - (t0 + t1) / 2) : null
  };
}

/* ───────── 5. 방 ───────── */

/** 새 방 문서의 첫 내용. 나중 단계에서 쓸 설정값도 미리 넣어 둬요. */
function newRoomData(roomName, groupCount) {
  return {
    roomName,
    createdAt: serverTimestamp(),
    settings: {
      groupCount, groupEpoch: 0, similarityThreshold: 0.85, cardVoteEnabled: true, autoApproveQuestions: false,
      studentWordLimit: 12, studentQuestionLimit: 30, telestrationSteps: 6, teleDrawSec: 30, teleTextSec: 20,
      liveQuestionCount: 10, liveTimeLimit: 20, liveFormat: 'mc', liveQuizType: 'mixed', liveSource: 'words',
      speedTotalMinutes: 5
    },
    packMeta: { words: { v: 0, parts: 0 }, questions: { v: 0, parts: 0 } },
    gameState: {
      mode: 'idle', phase: '', round: 0, startedAt: null, phaseEndsAt: null,
      gameId: '', seq: 0, driverId: '', payload: null, finalSummary: null
    }
  };
}

/** 방을 만들어요. 같은 코드가 이미 있으면 다른 코드로 다시 시도해요. */
export async function createRoom(roomName, groupCount) {
  for (let i = 0; i < 8; i++) {
    const code = makeRoomCode();
    const ref = roomRef(code);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);   // [읽기]
        if (snap.exists()) throw new Error('ROOM_CODE_EXISTS');
        tx.set(ref, newRoomData(roomName, groupCount));   // [쓰기]
      });
      return code;
    } catch (err) {
      if (err && err.message === 'ROOM_CODE_EXISTS') continue;
      throw err;
    }
  }
  throw new Error('방 코드를 만들지 못했어요. 다시 시도해 주세요.');
}

export async function getRoom(code) {
  return getDoc(roomRef(code));   // [읽기]
}

/** 방 목록(최신순). after에 마지막 문서를 넘기면 그다음 20개를 가져와요. */
export async function fetchRoomList(after) {
  const parts = [collection(db, 'rooms'), orderBy('createdAt', 'desc')];
  if (after) parts.push(startAfter(after));
  parts.push(limit(ROOM_LIST_LIMIT));
  const snap = await getDocs(query(...parts));   // [읽기] 최대 20개
  return { docs: snap.docs, hasMore: snap.docs.length === ROOM_LIST_LIMIT };
}

/** 방과 그 안의 모든 자료(학생, 단어, 문제, 번들, 게임 임시 문서)를 지워요. */
export async function deleteRoomCascade(code, onProgress) {
  const refs = [];
  for (const sub of ['students', 'words', 'questions', 'packs', 'games']) {
    const snap = await getDocs(collection(db, 'rooms', code, sub));   // [읽기]
    snap.forEach((d) => refs.push(d.ref));
  }
  let done = 0;
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));   // [삭제]
    await batch.commit();
    done += Math.min(450, refs.length - i);
    if (onProgress) onProgress(done, refs.length);
  }
  await deleteDoc(roomRef(code));   // [삭제] 방 문서는 맨 마지막에
}

/** 모둠 수를 바꾸고, 모든 학생의 모둠 선택을 비워요(2-4). 학생들은 새 모둠을 다시 골라요. */
export async function changeGroupCount(code, groupCount, studentIds) {
  const queue = [...studentIds];
  let first = true;
  do {
    const batch = writeBatch(db);
    let used = 0;
    if (first) {
      batch.update(roomRef(code), { 'settings.groupCount': groupCount, 'settings.groupEpoch': increment(1) });   // [쓰기]
      used = 1;
      first = false;
    }
    while (queue.length && used < 450) {
      batch.update(studentRef(code, queue.shift()), { groupId: null });   // [쓰기]
      used++;
    }
    await batch.commit();
  } while (queue.length);
}

/* ───────── 6. 학생 ───────── */
export async function getStudent(code, id) {
  return getDoc(studentRef(code, id));   // [읽기]
}

/** 같은 닉네임이 없을 때만 새로 만들어요. { created: true/false } */
export async function createStudentIfAbsent(code, id, nickname, groupId) {
  const ref = studentRef(code, id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (snap.exists()) return { created: false };
    tx.set(ref, {   // [쓰기]
      nickname, groupId, studyScore: 0, wordCount: 0, questionCount: 0,
      joinedAt: serverTimestamp(), lastSeen: serverTimestamp(), pingId: ''
    });
    return { created: true };
  });
}

/** "나 접속 중이에요" 신호 */
export async function touchStudent(code, id) {
  await updateDoc(studentRef(code, id), { lastSeen: serverTimestamp() });   // [쓰기]
}

export async function setStudentGroup(code, id, groupId) {
  await updateDoc(studentRef(code, id), { groupId });   // [쓰기]
}
