// js/teacher-settings.js — 교사 [설정] 탭: 모둠 수, 학생 한도, 자동 승인, 유사도, 카드 투표, 방 삭제, 개발용 도구

import { h, mount } from './core.js';
import { toast, confirmDialog, handleError } from './ui.js';
import * as D from './db.js';
import * as W from './words.js';
import { mountTestTools } from './testmode.js';

export function mountSettingsTab(box, T) {
  const body = h('div');
  mount(box, body);
  const off = T.on('room', () => {
    // 입력칸을 만지는 중이면 화면을 다시 그리지 않아요
    if (body.contains(document.activeElement) && document.activeElement.matches('input,select')) return;
    render();
  });
  let disposeTest = null;
  render();

  async function setSetting(patch) {
    try { await D.updateDoc(D.roomRef(T.code), patch); }   // [쓰기]
    catch (e) { handleError(e, { teacher: true }); }
  }

  function render() {
    const s = T.room.settings;
    const inGame = T.room.gameState.mode !== 'idle' && T.room.gameState.mode !== 'ranking';

    /* 모둠 수 */
    const groupSel = h('select', { class: 'input', 'aria-label': '모둠 수', disabled: inGame }, [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n) }, `${n}개`)));
    groupSel.value = String(s.groupCount);
    const groupBtn = h('button', {
      class: 'btn primary', type: 'button', disabled: inGame,
      onclick: async () => {
        const n = Number(groupSel.value);
        if (n === s.groupCount) { toast('지금과 같은 모둠 수예요.', 'info'); return; }
        if (!(await confirmDialog({ title: '모둠 수를 바꿀까요?', message: '모든 학생이 모둠을 다시 선택해요.', okText: '바꾸기' }))) return;
        groupBtn.disabled = true;
        try { await D.changeGroupCount(T.code, n, T.students.map((x) => x.id)); toast(`모둠 수를 ${n}개로 바꿨어요. 학생들이 새 모둠을 골라요.`, 'ok'); }   // [쓰기]
        catch (e) { handleError(e, { teacher: true }); groupBtn.disabled = false; }
      }
    }, '모둠 수 바꾸기');

    /* 숫자 입력 */
    const numInput = (value, min, max, onSave, label) => {
      const input = h('input', { class: 'input mini-num', type: 'number', min: String(min), max: String(max), value: String(value), 'aria-label': label });
      input.addEventListener('change', () => {
        const n = Math.max(min, Math.min(max, Math.round(Number(input.value) || 0)));
        input.value = String(n);
        onSave(n);
      });
      return input;
    };

    /* 자동 승인 */
    const auto = h('input', { type: 'checkbox', checked: !!s.autoApproveQuestions, id: 'auto-approve', 'aria-label': '학생 출제 문제 자동 승인' });
    auto.addEventListener('change', async () => {
      const turnOn = auto.checked;
      if (!turnOn) { await setSetting({ 'settings.autoApproveQuestions': false }); return; }
      try {
        const list = await T.data.ensure('questions');   // [읽기] 처음 한 번
        const pending = list.filter((q) => q.status === 'pending');
        if (pending.length) {
          const yes = await confirmDialog({ title: `대기 중인 문제 ${pending.length}개도 모두 승인할까요?`, message: '[아니오]를 누르면 대기 문제는 그대로 두고, 이후 새로 내는 문제부터 자동 승인돼요.', okText: '예, 모두 승인', cancelText: '아니오' });
          if (yes) { await W.approveQuestions(T.code, pending.map((q) => q.id)); await T.data.changed('questions', { reload: true }); }   // [쓰기]
        }
        await setSetting({ 'settings.autoApproveQuestions': true });
      } catch (e) { handleError(e, { teacher: true }); }
    });

    const simInput = h('input', { class: 'input mini-num', type: 'number', min: '0.5', max: '1', step: '0.05', value: String(s.similarityThreshold), 'aria-label': '유사도 기준' });
    simInput.addEventListener('change', () => {
      const n = Math.max(0.5, Math.min(1, Number(simInput.value) || 0.85));
      simInput.value = String(n);
      setSetting({ 'settings.similarityThreshold': n });
    });

    const vote = h('input', { type: 'checkbox', checked: !!s.cardVoteEnabled, 'aria-label': '카드 투표 사용' });
    vote.addEventListener('change', () => setSetting({ 'settings.cardVoteEnabled': vote.checked }));

    const testHolder = h('div');
    mount(body,
      h('section', { class: 'card' }, h('h3', null, '방 설정'),
        h('div', { class: 'form-row' }, h('label', null, '모둠 수'), groupSel, groupBtn),
        inGame ? h('p', { class: 'msg warn' }, '게임 중에는 모둠 수를 바꿀 수 없어요.') : null,
        h('div', { class: 'form-row' }, h('label', null, '학생당 단어'), numInput(s.studentWordLimit, 0, 100, (n) => setSetting({ 'settings.studentWordLimit': n }), '학생당 단어 최대 개수'), h('span', { class: 'muted' }, '개까지 (0은 제한 없음)')),
        h('div', { class: 'form-row' }, h('label', null, '학생당 문제'), numInput(s.studentQuestionLimit, 0, 200, (n) => setSetting({ 'settings.studentQuestionLimit': n }), '학생당 문제 최대 개수'), h('span', { class: 'muted' }, '개까지 (0은 제한 없음)')),
        h('div', { class: 'form-row' }, h('label', { for: 'auto-approve' }, '문제 자동 승인'), auto, h('span', { class: 'muted' }, '켜면 학생이 낸 문제가 바로 퀴즈에 쓰여요')),
        h('div', { class: 'form-row' }, h('label', null, '유사도 기준'), simInput, h('span', { class: 'muted' }, '관용 표현·속담이 이 정도 이상 비슷하면 정답 (0.5~1, 기본 0.85)')),
        h('div', { class: 'form-row' }, h('label', null, '카드 투표'), vote, h('span', { class: 'muted' }, '라이브 퀴즈의 카드 뽑기 투표 기본값'))),
      h('section', { class: 'card' }, h('h3', null, '방 관리'),
        h('button', { class: 'btn danger-ghost', type: 'button', onclick: deleteRoom }, '이 방 삭제')),
      h('details', { class: 'card dev', ontoggle: (e) => { if (e.target.open && !disposeTest) disposeTest = mountTestTools(testHolder, T); } },
        h('summary', null, '🔧 개발용 테스트 도구 (가짜 학생)'), testHolder));
  }

  async function deleteRoom() {
    const ok = await confirmDialog({ title: '이 방을 삭제할까요?', message: `‘${T.room.roomName}’(${T.code}) 방의 학생, 단어, 문제가 모두 사라져요. 되돌릴 수 없어요.`, okText: '삭제', danger: true });
    if (!ok) return;
    const progress = toast('삭제하는 중이에요… 잠시만 기다려 주세요.', 'info', { ms: 0 });
    try { await D.deleteRoomCascade(T.code); progress.close(); toast('방을 삭제했어요.', 'ok'); }
    catch (e) { progress.close(); handleError(e, { teacher: true }); }
  }

  return () => { off(); if (disposeTest) { disposeTest(); disposeTest = null; } };
}
