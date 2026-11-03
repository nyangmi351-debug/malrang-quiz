// js/study.js — 학생 [공부하기](자동 퀴즈)와 [단어 카드](플래시카드)
// 공부하기 점수는 5문제마다 / 화면을 떠날 때 / 화면이 숨겨질 때 모아서 한 번에 저장해요(쓰기를 아끼려고).

import { h, mount } from './core.js';
import { STUDY_FLUSH_EVERY } from './config.js';
import { toast, handleError, playSound, safeImg, emptyState } from './ui.js';
import { shuffle, blankExample } from './text.js';
import { createDeck, gradeAnswer, QTYPE_LABEL } from './quizgen.js';
import { loadBundle } from './packs.js';
import * as W from './words.js';

async function loadBoth(SC) {
  const meta = SC.room().packMeta || {};
  const [words, questions] = await Promise.all([loadBundle(SC.code, 'words', meta.words), loadBundle(SC.code, 'questions', meta.questions)]);
  return { words, questions };
}

/* ═════════ 1. 공부하기 ═════════ */
export function screenStudy(box, SC) {
  const body = h('section', { class: 'card study' });
  mount(box, body);
  let deck = null, q = null, answered = false, pending = 0, earned = 0, solved = 0, tried = 0, alive = true;
  const base = (SC.me() && SC.me().studyScore) || 0;

  const flush = async () => {
    if (pending <= 0) return;
    const n = pending; pending = 0;
    try { await W.addStudyScore(SC.code, SC.id, n); }   // [쓰기] 5문제마다 1번
    catch (e) { pending += n; handleError(e, {}); }
  };
  const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);

  mount(body, h('p', { class: 'muted' }, '문제를 준비하고 있어요…'));
  loadBoth(SC).then(({ words, questions }) => {
    if (!alive) return;
    deck = createDeck(words, questions);
    if (!deck.size) { mount(body, emptyState('아직 공부할 단어가 없어요. 선생님이 단어를 승인하면 여기서 공부할 수 있어요.')); return; }
    next();
  }).catch((e) => { handleError(e, {}); mount(body, h('p', { class: 'msg warn' }, '문제를 불러오지 못했어요.')); });

  async function next() {
    mount(body, h('p', { class: 'muted' }, '다음 문제를 고르고 있어요…'));
    answered = false;
    q = await deck.next();
    if (!alive) return;
    if (!q) { mount(body, emptyState('만들 수 있는 문제가 없어요.')); return; }
    draw();
  }

  function scoreBar() {
    return h('div', { class: 'chips' },
      h('span', { class: 'chip ok', dataset: { stat: 'score' } }, `내 점수 ${base + earned}점`),
      h('span', { class: 'chip' }, `이번에 ${solved}/${tried}`),
      h('span', { class: 'chip' }, QTYPE_LABEL[q.qtype] || ''));
  }

  function draw() {
    const feedback = h('div', { class: 'feedback', 'aria-live': 'polite' });
    const nextBtn = h('button', { class: 'btn primary big', type: 'button', hidden: true, onclick: next }, '다음 문제');
    const skipBtn = h('button', { class: 'btn small ghost', type: 'button', hidden: true, onclick: () => { if (!answered) { answered = true; next(); } } }, '그림이 안 보여요 (넘기기)');
    const qEl = h('div', { class: 'q-card' },
      q.prompt ? h('p', { class: 'q-text' }, q.prompt) : null,
      q.imageUrl ? safeImg(q.imageUrl, '문제 그림', 'q-img', () => { skipBtn.hidden = false; }) : null);

    function finish(correct, shownAnswer) {
      if (answered) return;
      answered = true;
      tried++;
      if (correct) { solved++; earned++; pending++; if (pending >= STUDY_FLUSH_EVERY) flush(); }
      playSound(correct ? 'correct' : 'wrong');
      feedback.className = `feedback ${correct ? 'ok' : 'bad'}`;
      feedback.textContent = correct ? '정답이에요! +1점 🎉' : `아쉬워요. 정답은 “${q.label}”`;
      nextBtn.hidden = false; skipBtn.hidden = true;
      nextBtn.focus();
      mount(scoreBox, scoreBar());
    }

    let inputArea;
    if (q.fmt === 'mc') {
      const buttons = q.choices.map((c, i) => h('button', {
        class: 'choice', type: 'button', onclick: () => {
          if (answered) return;
          const ok = gradeAnswer(q, i);
          buttons.forEach((b, j) => { b.disabled = true; if (j === q.answerIdx) b.classList.add('right'); else if (j === i) b.classList.add('wrong'); });
          finish(ok);
        }
      }, c));
      inputArea = h('div', { class: 'choices' }, buttons);
    } else {
      const input = h('input', { class: 'input', type: 'text', autocomplete: 'off', placeholder: '정답을 써 주세요', 'aria-label': '정답 입력', maxlength: '120' });
      const submit = () => {
        if (answered || !input.value.trim()) return;
        input.disabled = true;
        finish(gradeAnswer(q, input.value, SC.room().settings.similarityThreshold));
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); } });   // 한글 조합 중 Enter는 무시
      inputArea = h('div', { class: 'form-row' }, input, h('button', { class: 'btn primary', type: 'button', onclick: submit }, '확인'));
      setTimeout(() => input.focus(), 0);
    }
    const scoreBox = h('div');
    mount(body, scoreBox, qEl, inputArea, feedback, h('div', { class: 'dialog-actions' }, skipBtn, nextBtn));
    mount(scoreBox, scoreBar());
  }

  return async () => {
    alive = false;
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
    await flush();   // 화면을 떠날 때 남은 점수를 저장해요
    if (SC.refreshMe) SC.refreshMe();
  };
}

