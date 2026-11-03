// js/forms.js — 입력 양식 부품: 이미지 링크, 단어 양식, 문제 양식 (학생 화면과 교사 화면이 함께 써요)

import { h, clear, normalizeKey } from './core.js';
import { LIMITS, IMAGE_PRELOAD_TIMEOUT_MS } from './config.js';
import { WORD_TYPES, TYPE_LABEL, exampleHasWord } from './text.js';
import { safeImg } from './ui.js';

const len = (s) => [...String(s || '')].length;

/* ═════════ 1. 이미지 링크 ═════════ */

/** 그림이 정말 불러와지는지 확인해요(5초 안에 성공해야 해요). */
export function checkImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    const timer = setTimeout(() => { img.src = ''; resolve(false); }, IMAGE_PRELOAD_TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve(true); };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });
}

/** 이미지 링크 입력칸 + 미리보기 + 도움말. validate()가 빈 문자열을 돌려주면 저장해도 돼요. */
export function imageField(initial = '', onInput) {
  const input = h('input', {
    class: 'input', type: 'url', maxlength: String(LIMITS.imageUrl), placeholder: 'https://… (없어도 돼요)', value: initial, 'aria-label': '이미지 링크',
    autocomplete: 'off'
  });
  const preview = h('div', { class: 'img-preview' });
  let timer = null;
  function refresh() {
    clear(preview);
    const v = input.value.trim();
    if (!v) return;
    if (!/^https:\/\//i.test(v)) { preview.append(h('p', { class: 'msg warn' }, '주소는 https:// 로 시작해야 해요.')); return; }
    preview.append(safeImg(v, '미리보기'));
  }
  input.addEventListener('input', () => { if (onInput) onInput(); clearTimeout(timer); timer = setTimeout(refresh, 500); });
  refresh();
  return {
    el: h('div', { class: 'form-col' },
      h('label', null, '이미지 링크 (선택)'), input, preview,
      h('p', { class: 'muted' }, '그림을 길게 눌러 ‘이미지 주소 복사’를 선택해요. 검색 결과 썸네일 주소는 얼마 뒤 사라질 수 있어요. .jpg .png .webp .gif 처럼 그림 파일 주소여야 잘 보여요.')),
    input,
    getValue: () => input.value.trim(),
    setValue: (v) => { input.value = v; refresh(); },
    async validate() {
      const v = input.value.trim();
      if (!v) return '';
      if (!/^https:\/\//i.test(v)) return '이미지 주소는 https:// 로 시작해야 해요.';
      if (len(v) > LIMITS.imageUrl) return `이미지 주소는 ${LIMITS.imageUrl}글자까지예요.`;
      if (!(await checkImage(v))) return '그림을 불러올 수 없어요. 주소를 다시 확인하거나 이미지 링크를 비워 주세요.';
      return '';
    }
  };
}

/* ═════════ 2. 단어 양식 ═════════ */

/**
 * opts.initial      : { type, word, meaning, example, imageUrl }
 * opts.lockHeading  : true면 단어(표제어)와 유형을 못 바꿔요(교사가 나눠 준 카드)
 * opts.submitText   : 저장 버튼 글자
 * opts.onSubmit     : async (값) => void  (오류가 나면 던져요)
 * opts.draft        : { store, key } 게임 때문에 화면이 바뀌어도 입력하던 글을 되살리려고 메모리에 보관해요
 */
export function wordForm(opts) {
  const draft = opts.draft && opts.draft.store[opts.draft.key];
  const init = { type: '단어', word: '', meaning: '', example: '', imageUrl: '', ...(draft || opts.initial || {}) };
  const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' });
  const typeSel = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '유형' });
  let type = WORD_TYPES.includes(init.type) ? init.type : '단어';
  const typeBtns = WORD_TYPES.map((t) => h('button', {
    class: `seg-btn ${t === type ? 'on' : ''}`, type: 'button', disabled: !!opts.lockHeading, role: 'radio',
    onclick: () => { type = t; typeBtns.forEach((b, i) => b.classList.toggle('on', WORD_TYPES[i] === t)); save(); }
  }, TYPE_LABEL[t]));
  typeBtns.forEach((b) => typeSel.append(b));

  const word = h('input', { class: 'input', type: 'text', maxlength: String(LIMITS.word * 2), value: init.word, disabled: !!opts.lockHeading, 'aria-label': '단어', autocomplete: 'off', placeholder: `${LIMITS.word}글자까지` });
  const meaning = h('textarea', { class: 'input', rows: '2', maxlength: String(LIMITS.meaning * 2), 'aria-label': '뜻', placeholder: `뜻을 써 주세요 (${LIMITS.meaning}글자까지)` }, init.meaning);
  meaning.value = init.meaning;
  const example = h('textarea', { class: 'input', rows: '2', maxlength: String(LIMITS.example * 2), 'aria-label': '예문', placeholder: `예문 (${LIMITS.example}글자까지)` });
  example.value = init.example;
  const exHint = h('p', { class: 'muted' });
  const img = imageField(init.imageUrl, () => save());
  const submitBtn = h('button', { class: 'btn primary big', type: 'button', onclick: submit }, opts.submitText || '저장');

  function updateHint() {
    const w = word.value.trim(), e = example.value.trim();
    exHint.textContent = e && w && !exampleHasWord(e, w) ? '예문에 단어를 그대로 넣으면 빈칸 문제로 쓰여요. (지금 예문에는 단어가 그대로 들어 있지 않아요. 저장은 돼요.)' : '예문에 단어를 그대로 넣으면 빈칸 문제로 쓰여요.';
  }
  function values() { return { type, word: word.value.trim(), meaning: meaning.value.trim(), example: example.value.trim(), imageUrl: img.getValue() }; }
  function save() { if (opts.draft) opts.draft.store[opts.draft.key] = values(); }
  [word, meaning, example].forEach((el) => el.addEventListener('input', () => { msg.textContent = ''; updateHint(); save(); }));
  updateHint();

  async function submit() {
    const v = values();
    msg.textContent = '';
    if (!v.word) { msg.textContent = '단어를 입력해 주세요.'; return; }
    if (!normalizeKey(v.word)) { msg.textContent = '글자가 들어 있는 단어를 입력해 주세요.'; return; }
    if (len(v.word) > LIMITS.word) { msg.textContent = `단어는 ${LIMITS.word}글자까지예요.`; return; }
    if (!v.meaning) { msg.textContent = '뜻을 입력해 주세요.'; return; }
    if (len(v.meaning) > LIMITS.meaning) { msg.textContent = `뜻은 ${LIMITS.meaning}글자까지예요.`; return; }
    if (len(v.example) > LIMITS.example) { msg.textContent = `예문은 ${LIMITS.example}글자까지예요.`; return; }
    submitBtn.disabled = true;
    try {
      const imgErr = await img.validate();   // 그림이 5초 안에 불러와져야 저장할 수 있어요
      if (imgErr) { msg.textContent = imgErr; return; }
      await opts.onSubmit(v);
    } catch (e) {
      if (opts.onError) opts.onError(e, msg); else throw e;
    } finally { submitBtn.disabled = false; }
  }
  word.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); meaning.focus(); } });

  const el = h('div', { class: 'form-card' },
    opts.lockHeading ? null : h('div', { class: 'form-col' }, h('label', null, '유형'), typeSel),
    h('div', { class: 'form-col' }, h('label', null, opts.lockHeading ? `단어: ${init.word}` : '단어'), opts.lockHeading ? null : word),
    h('div', { class: 'form-col' }, h('label', null, '뜻'), meaning),
    h('div', { class: 'form-col' }, h('label', null, '예문'), example, exHint),
    img.el, msg,
    h('div', { class: 'dialog-actions' }, opts.onCancel ? h('button', { class: 'btn ghost', type: 'button', onclick: opts.onCancel }, '취소') : null, submitBtn));
  return { el, values, reset() { word.value = ''; meaning.value = ''; example.value = ''; img.setValue(''); updateHint(); if (opts.draft) delete opts.draft.store[opts.draft.key]; }, focus: () => (opts.lockHeading ? meaning : word).focus(), setMessage: (t) => { msg.textContent = t; } };
}

