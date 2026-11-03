// js/quizgen.js — 문제 만들기와 채점 (공부하기, 라이브 퀴즈가 함께 써요). Firebase를 쓰지 않아요.
//
// 문제 한 개의 모양(모두 JSON으로 저장할 수 있게 단순한 값만 써요):
//   { id, src:'word'|'student', fmt:'mc'|'short', qtype:'meaning'|'image'|'example'|'student',
//     prompt, imageUrl, choices[], answerIdx, answers[], judge:'exact'|'fuzzy', label, wordType }

import { normalizeKey } from './core.js';
import { blankExample, exampleHasWord, shuffle, judgeModeOf, isCorrectAny } from './text.js';
import { checkImage } from './forms.js';

export const QTYPE_LABEL = { meaning: '뜻 → 단어', image: '그림 → 단어', example: '예문 빈칸 → 단어', student: '친구가 낸 문제' };

/* ───────── 1. 후보 조건 ───────── */
/** 이 단어로 만들 수 있는 문제 유형들 (그림은 나중에 불러 보아 확인해요) */
export function eligibleQtypes(w) {
  const list = [];
  if (w.meaning) list.push('meaning');
  if (w.imageUrl) list.push('image');
  if (exampleHasWord(w.example, w.word)) list.push('example');
  return list;
}

/** 같은 유형(단어끼리, 속담끼리) 승인 항목 수 */
export function typeCounts(words) {
  const c = {};
  words.forEach((w) => { c[w.type] = (c[w.type] || 0) + 1; });
  return c;
}

/* ───────── 2. 문제 만들기 ───────── */
/** 단어 하나로 문제를 만들어요. fmt는 'mc' 또는 'short'. 만들 수 없으면 null */
export function makeWordQuestion(w, words, qtype, fmt) {
  let prompt = '';
  if (qtype === 'meaning') prompt = w.meaning;
  else if (qtype === 'example') { prompt = blankExample(w.example, w.word); if (!prompt) return null; }
  else if (qtype === 'image') { if (!w.imageUrl) return null; prompt = '이 그림이 나타내는 말은?'; }
  const base = {
    id: w.id, src: 'word', fmt, qtype, prompt, imageUrl: qtype === 'image' ? w.imageUrl : '',
    answers: [w.word], judge: judgeModeOf(w.type), label: w.word, wordType: w.type, choices: [], answerIdx: -1
  };
  if (fmt === 'short') return base;
  const myKey = normalizeKey(w.word);
  const seen = new Set([myKey]);
  const pool = shuffle(words.filter((x) => x.type === w.type)).filter((x) => { const k = normalizeKey(x.word); if (seen.has(k)) return false; seen.add(k); return true; });
  if (pool.length < 3) return null;
  const choices = shuffle([w.word, ...pool.slice(0, 3).map((x) => x.word)]);
  return { ...base, choices, answerIdx: choices.indexOf(w.word) };
}

/** 학생이 낸 문제를 공통 모양으로 바꿔요. 4지선다 보기는 섞어요. */
export function fromStudentQuestion(q) {
  const base = { id: q.id, src: 'student', qtype: 'student', prompt: q.question, imageUrl: q.imageUrl || '', wordType: '', createdBy: q.createdBy || '' };
  if (q.qType === 'mc') {
    const choices = shuffle([q.answer, ...q.wrongs]);
    return { ...base, fmt: 'mc', choices, answerIdx: choices.indexOf(q.answer), answers: [q.answer], judge: 'exact', label: q.answer };
  }
  return { ...base, fmt: 'short', choices: [], answerIdx: -1, answers: q.answers, judge: q.judgeMode || 'exact', label: q.answers[0] };
}

/** 문제 하나를 만들되, 그림 문제는 실제로 불러와지는지 확인하고 안 되면 다른 유형을 써요 */
async function buildChecked(w, words, qtypes, fmt, okImages) {
  for (const qt of shuffle(qtypes)) {
    if (qt === 'image') {
      if (!okImages.has(w.id)) { if (!(await checkImage(w.imageUrl))) continue; okImages.add(w.id); }
    }
    const q = makeWordQuestion(w, words, qt, fmt);
    if (q) return q;
  }
  return null;
}