/* ═════════ 2. 단어 카드 (플래시카드) ═════════ */
export function screenCards(box, SC) {
  const body = h('section', { class: 'card' });
  mount(box, body);
  let cards = [], idx = 0, flipped = false, alive = true;

  loadBoth(SC).then(({ words }) => {
    if (!alive) return;
    if (!words.length) { mount(body, emptyState('아직 승인된 단어가 없어요.')); return; }
    cards = shuffle(words);
    draw();
  }).catch((e) => { handleError(e, {}); mount(body, h('p', { class: 'msg warn' }, '단어를 불러오지 못했어요.')); });

  const onKey = (e) => {
    if (!cards.length) return;
    if (e.key === 'ArrowRight') go(1); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === ' ') { e.preventDefault(); flip(); }
  };
  document.addEventListener('keydown', onKey);

  function go(d) { idx = (idx + d + cards.length) % cards.length; flipped = false; draw(); }
  function flip() { flipped = !flipped; playSound('flip'); const el = body.querySelector('.flip-card'); if (el) el.classList.toggle('flipped', flipped); }

  function draw() {
    const w = cards[idx];
    const ex = w.example ? (blankExample(w.example, w.word) || w.example) : '';
    const front = h('div', { class: 'face front' },
      h('p', { class: 'card-meaning' }, w.meaning),
      w.imageUrl ? safeImg(w.imageUrl, '단어 그림', 'q-img') : null,
      ex ? h('p', { class: 'muted' }, `예문: ${ex}`) : null,
      h('p', { class: 'muted hint' }, '눌러서 뒤집어요'));
    const back = h('div', { class: 'face back' }, h('p', { class: 'card-word' }, w.word), h('p', { class: 'muted' }, w.type === '단어' ? '' : w.type === '속담' ? '속담' : '관용 표현'));
    const card = h('div', { class: `flip-card${flipped ? ' flipped' : ''}`, role: 'button', tabindex: '0', 'aria-label': '카드 뒤집기', onclick: flip,
      onkeydown: (e) => { if (e.key === 'Enter') flip(); } }, h('div', { class: 'flip-inner' }, front, back));
    mount(body,
      h('div', { class: 'row-between' }, h('h3', null, '단어 카드'), h('span', { class: 'chip', dataset: { stat: 'cardpos' } }, `${idx + 1} / ${cards.length}`)),
      card,
      h('div', { class: 'dialog-actions' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => go(-1) }, '← 이전'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { cards = shuffle(cards); idx = 0; flipped = false; draw(); toast('카드를 다시 섞었어요.', 'ok'); } }, '처음부터 다시 섞기'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => go(1) }, '다음 →')));
  }

  return () => { alive = false; document.removeEventListener('keydown', onKey); };
}
