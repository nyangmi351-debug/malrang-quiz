// js/words.js — 단어·문제를 저장하고 고치고 지우는 일 (학생용 + 교사용 Firestore 작업 모음)
// 규칙(중복, 개수 한도, 수정 권한)은 모두 "트랜잭션"으로 확인해요. 트랜잭션은 "읽고 → 확인하고 → 쓰는" 일을
// 다른 사람이 끼어들지 못하게 한 덩어리로 처리하는 방법이에요.

import { normalizeKey } from './core.js';
import { shuffle } from './text.js';
import * as D from './db.js';

/** 규칙 위반(중복, 한도 초과 등)을 알리는 오류. rule에 종류가 들어 있어요. */
export class RuleError extends Error {
  constructor(rule, message) { super(message); this.rule = rule; }
}

const stamp = () => D.serverTimestamp();

/* ═════════ 1. 학생: 단어 ═════════ */

/** 학생이 직접 단어를 내요. 중복·개수 한도를 한 트랜잭션 안에서 확인해요. */
export async function saveStudentWord(code, sid, nickname, f, limit) {
  const key = normalizeKey(f.word);
  if (!key) throw new RuleError('EMPTY', '단어를 입력해 주세요.');
  const wref = D.wordRef(code, key), sref = D.studentRef(code, sid);
  await D.runTransaction(D.db, async (tx) => {
    const w = await tx.get(wref);   // [읽기]
    const s = await tx.get(sref);   // [읽기]
    if (w.exists()) throw new RuleError('DUP', '중복된 단어입니다');
    const cnt = (s.exists() && s.data().wordCount) || 0;
    if (limit > 0 && cnt >= limit) throw new RuleError('LIMIT', `단어는 최대 ${limit}개까지 낼 수 있어요`);
    tx.set(wref, {   // [쓰기]
      word: f.word, type: f.type, meaning: f.meaning, example: f.example || '', imageUrl: f.imageUrl || '',
      origin: 'student', createdBy: nickname, assignedTo: sid, status: 'pending', updatedAt: stamp()
    });
    tx.update(sref, { wordCount: cnt + 1 });   // [쓰기]
  });
  return key;
}

/** 내가 낸 단어를 고쳐요. 표제어(단어)를 바꾸면 옛 문서를 지우고 새 문서를 만들어요. */
export async function updateStudentWord(code, sid, oldKey, f) {
  const newKey = normalizeKey(f.word);
  if (!newKey) throw new RuleError('EMPTY', '단어를 입력해 주세요.');
  const oref = D.wordRef(code, oldKey), nref = D.wordRef(code, newKey);
  await D.runTransaction(D.db, async (tx) => {
    const old = await tx.get(oref);   // [읽기]
    if (!old.exists()) throw new RuleError('NOT_FOUND', '단어를 찾을 수 없어요. 새로고침해 주세요.');
    const od = old.data();
    if (od.assignedTo !== sid || od.status === 'approved' || od.origin !== 'student') throw new RuleError('LOCKED', '이미 승인된 단어는 고칠 수 없어요.');
    const fields = { word: f.word, type: f.type, meaning: f.meaning, example: f.example || '', imageUrl: f.imageUrl || '', updatedAt: stamp() };
    if (newKey === oldKey) { tx.update(oref, fields); return; }   // [쓰기]
    const dup = await tx.get(nref);   // [읽기]
    if (dup.exists()) throw new RuleError('DUP', '중복된 단어입니다');
    tx.delete(oref);   // [삭제]
    tx.set(nref, { ...od, ...fields });   // [쓰기]
  });
  return newKey;
}

