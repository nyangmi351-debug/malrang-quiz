// js/teacher-questions.js — 교사 문제 검수: 승인 / 수정 / 삭제 / 전체 승인 (학생의 새 문제·수정은 실시간 반영)

import { h, mount } from './core.js';
import { toast, confirmDialog, showModal, handleError, safeImg, emptyState } from './ui.js';
import { questionForm, describeQuestion } from './forms.js';
import * as W from './words.js';

const FILTERS = [['pending', '검수 대기'], ['approved', '승인됨'], ['all', '전체']];

export function mountQuestions(box, T) {
  const section = h('section', { class: 'card' });
  mount(box, section);
  let filter = 'pending';
  const release = T.data.watch('questions', 'tab');
  const off = T.data.on((kind) => { if (kind === 'questions') render(); });
  render();

  function render() {
    const all = (T.data.get('questions') || []).slice();
    const count = (st) => (st === 'all' ? all.length : all.filter((q) => q.status === st).length);
    const shown = all.filter((q) => filter === 'all' || q.status === filter);
    const pending = all.filter((q) => q.status === 'pending');
    mount(section,
      h('div', { class: 'row-between' }, h('h3', null, '문제 검수'),
        h('button', {
          class: 'btn small primary', type: 'button', disabled: !pending.length,
          onclick: async () => {
            if (!(await confirmDialog({ title: `대기 중인 문제 ${pending.length}개를 모두 승인할까요?`, okText: '전체 승인' }))) return;
            try { await W.approveQuestions(T.code, pending.map((q) => q.id)); toast('승인했어요.', 'ok'); }   // [쓰기]
            catch (e) { handleError(e, { teacher: true }); }
          }
        }, `전체 승인 (${pending.length})`)),
      T.room.settings.autoApproveQuestions ? h('p', { class: 'muted' }, '자동 승인이 켜져 있어서 새 문제는 바로 승인돼요.') : null,
      h('div', { class: 'chips' }, FILTERS.map(([key, label]) => h('button', {
        class: `chip-btn ${filter === key ? 'on' : ''}`, type: 'button', dataset: { qfilter: key }, onclick: () => { filter = key; render(); }
      }, `${label} ${count(key)}`))),
      shown.length ? h('div', { class: 'list' }, shown.map(row)) : emptyState('이 목록에는 문제가 없어요.'));
  }

  function row(q) {
    const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg, 'ok'); } catch (e) { handleError(e, { teacher: true }); } };
    return h('div', { class: 'list-row', dataset: { qid: q.id } },
      h('div', { class: 'list-main' },
        h('div', { class: 'chips' }, h('span', { class: 'chip' }, q.qType === 'mc' ? '4지선다' : '단답형'),
          h('span', { class: `chip ${q.status === 'approved' ? 'ok' : 'warn'}` }, q.status === 'approved' ? '승인됨' : '검수 대기'),
          q.edited ? h('span', { class: 'chip warn' }, '수정됨') : null, h('span', { class: 'muted' }, `낸 사람: ${q.createdBy || ''}`)),
        h('strong', null, q.question), h('p', { class: 'muted' }, describeQuestion(q)),
        q.imageUrl ? safeImg(q.imageUrl, '문제 그림', 'thumb') : null),
      h('div', { class: 'row-actions' },
        q.status === 'approved'
          ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => act(() => W.setQuestionApproved(T.code, q.id, false), '승인을 취소했어요.') }, '승인 취소')
          : h('button', { class: 'btn small primary', type: 'button', onclick: () => act(() => W.setQuestionApproved(T.code, q.id, true), '승인했어요.') }, '승인'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => edit(q) }, '수정'),
        h('button', { class: 'btn small danger-ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog({ title: '이 문제를 지울까요?', message: q.question, okText: '삭제', danger: true }))) return;
          act(() => W.teacherDeleteQuestion(T.code, q.id), '지웠어요.');   // [삭제]
        } }, '삭제')));
  }

  function edit(q) {
    const modal = showModal(h('div', null), { wide: true });
    const form = questionForm({
      initial: q, submitText: '저장', onCancel: () => modal.close(),
      onError: (e) => handleError(e, { teacher: true }),
      async onSubmit(v) { await W.teacherSaveQuestion(T.code, q.id, v); modal.close(); toast('저장했어요.', 'ok'); }   // [쓰기]
    });
    mount(modal.el.firstChild, h('h3', null, '문제 수정'), form.el);
  }

  return () => { release(); off(); };
}
