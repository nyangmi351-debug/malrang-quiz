// js/student-input.js — 학생의 단어·문제 화면: 단어 내기, 내 단어 카드, 내가 낸 단어, 문제 내기, 내가 낸 문제

import { h, mount, clear } from './core.js';
import { toast, confirmDialog, handleError, showModal, safeImg, emptyState } from './ui.js';
import { TYPE_LABEL } from './text.js';
import { wordForm, questionForm, describeQuestion } from './forms.js';
import * as W from './words.js';

/** 규칙 위반(중복, 한도 초과 등)은 안내 글로, 그 밖의 오류는 공통 처리로 */
async function onFormError(e, msg) {
  if (e instanceof W.RuleError) {
    msg.textContent = e.message;
    if (e.rule === 'DUP') await confirmDialog({ title: '중복된 단어입니다', message: '이미 등록된 단어예요. 다른 단어를 써 주세요.', okText: '확인', hideCancel: true });
  } else handleError(e, {});
}

const statusChip = (status, edited) => {
  const map = { assigned: ['작성 전', 'chip'], pending: [edited ? '다시 검수 대기(수정됨)' : '검수 대기', 'chip warn'], approved: ['승인됨', 'chip ok'] };
  const [text, cls] = map[status] || ['', 'chip'];
  return h('span', { class: cls }, text);
};

/* ═════════ 1. 단어 내기 ═════════ */
export function screenWordNew(box, SC) {
  const quota = h('p', { class: 'chip' });
  const holder = h('div');
  function renderQuota() {
    const limit = SC.room().settings.studentWordLimit;
    const used = (SC.me() && SC.me().wordCount) || 0;
    quota.textContent = limit > 0 ? `내가 낸 단어 ${used}/${limit}개` : `내가 낸 단어 ${used}개`;
  }
  const form = wordForm({
    draft: { store: SC.drafts, key: 'wordNew' },
    submitText: '단어 내기',
    onError: onFormError,
    async onSubmit(v) {
      await W.saveStudentWord(SC.code, SC.id, SC.nickname, v, SC.room().settings.studentWordLimit);   // [읽기][쓰기]
      toast('단어를 냈어요! 선생님이 확인하면 공부에 쓰여요.', 'ok');
      form.reset();
      await SC.refreshMe();
      renderQuota();
      form.focus();
    }
  });
  mount(box, h('section', { class: 'card' }, h('h3', null, '단어 내기'), quota,
    h('p', { class: 'muted' }, '단어·관용 표현·속담을 뜻과 함께 써서 내요. 이미 있는 단어는 낼 수 없어요.'), form.el));
  renderQuota();
  SC.refreshMe().then(renderQuota);
}

/* ═════════ 2. 내 단어 카드 (선생님이 나눠 준 카드) ═════════ */
export function screenMyCards(box, SC) {
  const listBox = h('div', { class: 'list' });
  mount(box, h('section', { class: 'card' },
    h('div', { class: 'row-between' }, h('h3', null, '내 단어 카드'), h('button', { class: 'btn small ghost', type: 'button', onclick: load }, '새로고침')),
    h('p', { class: 'muted' }, '선생님이 나눠 준 단어예요. 뜻과 예문, 그림 주소를 채워서 [제출]해요.'), listBox));
  load();

  async function load() {
    mount(listBox, h('p', { class: 'muted' }, '불러오는 중이에요…'));
    try {
      const all = (await W.fetchMyWords(SC.code, SC.id)).filter((w) => w.origin === 'teacher');   // [읽기]
      clear(listBox);
      if (!all.length) { listBox.append(emptyState('아직 받은 카드가 없어요. 선생님이 나눠 주면 [새로고침]을 눌러 보세요.')); return; }
      const order = { assigned: 0, pending: 1, approved: 2 };
      all.sort((a, b) => order[a.status] - order[b.status] || (a.word < b.word ? -1 : 1));
      all.forEach((w) => listBox.append(cardRow(w)));
    } catch (e) { handleError(e, { retry: load }); mount(listBox, h('p', { class: 'msg warn' }, '불러오지 못했어요.')); }
  }

  function cardRow(w) {
    const editable = w.status !== 'approved';
    return h('div', { class: 'list-row' },
      h('div', { class: 'list-main' }, h('strong', null, w.word), h('span', { class: 'chip' }, TYPE_LABEL[w.type] || w.type), statusChip(w.status),
        w.meaning ? h('p', { class: 'muted' }, w.meaning) : null),
      editable ? h('button', { class: `btn small ${w.status === 'assigned' ? 'primary' : 'ghost'}`, type: 'button', onclick: () => open(w) }, w.status === 'assigned' ? '작성하기' : '고치기') : null);
  }

  function open(w) {
    const modal = showModal(h('div', null), { wide: true });
    const form = wordForm({
      initial: w, lockHeading: true, submitText: '제출', onCancel: () => modal.close(), onError: onFormError,
      async onSubmit(v) {
        await W.submitAssignedCard(SC.code, SC.id, w.key, v);   // [읽기][쓰기]
        modal.close();
        toast('제출했어요! 선생님이 확인할 거예요.', 'ok');
        load();
      }
    });
    mount(modal.el.firstChild, h('h3', null, w.word), form.el);
  }
}