/* ───────── 3. 채점 ───────── */
/** response: 4지선다는 고른 번호, 단답형은 쓴 글. 정답이면 true */
export function gradeAnswer(q, response, threshold = 0.85) {
  if (q.fmt === 'mc') return Number(response) === q.answerIdx;
  return isCorrectAny(String(response ?? ''), q.answers, q.judge, threshold);
}

/* ───────── 4. 공부하기 문제 묶음 ─────────
   한 바퀴를 돌 때까지 같은 문제가 반복되지 않고, 바로 앞 문제는 다시 나오지 않아요. 한 바퀴가 끝나면 다시 섞어요. */
export function createDeck(words, questions) {
  let bag = [];
  let lastId = null;
  const items = () => [
    ...words.map((w) => ({ src: 'word', ref: w, id: `w:${w.id}` })),
    ...questions.map((q) => ({ src: 'student', ref: q, id: `q:${q.id}` }))
  ];
  async function next() {
    const okImages = next.okImages || (next.okImages = new Set());
    for (let tries = 0; tries < 40; tries++) {
      if (!bag.length) {
        bag = shuffle(items());
        if (bag.length > 1 && bag[0].id === lastId) { const t = bag.shift(); bag.push(t); }
      }
      const it = bag.shift();
      lastId = it.id;
      if (it.src === 'student') return fromStudentQuestion(it.ref);
      const w = it.ref;
      const qtypes = eligibleQtypes(w);
      const fmts = shuffle(['mc', 'short']);
      for (const fmt of fmts) {
        const q = await buildChecked(w, words, qtypes, fmt, okImages);
        if (q) return q;
      }
    }
    return null;
  }
  return { next, size: items().length };
}

/* ───────── 5. 라이브 퀴즈 문제 묶음 (교사 화면에서 한 번에 만들어요) ─────────
   settings: { fmt:'mc'|'short', qtype:'meaning'|'image'|'example'|'mixed', source:'words'|'questions'|'mixed', count }
   돌려주는 값: { questions[], notes[] }  (notes는 교사에게 알릴 말) */
export async function generateLiveQuiz(words, studentQs, settings) {
  const { fmt, qtype, source, count } = settings;
  const notes = [];
  const counts = typeCounts(words);
  const okImages = new Set();

  // 단어 후보: 4지선다인데 같은 유형 항목이 4개 미만이면 그 유형은 뺍니다
  let wordPool = [];
  if (source !== 'questions') {
    const tooFew = fmt === 'mc' ? Object.keys(counts).filter((t) => counts[t] < 4) : [];
    tooFew.forEach((t) => notes.push(`‘${t}’ 유형은 승인된 항목이 4개 미만이라 4지선다에서 뺐어요.`));
    wordPool = words.filter((w) => !tooFew.includes(w.type)).filter((w) => {
      const el = eligibleQtypes(w);
      return qtype === 'mixed' ? el.length > 0 : el.includes(qtype);
    });
  }
  const qPool = source !== 'words' ? studentQs.filter((q) => q.qType === fmt) : [];
  if (source !== 'words' && !qPool.length) notes.push(`승인된 학생 문제 중 ${fmt === 'mc' ? '4지선다' : '단답형'} 문제가 없어요.`);

  const wq = shuffle(wordPool), sq = shuffle(qPool);
  const order = [];
  if (source === 'words') wq.forEach((x) => order.push({ k: 'w', x }));
  else if (source === 'questions') sq.forEach((x) => order.push({ k: 's', x }));
  else { for (let i = 0; i < Math.max(wq.length, sq.length); i++) { if (wq[i]) order.push({ k: 'w', x: wq[i] }); if (sq[i]) order.push({ k: 's', x: sq[i] }); } }

  const out = [];
  let skippedImages = 0;
  for (const it of order) {
    if (out.length >= count) break;
    if (it.k === 's') { out.push(fromStudentQuestion(it.x)); continue; }
    const el = qtype === 'mixed' ? eligibleQtypes(it.x) : [qtype];
    const q = await buildChecked(it.x, words, el, fmt, okImages);   // 그림이 안 불러와지면 다른 유형으로 대신해요
    if (q) out.push(q); else skippedImages++;
  }
  if (skippedImages) notes.push(`그림이 불러와지지 않아 ${skippedImages}개 후보를 건너뛰었어요.`);
  if (out.length < count) notes.push(`후보가 부족해서 문제 수를 ${count}개에서 ${out.length}개로 줄였어요.`);
  return { questions: out, notes };
}
