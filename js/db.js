// js/db.js — Firebase(데이터베이스)와 이야기하는 모든 일을 이 파일에서 해요.
// 다른 파일들은 Firebase 주소를 직접 쓰지 않고, 여기서 내보내는 함수만 불러다 써요.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  initializeFirestore, doc, collection, getDoc, getDocs, getDocFromServer, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, startAfter, writeBatch, runTransaction,
  serverTimestamp, increment, arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';
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
export const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });

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
export const wordsCol = (code) => collection(db, 'rooms', code, 'words');
export const wordRef = (code, id) => doc(db, 'rooms', code, 'words', id);
export const questionsCol = (code) => collection(db, 'rooms', code, 'questions');
export const questionRef = (code, id) => doc(db, 'rooms', code, 'questions', id);
export const packRef = (code, name) => doc(db, 'rooms', code, 'packs', name);
export const gamesCol = (code) => collection(db, 'rooms', code, 'games');
export const gameDoc = (code, id) => doc(db, 'rooms', code, 'games', id);
export const clockRef = (code) => doc(db, 'rooms', code, 'games', 'clock');
export const teacherRef = (pin) => doc(db, 'teachers', pin);

/** 배열을 n개씩 나눠요(Firestore 일괄 쓰기는 한 번에 500건까지라서 450개씩 끊어 써요) */
export function chunk(list, size = 450) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** 여러 건을 450건씩 끊어서 한꺼번에 써요. fn(batch, item)에서 batch.set/update/delete를 불러요. */
export async function batchEach(items, fn) {
  for (const part of chunk(items)) {
    const batch = writeBatch(db);
    part.forEach((item) => fn(batch, item));
    await batch.commit();   // [쓰기/삭제] 건수만큼
  }
}

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

/* ───────── 5-0. 교사 계정 (PIN이 곧 아이디) ─────────
   teachers/{4자리 PIN} 문서가 있으면 그 PIN으로 로그인할 수 있어요. 비밀번호는 따로 없어요(보안 목적이 아니에요). */
export async function getTeacher(pin) {
  return getDoc(teacherRef(pin));   // [읽기]
}

/** 새 PIN 만들기. 이미 쓰는 사람이 있으면 { created:false } */
export async function createTeacher(pin, name) {
  const ref = teacherRef(pin);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (snap.exists()) return { created: false };
    tx.set(ref, { name: name || '', createdAt: serverTimestamp() });   // [쓰기]
    return { created: true };
  });
}

/** 이 PIN 선생님의 방들(최신순). 색인이 필요 없도록 등호 조건만 쓰고 정렬은 화면에서 해요. */
export async function fetchRoomsByPin(pin) {
  const snap = await getDocs(query(collection(db, 'rooms'), where('teacherPin', '==', pin)));   // [읽기] 방 개수만큼
  const rooms = snap.docs.map((d) => ({ id: d.id, data: d.data({ serverTimestamps: 'estimate' }) }));
  const ms = (r) => (r.data.createdAt && r.data.createdAt.toMillis ? r.data.createdAt.toMillis() : 0);
  rooms.sort((a, b) => ms(b) - ms(a));
  return rooms;
}

/** 새 방 문서의 첫 내용. 설정값도 미리 넣어 둬요. */
function newRoomData(roomName, groupCount, teacherPin) {
  return {
    roomName,
    teacherPin,
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
export async function createRoom(roomName, groupCount, teacherPin) {
  for (let i = 0; i < 8; i++) {
    const code = makeRoomCode();
    const ref = roomRef(code);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);   // [읽기]
        if (snap.exists()) throw new Error('ROOM_CODE_EXISTS');
        tx.set(ref, newRoomData(roomName, groupCount, teacherPin));   // [쓰기]
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

/** 같은 닉네임이 없을 때만 새로 만들어요. { created: true/false }
 *  counts: 이 이름으로 이미 낸 단어·문제 수(내보냈던 학생이 같은 이름으로 다시 들어올 때만 넣어요). 없으면 0개로 시작해요. */
export async function createStudentIfAbsent(code, id, nickname, groupId, counts = null) {
  const ref = studentRef(code, id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (snap.exists()) return { created: false };
    tx.set(ref, {   // [쓰기]
      nickname, groupId, studyScore: 0, wordCount: (counts && counts.wordCount) || 0, questionCount: (counts && counts.questionCount) || 0,
      joinedAt: serverTimestamp(), lastSeen: serverTimestamp(), pingId: ''
    });
    return { created: true };
  });
}

/**
 * 학생을 방에서 내보내요(이름을 잘못 쓴 경우 등).
 * 지우는 것은 "학생 기록 문서 1개"뿐이에요. 그 학생이 낸 단어·문제는 그대로 남아요.
 * 참가자 확인·게임 중에는 거절해요(게임 참가자 목록이 꼬이지 않게). 트랜잭션이라 시작 직전에 게임이 열려도 안전해요.
 * 돌려주는 값: { ok: true, nickname, score } | { ok: true, already: true } | { ok: false, reason: 'busy' | 'noroom' }
 */
export async function kickStudent(code, id) {
  const rref = roomRef(code), sref = studentRef(code, id);
  return runTransaction(db, async (tx) => {
    const room = await tx.get(rref);   // [읽기]
    if (!room.exists()) return { ok: false, reason: 'noroom' };
    const gs = room.data().gameState;
    const mode = gs && gs.mode;
    if (mode !== 'idle' && mode !== 'ranking') return { ok: false, reason: 'busy' };
    const s = await tx.get(sref);   // [읽기]
    if (!s.exists()) return { ok: true, already: true };
    const d = s.data();
    tx.delete(sref);   // [삭제]
    tx.update(rref, { kickedIds: arrayUnion(id) });   // [쓰기] 같은 이름으로 다시 들어오면 낸 단어 수를 다시 세려고 적어 둬요
    return { ok: true, nickname: d.nickname || id, score: d.studyScore || 0 };
  });
}

/** 내보낸 학생에게 배정돼 있던 "아직 비어 있는" 교사 카드를 담당자 없음으로 돌려놔요(다른 학생에게 다시 나눠 줄 수 있게). 내용이 있는 카드는 그대로 둬요. */
export async function releaseAssignedCards(code, id) {
  const snap = await getDocs(query(wordsCol(code), where('assignedTo', '==', id)));   // [읽기] 그 학생 카드 수만큼
  const empties = snap.docs.filter((d) => { const x = d.data(); return x.origin === 'teacher' && x.status === 'assigned'; });
  if (!empties.length) return 0;
  await batchEach(empties, (b, d) => b.update(d.ref, { assignedTo: null, updatedAt: serverTimestamp() }));   // [쓰기]
  return empties.length;
}

/** "나 접속 중이에요" 신호 */
export async function touchStudent(code, id) {
  await updateDoc(studentRef(code, id), { lastSeen: serverTimestamp() });   // [쓰기]
}

export async function setStudentGroup(code, id, groupId) {
  await updateDoc(studentRef(code, id), { groupId });   // [쓰기]
}
