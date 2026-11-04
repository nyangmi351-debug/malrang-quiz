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
      inGame ? h('p', { class: 'muted' }, '참가자 확인·게임 중에는 학생의 모둠을 바꾸거나 내보낼 수 없어요.') : null);
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
      title: inGame ? '참가자 확인·게임 중에는 내보낼 수 없어요' : '이 학생을 방에서 내보내요', 'aria-label': `${s.nickname} 내보내기`,
      onclick: () => kick(s)
    }, '내보내기');
    return h('div', { class: `student-tile ${online ? 'online' : 'offline'}${s.isFake ? ' fake' : ''}` },
      h('span', { class: 'dot', title: online ? '접속 중' : '접속 안 함' }),
      h('span', { class: 'sname' }, s.nickname),
      h('span', { class: 'sscore muted' }, `${s.studyScore || 0}점`),
      sel, kickBtn);
  }

  /** 학생 내보내기(이름을 잘못 쓴 학생 등): 학생 기록만 지우고, 낸 단어·문제는 그대로 둬요 */
  async function kick(s) {
    const ok = await confirmDialog({
      title: `‘${s.nickname}’ 학생을 내보낼까요?`,
      message: `이 학생의 접속 기록과 공부하기 점수(${s.studyScore || 0}점)가 사라져요.\n이 학생이 낸 단어와 문제는 그대로 남아요.\n학생 화면은 입장 화면으로 돌아가고, 올바른 이름으로 다시 들어올 수 있어요.`,
      okText: '내보내기', danger: true
    });
    if (!ok) return;
    try {
      const r = await D.kickStudent(T.code, s.id);   // [읽기][삭제][쓰기]
      if (!r.ok) {
        toast(r.reason === 'busy' ? '참가자 확인이나 게임이 진행 중이라 지금은 내보낼 수 없어요. 끝난 뒤에 해 주세요.' : '방을 찾을 수 없어요.', 'warn');
        return;
      }
      toast(r.already ? '이미 방에 없는 학생이에요.' : `‘${r.nickname}’ 학생을 내보냈어요.`, 'ok');
      try { await D.releaseAssignedCards(T.code, s.id); } catch (e) { console.error('[배정 카드 되돌리기 오류]', e); }   // [읽기][쓰기] 비어 있는 배정 카드만 담당자 없음으로
    } catch (e) { handleError(e, { teacher: true }); }
  }

  return () => { offs.forEach((o) => o()); clearInterval(timer); };
}
