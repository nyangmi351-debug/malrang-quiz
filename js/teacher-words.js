// js/teacher-words.js — 교사 [단어·문제] 탭: 단어 일괄 등록, 카드 배정, 단어 검수 (+ 문제 검수는 teacher-questions.js)

import { h, mount, clear } from './core.js';
import { PRESENCE_WINDOW_MS, LIMITS } from './config.js';
import { toast, confirmDialog, showModal, handleError, safeImg, emptyState } from './ui.js';
import { TYPE_LABEL, classifyBulk, toMs } from './text.js';
import { wordForm } from './forms.js';
import * as D from './db.js';
import * as W from './words.js';
import { mountQuestions } from './teacher-questions.js';
import { downloadWordsXlsx, exportableWords } from './word-export.js';

const FILTERS = [['pending', '검수 대기'], ['assigned', '작성 전'], ['approved', '승인됨'], ['all', '전체']];
const SYNC_TEXT = { idle: '', pending: '저장 대기 중…', saving: '저장하는 중…', done: '동기화 완료 ✓', error: '동기화 실패 (다시 시도 중)' };

export function mountWordsTab(box, T) {
  const syncChip = h('span', { class: 'chip sync' });
  const bulkBox = h('section', { class: 'card' });
  const assignBox = h('section', { class: 'card' });
  const listBox = h('section', { class: 'card' });
  const qBox = h('div');
  mount(box, h('div', { class: 'row-between' }, h('h3', null, '단어·문제 관리'), syncChip), bulkBox, assignBox, listBox, qBox);

  let filter = 'pending';
  let bulkText = '';
  const nameOf = (id) => { const s = T.students.find((x) => x.id === id); return s ? s.nickname : id; };

  const releaseWatch = T.data.watch('words', 'tab');
  const disposeQ = mountQuestions(qBox, T);
  const offData = T.data.on((kind) => { if (kind === 'sync') renderSync(); else if (kind === 'words') { renderAssign(); renderList(); } });
  const offStudents = T.on('students', renderAssign);
  renderSync(); renderBulk(); renderAssign(); renderList();

  function renderSync() {
    syncChip.textContent = SYNC_TEXT[T.data.syncStatus] || '';
    syncChip.hidden = !syncChip.textContent;
    syncChip.classList.toggle('ok', T.data.syncStatus === 'done');
  }

  /* ═════════ 1. 일괄 등록 ═════════ */
  function renderBulk() {
    const area = h('textarea', { class: 'input', rows: '5', 'aria-label': '단어 붙여넣기', placeholder: '한 줄에 하나씩 붙여넣어요.\n예)\n사과\n소탐대실, 속담\n발이 넓다, 관용 표현' });
    area.value = bulkText;
    const preview = h('div', { class: 'bulk-preview' });
    const regBtn = h('button', { class: 'btn primary', type: 'button', disabled: true }, '등록');
    let current = null;
    async function refresh() {
      bulkText = area.value;
      if (!bulkText.trim()) { clear(preview); regBtn.disabled = true; regBtn.textContent = '등록'; current = null; return; }
      const list = await T.data.ensure('words');   // [읽기] 처음 한 번
      const existing = new Set(list.map((w) => w.key));
      current = classifyBulk(bulkText, existing, LIMITS.word);
      const c = current;
      mount(preview,
        h('div', { class: 'chips' },
          h('span', { class: 'chip ok' }, `새로 등록 ${c.fresh.length}`),
          h('span', { class: 'chip' }, `기존 단어와 중복 ${c.dupExisting.length}`),
          h('span', { class: 'chip' }, `붙여넣은 목록 안에서 중복 ${c.dupInList.length}`),
          h('span', { class: 'chip' }, `글자 수 초과 ${c.tooLong.length}`),
          c.invalid.length ? h('span', { class: 'chip' }, `글자 없음 ${c.invalid.length}`) : null),
        c.fresh.length ? h('p', { class: 'muted' }, c.fresh.slice(0, 40).map((e) => `${e.word}${e.type !== '단어' ? `(${TYPE_LABEL[e.type]})` : ''}`).join(' · ') + (c.fresh.length > 40 ? ` … 외 ${c.fresh.length - 40}개` : '')) : null);
      regBtn.disabled = !c.fresh.length;
      regBtn.textContent = c.fresh.length ? `${c.fresh.length}개 등록` : '등록';
    }
    area.addEventListener('input', () => { clearTimeout(area._t); area._t = setTimeout(refresh, 300); });
    regBtn.addEventListener('click', async () => {
      if (!current || !current.fresh.length) return;
      regBtn.disabled = true;
      try {
        await W.bulkRegister(T.code, current.fresh);   // [쓰기] 등록 개수만큼
        toast(`${current.fresh.length}개를 등록했어요. [랜덤 배정]을 눌러 학생에게 나눠 주세요.`, 'ok');
        bulkText = ''; area.value = '';
        refresh();
      } catch (e) { handleError(e, { teacher: true }); regBtn.disabled = false; }
    });
    mount(bulkBox, h('h3', null, '단어 일괄 등록'),
      h('p', { class: 'muted' }, '한 줄에 하나씩 붙여넣어요. 끝에 “, 속담” 또는 “, 관용 표현”을 붙이면 유형이 정해져요(없으면 단어). 등록하면 뜻이 비어 있는 “배정 대기 카드”가 만들어져요.'),
      area, preview, h('div', { class: 'dialog-actions' }, regBtn));
    if (bulkText) refresh();
  }

  /* ═════════ 2. 카드 배정 ═════════ */
  function renderAssign() {
    const words = T.data.get('words') || [];
    const waiting = words.filter((w) => w.origin === 'teacher' && !w.assignedTo && w.status === 'assigned');
    const nowMs = D.now();
    const online = T.students.filter((s) => nowMs - toMs(s.lastSeen) < PRESENCE_WINDOW_MS);
    const run = async (label) => {
      const plan = W.planAssignment(words, online.map((s) => s.id));
      if (!plan.length) { toast('나눠 줄 카드나 접속 중인 학생이 없어요.', 'warn'); return; }
      try { await W.applyAssignment(T.code, plan); toast(`${plan.length}개 카드를 ${label}했어요. 학생은 [내 단어 카드]에서 새로고침해요.`, 'ok'); }   // [쓰기]
      catch (e) { handleError(e, { teacher: true }); }
    };
    const assignedCount = words.filter((w) => w.origin === 'teacher' && w.assignedTo).length;
    mount(assignBox, h('h3', null, '카드 배정'),
      h('p', { class: 'muted' }, `배정 대기 카드 ${waiting.length}개 · 지금 접속 중인 학생 ${online.length}명 · 배정 완료 ${assignedCount}개`),
      h('div', { class: 'chips' },
        h('button', { class: 'btn small primary', type: 'button', disabled: !waiting.length, onclick: () => run('배정') }, '랜덤 배정'),
        h('button', { class: 'btn small ghost', type: 'button', disabled: !waiting.length, onclick: () => run('배정') }, '남은 카드 배정')),
      h('p', { class: 'muted' }, '카드가 적은 학생부터 하나씩 나눠 줘요. 새로 등록한 카드나 늦게 들어온 학생이 있으면 [남은 카드 배정]을 다시 눌러요.'));
  }

  /* ═════════ 3. 단어 목록과 검수 ═════════ */
  function renderList() {
    const words = (T.data.get('words') || []).slice();
    const count = (st) => (st === 'all' ? words.length : words.filter((w) => w.status === st).length);
    const shown = words.filter((w) => filter === 'all' || w.status === filter).sort((a, b) => (a.word < b.word ? -1 : 1));
    const approvable = words.filter((w) => w.status === 'pending' && w.meaning);
    const exportCount = exportableWords(words).length;
    mount(listBox,
      h('div', { class: 'row-between' }, h('h3', null, '단어 검수'),
        h('div', { class: 'chips' },
        h('button', {
          class: 'btn small ghost', type: 'button', disabled: !exportCount, dataset: { act: 'export-words' },
          title: '뜻이 적힌 카드를 엑셀 표(.xlsx)로 내려받아요',
          onclick: () => {
            try { const n = downloadWordsXlsx({ words: T.data.get('words') || [], students: T.students, roomName: T.room && T.room.roomName }); toast(`단어 카드 ${n}개를 엑셀 파일로 내려받았어요.`, 'ok'); }
            catch (e) { handleError(e, { teacher: true }); }
          }
        }, `📥 엑셀로 내려받기 (${exportCount})`),
        h('button', {
          class: 'btn small primary', type: 'button', disabled: !approvable.length,
          onclick: async () => {
            if (!(await confirmDialog({ title: `뜻이 있는 대기 단어 ${approvable.length}개를 모두 승인할까요?`, okText: '전체 승인' }))) return;
            try { await W.approveWords(T.code, approvable.map((w) => w.key)); T.data.sync.schedule('words'); toast('승인했어요.', 'ok'); }   // [쓰기]
            catch (e) { handleError(e, { teacher: true }); }
          }
        }, `전체 승인 (${approvable.length})`))),
      h('div', { class: 'chips' }, FILTERS.map(([key, label]) => h('button', {
        class: `chip-btn ${filter === key ? 'on' : ''}`, type: 'button', dataset: { filter: key }, onclick: () => { filter = key; renderList(); }
      }, `${label} ${count(key)}`))),
      shown.length ? h('div', { class: 'list' }, shown.map(row)) : emptyState('이 목록에는 단어가 없어요.'));
  }

  function row(w) {
    const owner = w.origin === 'teacher' ? (w.assignedTo ? `담당: ${nameOf(w.assignedTo)}` : '담당자 없음') : `낸 사람: ${w.createdBy || ''}`;
    const statusText = { assigned: '작성 전', pending: '검수 대기', approved: '승인됨' }[w.status] || w.status;
    const canApprove = w.status !== 'approved' && !!w.meaning;
    const act = async (fn, okMsg, touchBundle) => {
      try { await fn(); if (okMsg) toast(okMsg, 'ok'); if (touchBundle) T.data.sync.schedule('words'); }
      catch (e) { if (e instanceof W.RuleError) toast(e.message, 'warn'); else handleError(e, { teacher: true }); }
    };
    return h('div', { class: 'list-row', dataset: { key: w.key } },
      h('div', { class: 'list-main' },
        h('div', { class: 'chips' }, h('strong', null, w.word), h('span', { class: 'chip' }, TYPE_LABEL[w.type] || w.type),
          h('span', { class: `chip ${w.status === 'approved' ? 'ok' : w.status === 'pending' ? 'warn' : ''}` }, statusText), h('span', { class: 'muted' }, owner)),
        w.meaning ? h('p', null, w.meaning) : h('p', { class: 'muted' }, '(뜻 없음)'),
        w.example ? h('p', { class: 'muted' }, `예문: ${w.example}`) : null,
        w.imageUrl ? safeImg(w.imageUrl, w.word, 'thumb') : null),
      h('div', { class: 'row-actions' },
        w.status === 'approved'
          ? h('button', { class: 'btn small ghost', type: 'button', onclick: () => act(() => W.setWordStatus(T.code, w.key, 'pending'), '승인을 취소했어요.', true) }, '승인 취소')
          : h('button', { class: 'btn small primary', type: 'button', disabled: !canApprove, title: canApprove ? '' : '뜻이 있어야 승인할 수 있어요', onclick: () => act(() => W.setWordStatus(T.code, w.key, 'approved'), '승인했어요.', true) }, '승인'),
        h('button', { class: 'btn small ghost', type: 'button', onclick: () => edit(w) }, '수정'),
        h('button', { class: 'btn small danger-ghost', type: 'button', onclick: async () => {
          if (!(await confirmDialog({ title: '이 단어를 지울까요?', message: `‘${w.word}’`, okText: '삭제', danger: true }))) return;
          act(() => W.teacherDeleteWord(T.code, w.key), '지웠어요.', w.status === 'approved');   // [삭제]
        } }, '삭제'),
        w.origin === 'teacher' && w.status !== 'approved' ? ownerSelect(w, act) : null));
  }

  function ownerSelect(w, act) {
    const sel = h('select', { class: 'input mini', 'aria-label': `${w.word} 담당자` },
      h('option', { value: '' }, '담당자 회수'),
      [...T.students].sort((a, b) => (a.nickname < b.nickname ? -1 : 1)).map((s) => h('option', { value: s.id }, s.nickname)));
    sel.value = w.assignedTo || '';
    sel.addEventListener('change', () => act(() => W.assignWord(T.code, w.key, sel.value || null), sel.value ? '담당자를 바꿨어요.' : '카드를 회수했어요.', false));
    return sel;
  }

  function edit(w) {
    const modal = showModal(h('div', null), { wide: true });
    const form = wordForm({
      initial: w, submitText: '저장', onCancel: () => modal.close(),
      onError: (e, msg) => { if (e instanceof W.RuleError) msg.textContent = e.message; else handleError(e, { teacher: true }); },
      async onSubmit(v) {
        await W.teacherSaveWord(T.code, w.key, v);   // [읽기][쓰기]
        modal.close();
        toast('저장했어요.', 'ok');
        if (w.status === 'approved') T.data.sync.schedule('words');
      }
    });
    mount(modal.el.firstChild, h('h3', null, '단어 수정'), form.el);
  }

  return () => { releaseWatch(); disposeQ(); offData(); offStudents(); };
}