/* ═════════ 3. 문제 양식 ═════════ */

/** 문제 값 검사. 문제가 있으면 안내 글을, 없으면 ''를 돌려줘요. */
export function validateQuestion(q) {
  if (!q.question) return '문제를 입력해 주세요.';
  if (len(q.question) > LIMITS.question) return `문제는 ${LIMITS.question}글자까지예요.`;
  if (q.qType === 'mc') {
    if (!q.answer) return '정답을 입력해 주세요.';
    if (q.wrongs.some((w) => !w)) return '오답 3개를 모두 입력해 주세요.';
    for (const c of [q.answer, ...q.wrongs]) if (len(c) > LIMITS.choice) return `보기는 ${LIMITS.choice}글자까지예요.`;
    const keys = [q.answer, ...q.wrongs].map(normalizeKey);
    if (keys.some((k) => !k)) return '보기에는 글자가 들어 있어야 해요.';
    if (new Set(keys).size !== keys.length) return '정답과 오답이 서로 같거나, 오답끼리 같은 것이 있어요.';
  } else {
    if (!q.answers.length) return '허용 정답을 하나 이상 입력해 주세요.';
    for (const a of q.answers) { if (len(a) > LIMITS.choice) return `정답은 ${LIMITS.choice}글자까지예요.`; if (!normalizeKey(a)) return '정답에는 글자가 들어 있어야 해요.'; }
  }
  return '';
}

/**
 * 문제 양식. opts.initial: 기존 문제(고치기), opts.draft, opts.onSubmit(q)
 * q = { qType:'mc'|'short', question, imageUrl, answer, wrongs[3] | answers[1~3], judgeMode }
 */
