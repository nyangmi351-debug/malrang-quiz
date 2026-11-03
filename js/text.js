// js/text.js — 글자 다루는 순수 함수 모음 (Firebase를 쓰지 않아요)
// 정답 판정(isCorrect), 한글 자모 비교, 빈칸 만들기, 섞기(시드), 단어 일괄 등록 해석

import { normalizeKey } from './core.js';

/* ───────── 1. 단어 유형 ───────── */
export const WORD_TYPES = ['단어', '관용표현', '속담'];
export const TYPE_LABEL = { '단어': '단어', '관용표현': '관용 표현', '속담': '속담' };

/** 단어 유형 → 정답 판정 방식. 단어는 완전 일치, 관용 표현·속담은 비슷하면 정답(3-2) */
export function judgeModeOf(type) { return type === '단어' ? 'exact' : 'fuzzy'; }

/* ───────── 2. 한글 자모 분해와 유사도 ───────── */
const CHO = [...'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'];
const JUNG = [...'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'];
const JONG = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

/** '가나' → ['ㄱ','ㅏ','ㄴ','ㅏ'] (완성형 글자는 초성·중성·종성으로 쪼개요) */
export function toJamo(text) {
  const out = [];
  for (const ch of String(text).normalize('NFC')) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const n = code - 0xac00;
      out.push(CHO[Math.floor(n / 588)], JUNG[Math.floor((n % 588) / 28)]);
      const jong = JONG[n % 28];
      if (jong) out.push(jong);
    } else out.push(ch);
  }
  return out;
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 0~1 사이 비슷한 정도 (자모 단위: 1 − 편집거리 / 긴 쪽 길이) */
export function similarity(a, b) {
  const ja = toJamo(a), jb = toJamo(b);
  const longest = Math.max(ja.length, jb.length);
  if (!longest) return 1;
  return 1 - levenshtein(ja, jb) / longest;
}

/**
 * 정답 판정 (3-2). mode: 'exact' 완전 일치 / 'fuzzy' 비슷하면 정답. 입력과 정답은 normalizeKey로 먼저 다듬어요.
 * type에 '단어' | '관용표현' | '속담'을 넣어도 돼요.
 */
export function isCorrect(input, answer, mode = 'exact', threshold = 0.85) {
  const m = WORD_TYPES.includes(mode) ? judgeModeOf(mode) : mode;
  const a = normalizeKey(input), b = normalizeKey(answer);
  if (!a || !b) return false;
  if (a === b) return true;
  return m === 'fuzzy' && similarity(a, b) >= threshold;
}

/** 허용 정답이 여러 개일 때: 하나라도 맞으면 정답 (학생이 낸 단답형 문제용) */
export function isCorrectAny(input, answers, mode = 'exact', threshold = 0.85) {
  return (answers || []).some((ans) => isCorrect(input, ans, mode, threshold));
}

/* ───────── 3. 예문 빈칸 ───────── */
/** 예문 속 표제어가 글자 그대로 들어 있는지 (공백 포함 연속 일치) */
export function exampleHasWord(example, word) {
  const ex = String(example || '').normalize('NFC'), w = String(word || '').normalize('NFC').trim();
  return !!w && ex.includes(w);
}

/** 표제어가 연속으로 일치하는 모든 곳을 '***'로 바꿔요(조사는 그대로 남아요). 없으면 null */
export function blankExample(example, word) {
  if (!exampleHasWord(example, word)) return null;
  return String(example).normalize('NFC').split(String(word).normalize('NFC').trim()).join('***');
}

/* ───────── 4. 섞기 (시드 기반: 같은 시드면 어느 기기에서나 같은 순서) ───────── */
export function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 새 배열을 돌려줘요. seed가 없으면 무작위로 섞어요. */
export function shuffle(arr, seed) {
  const rnd = seed === undefined ? Math.random : mulberry32(hashStr(seed));
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ───────── 5. 단어 일괄 등록 해석 (6-1) ───────── */
/** 줄 하나 → { word, type }. 마지막 쉼표 오른쪽이 단어/관용 표현/속담일 때만 유형으로 읽어요. */
export function parseBulkLine(line) {
  const raw = String(line).normalize('NFC').trim();
  if (!raw) return null;
  const idx = raw.lastIndexOf(',');
  if (idx >= 0) {
    const right = raw.slice(idx + 1).replace(/\s+/g, '');
    if (WORD_TYPES.includes(right)) return { word: raw.slice(0, idx).trim(), type: right };
  }
  return { word: raw, type: '단어' };
}

/**
 * 붙여넣은 글 전체를 분류해요.
 * existingKeys: 이미 방에 있는 단어 키 모음(Set). wordMax: 글자 수 한도.
 */
export function classifyBulk(text, existingKeys, wordMax = 30) {
  const result = { fresh: [], dupExisting: [], dupInList: [], tooLong: [], invalid: [] };
  const seen = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    const entry = parseBulkLine(line);
    if (!entry) continue;
    const key = normalizeKey(entry.word);
    if (!key) { result.invalid.push(entry); continue; }
    if ([...entry.word].length > wordMax) { result.tooLong.push(entry); continue; }
    if (existingKeys.has(key)) { result.dupExisting.push(entry); continue; }
    if (seen.has(key)) { result.dupInList.push(entry); continue; }
    seen.add(key);
    result.fresh.push({ ...entry, key });
  }
  return result;
}

/* ───────── 6. 크기·시간 ───────── */
export function utf8Bytes(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return new TextEncoder().encode(s).length;
}

export function formatSec(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function toMs(ts) { return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : (typeof ts === 'number' ? ts : 0); }