/* ═════════ 3. 내가 낸 단어 ═════════ */
export function screenMyWords(box, SC) {
  const listBox = h('div', { class: 'list' });
  mount(box, h('section', { class: 'card' },
    h('div', { class: 'row-between' }, h('h3', null, '내가 낸 단어'), h('button', { class: 'btn small ghost', type: 'button', onclick: load }, '새로고침')),
    h('p', { class: 'muted' }, '승인되기 전에는 고치거나 지울 수 있어요. 승인된 단어는 볼 수만 있어요.'), listBox));
  load();

  async function load() {
    mount(listBox, h('p', { class: 'muted' }, '불러오는 중이에요…'));
    try {
      const mine = (await W.fetchMyWords(SC.code, SC.id)).filter((w) => w.origin === 'student' || w.status !== 'assigned');   // [읽기]
      clear(listBox);
      if (!mine.length) { listBox.append(emptyState('아직 낸 단어가 없어요.')); return; }
      mine.sort((a, b) => (a.word < b.word ? -1 : 1));
      mine.forEach((w) => listBox.append(row(w)));
    } catch (e) { handleError(e, { retry: load }); mount(listBox, h('p', { class: 'msg warn' }, '불러오지 못했어요.')); }
  }

  function row(w) {
    const locked = w.status === 'approved';
    return h('div', { class: 'list-row' },
      h('div', { class: 'list-main' },
        h('div', { class: 'chips' }, h('strong', null, w.word), h('span', { class: 'chip' }, TYPE_LABEL[w.type] || w.type), statusChip(w.status)),
        h('p', { class: 'muted' }, w.meaning),
        w.example ? h('p', { class: 'muted' }, `예문: ${w.example}`) : null,
        w.imageUrl ? safeImg(w.imageUrl, w.word, 'thumb') : null),
      locked ? null : h('div', { class: 'row-actions' },
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => edit(w) }, '고치기'),
        w.origin === 'student' ? h('button', { class: 'btn small danger-ghost', type: 'button', onclick: () => remove(w) }, '지우기') : null));
  }

  function edit(w) {
    const modal = showModal(h('div', null), { wide: true });
    const isCard = w.origin === 'teacher';
    const form = wordForm({
      initial: w, lockHeading: isCard, submitText: '저장', onCancel: () => modal.close(), onError: onFormError,
      async onSubmit(v) {
        if (isCard) await W.submitAssignedCard(SC.code, SC.id, w.key, v);   // [읽기][쓰기]
        else await W.updateStudentWord(SC.code, SC.id, w.key, v);   // [읽기][쓰기]
        modal.close();
        toast('고쳤어요.', 'ok');
        load();
      }
    });
    mount(modal.el.firstChild, h('h3', null, '단어 고치기'), form.el);
  }

  async function remove(w) {
    const ok = await confirmDialog({ title: '단어를 지울까요?', message: `‘${w.word}’를 지워요.`, okText: '지우기', danger: true });
    if (!ok) return;
    try {
      await W.deleteStudentWord(SC.code, SC.id, w.key);   // [읽기][삭제][쓰기]
      toast('지웠어요. 단어를 더 낼 수 있어요.', 'ok');
      await SC.refreshMe();
      load();
    } catch (e) { if (e instanceof W.RuleError) toast(e.message, 'warn'); else handleError(e, {}); }
  }
}