export function questionForm(opts) {
  const d = (opts.draft && opts.draft.store[opts.draft.key]) || opts.initial || {};
  let qType = d.qType === 'short' ? 'short' : 'mc';
  const msg = h('p', { class: 'msg warn', 'aria-live': 'polite' });
  const question = h('textarea', { class: 'input', rows: '2', maxlength: String(LIMITS.question * 2), 'aria-label': '문제', placeholder: `문제 (${LIMITS.question}글자까지)` });
  question.value = d.question || '';
  const img = imageField(d.imageUrl || '', () => save());
  const mk = (ph, val, label) => { const i = h('input', { class: 'input', type: 'text', maxlength: String(LIMITS.choice * 2), placeholder: ph, 'aria-label': label || ph, autocomplete: 'off' }); i.value = val || ''; return i; };
  const answer = mk('정답', d.answer, '정답');
  const wrongs = [0, 1, 2].map((i) => mk(`오답 ${i + 1}`, (d.wrongs || [])[i], `오답 ${i + 1}`));
  const answers = [0, 1, 2].map((i) => mk(i === 0 ? '정답 (꼭 필요해요)' : `다른 정답 ${i} (선택)`, (d.answers || [])[i], `허용 정답 ${i + 1}`));
  const judge = h('select', { class: 'input', 'aria-label': '판정 방식' },
    h('option', { value: 'exact' }, '완전히 같아야 정답'), h('option', { value: 'fuzzy' }, '비슷하면 정답(맞춤법 실수 허용)'));
  judge.value = d.judgeMode === 'fuzzy' ? 'fuzzy' : 'exact';
  const mcBox = h('div', { class: 'form-col' }, h('label', null, '보기'), answer, wrongs, h('p', { class: 'muted' }, '정답 1개와 오답 3개를 써요. 화면에서는 보기 순서가 섞여요.'));
  const shortBox = h('div', { class: 'form-col' }, h('label', null, '허용 정답 (최대 3개)'), answers, h('label', null, '판정 방식'), judge);
  const seg = h('div', { class: 'seg', role: 'radiogroup' });
  const segBtns = [['mc', '4지선다'], ['short', '단답형']].map(([k, label]) => h('button', {
    class: `seg-btn ${k === qType ? 'on' : ''}`, type: 'button', role: 'radio',
    onclick: () => { qType = k; show(); save(); }
  }, label));
  segBtns.forEach((b) => seg.append(b));
  function show() { segBtns.forEach((b, i) => b.classList.toggle('on', ['mc', 'short'][i] === qType)); mcBox.hidden = qType !== 'mc'; shortBox.hidden = qType !== 'short'; }
  show();

  function values() {
    const base = { qType, question: question.value.trim(), imageUrl: img.getValue() };
    return qType === 'mc'
      ? { ...base, answer: answer.value.trim(), wrongs: wrongs.map((w) => w.value.trim()) }
      : { ...base, answers: answers.map((a) => a.value.trim()).filter(Boolean), judgeMode: judge.value };
  }
  function save() { if (opts.draft) opts.draft.store[opts.draft.key] = { ...values(), answers: answers.map((a) => a.value), answer: answer.value, wrongs: wrongs.map((w) => w.value) }; }
  [question, answer, ...wrongs, ...answers].forEach((el) => el.addEventListener('input', () => { msg.textContent = ''; save(); }));
  judge.addEventListener('change', save);

  const submitBtn = h('button', { class: 'btn primary big', type: 'button', onclick: submit }, opts.submitText || '저장');
  async function submit() {
    const q = values();
    msg.textContent = validateQuestion(q);
    if (msg.textContent) return;
    submitBtn.disabled = true;
    try {
      const imgErr = await img.validate();
      if (imgErr) { msg.textContent = imgErr; return; }
      await opts.onSubmit(q);
    } catch (e) {
      if (opts.onError) opts.onError(e, msg); else throw e;
    } finally { submitBtn.disabled = false; }
  }
  const el = h('div', { class: 'form-card' },
    h('div', { class: 'form-col' }, h('label', null, '문제 형식'), seg),
    h('div', { class: 'form-col' }, h('label', null, '문제'), question),
    img.el, mcBox, shortBox, msg,
    h('div', { class: 'dialog-actions' }, opts.onCancel ? h('button', { class: 'btn ghost', type: 'button', onclick: opts.onCancel }, '취소') : null, submitBtn));
  return {
    el, values,
    reset() { question.value = ''; answer.value = ''; wrongs.forEach((w) => (w.value = '')); answers.forEach((a) => (a.value = '')); img.setValue(''); if (opts.draft) delete opts.draft.store[opts.draft.key]; },
    focus: () => question.focus()
  };
}

/** 문제 한 개를 사람이 읽기 쉬운 글로 */
export function describeQuestion(q) {
  return q.qType === 'mc' ? `정답: ${q.answer} / 오답: ${(q.wrongs || []).join(', ')}` : `정답: ${(q.answers || []).join(' | ')} (${q.judgeMode === 'fuzzy' ? '비슷하면 정답' : '완전 일치'})`;
}