/** 교사가 나눠 준 카드를 채워서 제출해요(뜻 필수). 이미 낸 카드를 다시 고칠 때도 같아요. */
export async function submitAssignedCard(code, sid, key, f) {
  if (!String(f.meaning || '').trim()) throw new RuleError('NO_MEANING', '뜻을 입력해 주세요.');
  const ref = D.wordRef(code, key);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (!snap.exists()) throw new RuleError('NOT_FOUND', '카드를 찾을 수 없어요. 새로고침해 주세요.');
    const d = snap.data();
    if (d.assignedTo !== sid || d.status === 'approved') throw new RuleError('LOCKED', '이 카드는 더 고칠 수 없어요.');
    tx.update(ref, { meaning: f.meaning, example: f.example || '', imageUrl: f.imageUrl || '', status: 'pending', updatedAt: stamp() });   // [쓰기]
  });
}

/** 내가 낸 단어를 지워요(승인 전까지만). 지우면 개수 한도가 다시 열려요. 배정 카드는 지울 수 없어요. */
export async function deleteStudentWord(code, sid, key) {
  const ref = D.wordRef(code, key), sref = D.studentRef(code, sid);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const s = await tx.get(sref);     // [읽기]
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.assignedTo !== sid || d.status === 'approved' || d.origin !== 'student') throw new RuleError('LOCKED', '이 단어는 지울 수 없어요.');
    tx.delete(ref);   // [삭제]
    tx.update(sref, { wordCount: Math.max(0, ((s.exists() && s.data().wordCount) || 0) - 1) });   // [쓰기]
  });
}

/** 이 이름(sid)으로 이미 낸 단어·문제 수를 세어요. 내보냈던 학생이 같은 이름으로 다시 들어올 때, 개수 한도를 이어서 계산하려고 써요. */
export async function countOwned(code, sid) {
  const [w, q] = await Promise.all([
    D.getDocs(D.query(D.wordsCol(code), D.where('assignedTo', '==', sid))),   // [읽기]
    D.getDocs(D.query(D.questionsCol(code), D.where('createdById', '==', sid)))   // [읽기]
  ]);
  return { wordCount: w.docs.filter((d) => d.data().origin === 'student').length, questionCount: q.size };
}

export async function fetchMyWords(code, sid) {
  const snap = await D.getDocs(D.query(D.wordsCol(code), D.where('assignedTo', '==', sid)));   // [읽기] 내 카드 수만큼
  return snap.docs.map((d) => ({ key: d.id, ...d.data() }));
}

/* ═════════ 2. 학생: 문제 ═════════ */

function questionFields(q) {
  const base = { qType: q.qType, question: q.question, imageUrl: q.imageUrl || '' };
  return q.qType === 'mc'
    ? { ...base, answer: q.answer, wrongs: q.wrongs, answers: [], judgeMode: '' }
    : { ...base, answers: q.answers, judgeMode: q.judgeMode || 'exact', answer: '', wrongs: [] };
}

export async function saveQuestion(code, sid, nickname, q, { limit, autoApprove }) {
  const sref = D.studentRef(code, sid);
  const qref = D.doc(D.questionsCol(code));   // 새 문서 번호는 자동으로 만들어져요
  await D.runTransaction(D.db, async (tx) => {
    const s = await tx.get(sref);   // [읽기]
    const cnt = (s.exists() && s.data().questionCount) || 0;
    if (limit > 0 && cnt >= limit) throw new RuleError('LIMIT', `문제는 최대 ${limit}개까지 낼 수 있어요`);
    tx.set(qref, {   // [쓰기]
      ...questionFields(q), createdBy: nickname, createdById: sid,
      status: autoApprove ? 'approved' : 'pending', edited: false, updatedAt: stamp()
    });
    tx.update(sref, { questionCount: cnt + 1 });   // [쓰기]
  });
  return qref.id;
}

