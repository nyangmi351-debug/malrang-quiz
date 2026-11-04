// js/teacher-students.js — 교사 [학생] 탭: 접속 현황, 모둠별 목록, 모둠 번호 수정, 개인 점수 순위(TV)·초기화

import { h, mount } from './core.js';
import { PRESENCE_WINDOW_MS } from './config.js';
import { GROUPS, groupBadge, toast, confirmDialog, handleError } from './ui.js';
import { toMs } from './text.js';
import * as D from './db.js';
import * as W from './words.js';

export function mountStudentsTab(box, T) {
  const monitorBox = h('section', { class: 'card' });
  const toolsBox = h('section', { class: 'card' });
  mount(box, toolsBox, monitorBox);
  let pendingRender = false;

  const render = () => { renderTools(); renderMonitor(); };
  const offs = [T.on('room', render), T.on('students', render)];
  const timer = setInterval(renderMonitor, 30000);   // "접속 중" 표시를 30초마다 새로 계산해요
  render();

  /** 개인 점수 순위 TV 표시와 점수 초기화 */
  function renderTools() {
    const mode = T.room.gameState.mode;
    const ranking = mode === 'ranking';
    const canRank = mode === 'idle' || ranking;
    mount(toolsBox,
      h('h3', null, '공부하기 점수'),
      h('div', { class: 'chips' },
        h('button', {
          class: `btn small ${ranking ? 'primary' : 'ghost'}`, type: 'button', disabled: !canRank,
          onclick: async () => { try { await T.games.setRanking(!ranking); } catch (e) { handleError(e, { teacher: true }); } }
        }, ranking ? '순위 TV에서 내리기' : '개인 점수 순위 TV에 띄우기'),
        h('button', {
          class: 'btn small danger-ghost', type: 'button',
          onclick: async () => {
            const ok = await confirmDialog({ title: '개인 점수를 모두 0으로 할까요?', message: '모든 학생의 공부하기 점수가 0점이 돼요.', okText: '초기화', danger: true });
            if (!ok) return;
            try { await W.resetStudyScores(T.code, T.students.map((s) => s.id)); toast('개인 점수를 초기화했어요.', 'ok'); }   // [쓰기] 학생 수만큼
            catch (e) { handleError(e, { teacher: true }); }
          }
        }, '개인 점수 초기화')),
      canRank ? null : h('p', { class: 'muted' }, '게임 중에는 순위를 띄울 수 없어요.'),
      ranking ? h('p', { class: 'muted' }, '발표 화면(TV)에 개인 점수 순위가 보이고 있어요. 학생 화면은 그대로예요.') : null);
  }

  function renderMonitor() {
    // 선생님이 모둠 드롭다운을 열어 둔 동안 화면이 새로 그려지면 닫혀 버려서, 잠시 미뤄요
    const active = document.activeElement;
    if (active && active.tagName === 'SELECT' && monitorBox.contains(active)) { pendingRender = true; return; }
    pendingRender = false;

    const groupCount = T.room.settings.groupCount;
    const inGame = T.room.gameState.mode !== 'idle' && T.room.gameState.mode !== 'ranking';
    const nowMs = D.now();
    const isOnline = (s) => nowMs - toMs(s.lastSeen) < PRESENCE_WINDOW_MS;
    const sorted = [...T.students].sort((a, b) => toMs(a.joinedAt) - toMs(b.joinedAt) || (a.id < b.id ? -1 : 1));
    const inRange = (s) => s.groupId >= 1 && s.groupId <= groupCount;
    const picked = sorted.filter(inRange).length;
    const gscores = T.games.groupScores();

    const columns = [];
    for (let g = 1; g <= groupCount; g++) columns.push({ g, list: sorted.filter((s) => s.groupId === g) });
    columns.push({ g: 0, list: sorted.filter((s) => !inRange(s)) });

    mount(monitorBox,
      h('h3', null, '학생 모니터링'),
      h('div', { class: 'chips' },
        h('span', { class: 'chip', dataset: { stat: 'total' } }, `전체 ${sorted.length}명`),
        h('span', { class: 'chip ok', dataset: { stat: 'online' } }, `접속 중 ${sorted.filter(isOnline).length}명`),
        h('span', { class: 'chip', dataset: { stat: 'picked' } }, `모둠 선택 완료 ${picked}/${sorted.length}`)),
      sorted.length === 0 ? h('p', { class: 'muted' }, '아직 들어온 학생이 없어요. 학생에게 방 코드를 알려 주세요.') : null,
      h('div', { class: 'group-grid' }, columns.map(({ g, list }) => {
        if (g === 0 && list.length === 0) return null;
        const gs = g && gscores ? gscores[g] : null;
        return h('div', { class: 'group-col' },
          h('div', { class: 'group-head' }, g === 0 ? h('span', { class: 'gbadge none' }, '모둠 미선택') : groupBadge(g),
            h('span', { class: 'muted' }, `${list.length}명${gs !== null && gs !== undefined ? ` · 게임 ${gs}점` : ''}`)),
          list.map((s) => tile(s, isOnline(s), groupCount, inGame)));
      })),
      inGame ? h('p', { class: 'muted' }, '참가자 확인·게임 중에는 학생의 모둠을 바꾸거나 퇴출할 수 없어요.') : null);
  }

  function tile(s, online, groupCount, inGame) {
    const sel = h('select', { class: 'input mini', 'aria-label': `${s.nickname}의 모둠`, disabled: inGame },
      h('option', { value: '' }, '모둠 선택 안 함'),
      Array.from({ length: groupCount }, (_, i) => h('option', { value: String(i + 1) }, `${i + 1}모둠 ${GROUPS[i + 1].icon}`)));
    sel.value = s.groupId >= 1 && s.groupId <= groupCount ? String(s.groupId) : '';
    sel.addEventListener('change', async () => {
      try { await D.setStudentGroup(T.code, s.id, sel.value ? Number(sel.value) : null); }   // [쓰기]
      catch (e) { handleError(e, { teacher: true }); }
      sel.blur();
      if (pendingRender) renderMonitor();
    });
    sel.addEventListener('blur', () => { if (pendingRender) setTimeout(renderMonitor, 0); });
    const kickBtn = h('button', {
      class: 'kick-btn', type: 'button', dataset: { act: 'kick', sid: s.id }, disabled: inGame,
      title: inGame ? '참가자 확인·게임 중에는 퇴출할 수 없어요' : '이 학생을 퇴출하고 자료를 모두 지워요', 'aria-label': `${s.nickname} 퇴출`,
      onclick: () => kick(s)
    }, '퇴출');
    return h('div', { class: `student-tile ${online ? 'online' : 'offline'}${s.isFake ? ' fake' : ''}` },
      h('span', { class: 'dot', title: online ? '접속 중' : '접속 안 함' }),
      h('span', { class: 'sname-row' }, h('span', { class: 'sname' }, s.nickname), kickBtn),
      h('span', { class: 'sscore muted' }, `${s.studyScore || 0}점`),
      sel);
  }

  /** 학생 퇴출(이름을 잘못 쓴 학생 등): 그 학생의 기록·낸 단어·낸 문제를 모두 완전히 지워요 */
  async function kick(s) {
    const w = s.wordCount || 0, q = s.questionCount || 0;
    const ok = await confirmDialog({
      title: `‘${s.nickname}’ 학생을 퇴출할까요?`,
      message: `이 학생의 자료가 모두 완전히 삭제돼요. 되돌릴 수 없어요.\n· 공부하기 점수 ${s.studyScore || 0}점\n· 낸 단어 ${w}개 (승인된 단어 포함)\n· 낸 문제 ${q}개 (승인된 문제 포함)\n선생님이 나눠 준 카드를 채웠다면, 그 카드는 빈 카드로 돌아가요.\n학생 화면은 입장 화면으로 돌아가고, 같은 이름으로 다시 들어오면 처음부터 시작해요.`,
      okText: '퇴출하기', danger: true
    });
    if (!ok) return;
    try {
      const r = await D.kickStudent(T.code, s.id);   // [읽기][삭제][쓰기] 학생 자료 수만큼
      if (!r.ok) {
        toast(r.reason === 'busy' ? '참가자 확인이나 게임이 진행 중이라 지금은 퇴출할 수 없어요. 끝난 뒤에 해 주세요.' : '방을 찾을 수 없어요.', 'warn');
        return;
      }
      // 번들(공부하기·게임에 쓰는 승인 목록)과 선생님 목록이 새로 정리되도록 알려요
      try {
        if (r.words || r.cards || r.approvedWords) await T.data.changed('words', { reload: true });   // [읽기] 목록을 새로 읽고 번들 저장을 예약
        if (r.questions || r.approvedQuestions) await T.data.changed('questions', { reload: true });   // [읽기]
        await T.data.sync.flushNow();   // [쓰기] 3초 기다리지 않고 바로 번들에 반영(퇴출한 학생의 자료가 번들에 남지 않게)
      } catch (e) { console.error('[퇴출 뒤 목록 갱신 오류]', e); }
      if (r.already) { toast('이미 방에 없는 학생이에요.', 'ok'); return; }
      const parts = [];
      if (r.words) parts.push(`단어 ${r.words}개`);
      if (r.questions) parts.push(`문제 ${r.questions}개`);
      if (r.cards) parts.push(`채운 카드 ${r.cards}장`);
      toast(`‘${r.nickname}’ 학생을 퇴출하고 자료를 모두 지웠어요${parts.length ? ` (${parts.join(', ')})` : ''}.`, 'ok');
      if (r.leftover) toast('일부 자료가 남았을 수 있어요. 단어·문제 탭에서 확인해 주세요.', 'warn');
    } catch (e) { handleError(e, { teacher: true }); }
  }

  return () => { offs.forEach((o) => o()); clearInterval(timer); };
}