/* ═════════ 4. 문제 내기 ═════════ */
export function screenQuestionNew(box, SC) {
  const quota = h('p', { class: 'chip' });
  function renderQuota() {
    const limit = SC.room().settings.studentQuestionLimit;
    const used = (SC.me() && SC.me().questionCount) || 0;
    quota.textContent = limit > 0 ? `내가 낸 문제 ${used}/${limit}개` : `내가 낸 문제 ${used}개`;
  }
  const form = questionForm({
    draft: { store: SC.drafts, key: 'questionNew' }, submitText: '문제 내기', onError: onFormError,
    async onSubmit(q) {
      const s = SC.room().settings;
      await W.saveQuestion(SC.code, SC.id, SC.nickname, q, { limit: s.studentQuestionLimit, autoApprove: !!s.autoApproveQuestions });   // [읽기][쓰기]
      toast(s.autoApproveQuestions ? '문제를 냈어요! 바로 퀴즈에 쓰일 수 있어요.' : '문제를 냈어요! 선생님이 확인하면 퀴즈에 쓰여요.', 'ok');
      form.reset();
      await SC.refreshMe();
      renderQuota();
      form.focus();
    }
  });
  mount(box, h('section', { class: 'card' }, h('h3', null, '문제 내기'), quota,
    h('p', { class: 'muted' }, '친구들이 풀 퀴즈 문제를 내 봐요. 4지선다나 단답형 중에 골라요.'), form.el));
  renderQuota();
  SC.refreshMe().then(renderQuota);
}

/* ═════════ 5. 내가 낸 문제 ═════════ */
export function screenMyQuestions(box, SC) {
  const listBox = h('div', { class: 'list' });
  mount(box, h('section', { class: 'card' },
    h('div', { class: 'row-between' }, h('h3', null, '내가 낸 문제'), h('button', { class: 'btn small ghost', type: 'button', onclick: load }, '새로고침')),
    h('p', { class: 'muted' }, '내 문제는 언제든 고칠 수 있어요. 승인 전에는 지울 수도 있어요.'), listBox));
  load();

  async function load() {
    mount(listBox, h('p', { class: 'muted' }, '불러오는 중이에요…'));
    try {
      const mine = await W.fetchMyQuestions(SC.code, SC.id);   // [읽기]
      clear(listBox);
      if (!mine.length) { listBox.append(emptyState('아직 낸 문제가 없어요.')); return; }
      mine.forEach((q) => listBox.append(row(q)));
    } catch (e) { handleError(e, { retry: load }); mount(listBox, h('p', { class: 'msg warn' }, '불러오지 못했어요.')); }
  }

  function row(q) {
    return h('div', { class: 'list-row' },
      h('div', { class: 'list-main' },
        h('div', { class: 'chips' }, h('span', { class: 'chip' }, q.qType === 'mc' ? '4지선다' : '단답형'), statusChip(q.status, q.edited)),
        h('strong', null, q.question), h('p', { class: 'muted' }, describeQuestion(q)),
        q.imageUrl ? safeImg(q.imageUrl, '문제 그림', 'thumb') : null),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => edit(q) }, '고치기'),
        q.status === 'approved' ? null : h('button', { class: 'btn small danger-ghost', type: 'button', onclick: () => remove(q) }, '지우기')));
  }

  function edit(q) {
    const s = SC.room().settings;
    const modal = showModal(h('div', null), { wide: true });
    const warn = !s.autoApproveQuestions && q.status === 'approved'
      ? h('p', { class: 'msg warn' }, '이미 승인된 문제를 고치면 선생님이 다시 확인할 때까지 퀴즈에서 빠져요.') : null;
    const form = questionForm({
      initial: q, submitText: '저장', onCancel: () => modal.close(), onError: onFormError,
      async onSubmit(v) {
        await W.updateQuestion(SC.code, SC.id, q.id, v, { autoApprove: !!SC.room().settings.autoApproveQuestions });   // [읽기][쓰기]
        modal.close();
        toast('고쳤어요.', 'ok');
        load();
      }
    });
    mount(modal.el.firstChild, h('h3', null, '문제 고치기'), warn, form.el);
  }

  async function remove(q) {
    const ok = await confirmDialog({ title: '문제를 지울까요?', okText: '지우기', danger: true });
    if (!ok) return;
    try {
      await W.deleteQuestion(SC.code, SC.id, q.id);   // [읽기][삭제][쓰기]
      toast('지웠어요.', 'ok');
      await SC.refreshMe();
      load();
    } catch (e) { if (e instanceof W.RuleError) toast(e.message, 'warn'); else handleError(e, {}); }
  }
}