/** 내 문제를 고쳐요. 자동 승인이 꺼져 있을 때 이미 승인된 문제를 고치면 '대기'로 돌아가요(Q1). */
export async function updateQuestion(code, sid, qid, q, { autoApprove }) {
  const ref = D.questionRef(code, qid);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (!snap.exists()) throw new RuleError('NOT_FOUND', '문제를 찾을 수 없어요. 새로고침해 주세요.');
    const d = snap.data();
    if (d.createdById !== sid) throw new RuleError('LOCKED', '내가 낸 문제만 고칠 수 있어요.');
    let status = d.status, edited = !!d.edited;
    if (autoApprove) { status = 'approved'; edited = false; }
    else if (d.status === 'approved') { status = 'pending'; edited = true; }
    tx.update(ref, { ...questionFields(q), status, edited, updatedAt: stamp() });   // [쓰기]
  });
}

export async function deleteQuestion(code, sid, qid) {
  const ref = D.questionRef(code, qid), sref = D.studentRef(code, sid);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    const s = await tx.get(sref);     // [읽기]
    if (!snap.exists()) return;
    const d = snap.data();
    if (d.createdById !== sid || d.status === 'approved') throw new RuleError('LOCKED', '승인된 문제는 선생님만 지울 수 있어요.');
    tx.delete(ref);   // [삭제]
    tx.update(sref, { questionCount: Math.max(0, ((s.exists() && s.data().questionCount) || 0) - 1) });   // [쓰기]
  });
}

export async function fetchMyQuestions(code, sid) {
  const snap = await D.getDocs(D.query(D.questionsCol(code), D.where('createdById', '==', sid)));   // [읽기]
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* ═════════ 3. 교사: 단어 ═════════ */

export async function fetchAllWords(code) {
  const snap = await D.getDocs(D.wordsCol(code));   // [읽기] 단어 수만큼
  return snap.docs.map((d) => ({ key: d.id, ...d.data() }));
}
export async function fetchAllQuestions(code) {
  const snap = await D.getDocs(D.questionsCol(code));   // [읽기]
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 교사가 단어를 고쳐요. 표제어가 바뀌면 문서 번호가 달라지므로 옛 문서를 지우고 새로 만들어요. */
export async function teacherSaveWord(code, oldKey, f) {
  const newKey = normalizeKey(f.word);
  if (!newKey) throw new RuleError('EMPTY', '단어를 입력해 주세요.');
  const oref = D.wordRef(code, oldKey), nref = D.wordRef(code, newKey);
  await D.runTransaction(D.db, async (tx) => {
    const old = await tx.get(oref);   // [읽기]
    if (!old.exists()) throw new RuleError('NOT_FOUND', '단어를 찾을 수 없어요.');
    const fields = { word: f.word, type: f.type, meaning: f.meaning, example: f.example || '', imageUrl: f.imageUrl || '', updatedAt: stamp() };
    if (newKey === oldKey) { tx.update(oref, fields); return; }   // [쓰기]
    const dup = await tx.get(nref);   // [읽기]
    if (dup.exists()) throw new RuleError('DUP', '이미 있는 단어예요.');
    tx.delete(oref);   // [삭제]
    tx.set(nref, { ...old.data(), ...fields });   // [쓰기]
  });
  return newKey;
}

export async function setWordStatus(code, key, status) {
  await D.updateDoc(D.wordRef(code, key), { status, updatedAt: stamp() });   // [쓰기]
}
export async function approveWords(code, keys) {
  await D.batchEach(keys, (b, key) => b.update(D.wordRef(code, key), { status: 'approved', updatedAt: stamp() }));   // [쓰기]
}

export async function teacherDeleteWord(code, key) {
  const ref = D.wordRef(code, key);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (!snap.exists()) return;
    const d = snap.data();
    let sref = null, sdata = null;
    if (d.origin === 'student' && d.assignedTo) {
      sref = D.studentRef(code, d.assignedTo);
      const s = await tx.get(sref);   // [읽기]
      sdata = s.exists() ? s.data() : null;
    }
    tx.delete(ref);   // [삭제]
    if (sdata) tx.update(sref, { wordCount: Math.max(0, (sdata.wordCount || 0) - 1) });   // [쓰기]
  });
}

/** 교사가 단어를 한꺼번에 등록해요. 학생에게 나눠 줄 "배정 대기" 카드가 만들어져요. */
export async function bulkRegister(code, fresh) {
  await D.batchEach(fresh, (b, e) => b.set(D.wordRef(code, e.key), {   // [쓰기]
    word: e.word, type: e.type, meaning: '', example: '', imageUrl: '', origin: 'teacher', createdBy: '교사',
    assignedTo: null, status: 'assigned', updatedAt: stamp()
  }));
}

/** 카드 한 장의 담당자를 바꾸거나(sid) 회수해요(null) */
export async function assignWord(code, key, sid) {
  const patch = { assignedTo: sid || null, updatedAt: stamp() };
  if (!sid) patch.status = 'assigned';
  await D.updateDoc(D.wordRef(code, key), patch);   // [쓰기]
}

/**
 * 랜덤 배정 계획 (6-1): 담당자 없는 교사 카드를 접속 중인 학생에게 나눠 줘요.
 * 매번 "교사가 배정한 카드 수가 가장 적은 학생"에게 주고, 동점이면 무작위예요.
 * @returns [{ key, sid }]
 */
export function planAssignment(allWords, onlineStudentIds) {
  const cards = allWords.filter((w) => w.origin === 'teacher' && !w.assignedTo && w.status === 'assigned');
  if (!cards.length || !onlineStudentIds.length) return [];
  const counts = new Map(onlineStudentIds.map((id) => [id, 0]));
  for (const w of allWords) if (w.origin === 'teacher' && w.assignedTo && counts.has(w.assignedTo)) counts.set(w.assignedTo, counts.get(w.assignedTo) + 1);
  const plan = [];
  for (const card of shuffle(cards)) {
    const min = Math.min(...counts.values());
    const pool = [...counts].filter(([, c]) => c === min).map(([id]) => id);
    const sid = pool[Math.floor(Math.random() * pool.length)];
    counts.set(sid, counts.get(sid) + 1);
    plan.push({ key: card.key, sid });
  }
  return plan;
}
export async function applyAssignment(code, plan) {
  await D.batchEach(plan, (b, p) => b.update(D.wordRef(code, p.key), { assignedTo: p.sid, updatedAt: stamp() }));   // [쓰기]
}

/* ═════════ 4. 교사: 문제 ═════════ */

export async function setQuestionApproved(code, qid, approved) {
  await D.updateDoc(D.questionRef(code, qid), approved ? { status: 'approved', edited: false, updatedAt: stamp() } : { status: 'pending', updatedAt: stamp() });   // [쓰기]
}
export async function approveQuestions(code, ids) {
  await D.batchEach(ids, (b, id) => b.update(D.questionRef(code, id), { status: 'approved', edited: false, updatedAt: stamp() }));   // [쓰기]
}
export async function teacherSaveQuestion(code, qid, q) {
  await D.updateDoc(D.questionRef(code, qid), { ...questionFields(q), updatedAt: stamp() });   // [쓰기]
}
export async function teacherDeleteQuestion(code, qid) {
  const ref = D.questionRef(code, qid);
  await D.runTransaction(D.db, async (tx) => {
    const snap = await tx.get(ref);   // [읽기]
    if (!snap.exists()) return;
    const sid = snap.data().createdById;
    const sref = sid ? D.studentRef(code, sid) : null;
    const s = sref ? await tx.get(sref) : null;   // [읽기]
    tx.delete(ref);   // [삭제]
    if (s && s.exists()) tx.update(sref, { questionCount: Math.max(0, (s.data().questionCount || 0) - 1) });   // [쓰기]
  });
}

/* ═════════ 5. 점수 ═════════ */
export async function addStudyScore(code, sid, n) {
  if (n > 0) await D.updateDoc(D.studentRef(code, sid), { studyScore: D.increment(n) });   // [쓰기]
}
export async function resetStudyScores(code, studentIds) {
  await D.batchEach(studentIds, (b, id) => b.update(D.studentRef(code, id), { studyScore: 0 }));   // [쓰기]
}
