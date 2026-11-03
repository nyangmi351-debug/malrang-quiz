// js/results.js — 결과 화면 부품 (발표 화면 TV와 학생 태블릿이 같은 부품을 써요: 3-8)
//   점수판(모둠 순위), 게임 종료 결과, 공부하기 개인 순위, 텔레스트레이션 체인 한 페이지

import { h } from './core.js';
import { GROUPS, groupBadge, mascot, showModal } from './ui.js';
import { toMs } from './text.js';

const MEDAL = ['🥇', '🥈', '🥉'];

/* ═════════ 1. 모둠 점수판 ═════════ */
/** entries: [{ g, score }] 높은 점수 순. 동점은 같은 등수로 보여요. */
export function scoreboard(entries, { title = '모둠 점수 순위' } = {}) {
  const max = Math.max(1, ...entries.map((e) => e.score));
  let rank = 0, prev = null;
  const rows = entries.map((e, i) => {
    if (e.score !== prev) { rank = i + 1; prev = e.score; }
    const g = GROUPS[e.g];
    return h('div', { class: 'sb-row', dataset: { group: String(e.g) } },
      h('span', { class: 'sb-rank' }, rank <= 3 ? MEDAL[rank - 1] : `${rank}`),
      h('span', { class: 'sb-name' }, groupBadge(e.g)),
      h('span', { class: 'sb-bar' }, h('span', { class: 'sb-fill', style: { width: `${Math.max(4, (e.score / max) * 100)}%`, background: g ? g.color : '#999' } })),
      h('strong', { class: 'sb-score' }, `${e.score}점`));
  });
  return h('div', { class: 'scoreboard' }, title ? h('h3', null, title) : null, rows);
}

/* ═════════ 2. 게임 종료 결과 ═════════ */
function solvedLists(solved, groupNums) {
  return h('div', { class: 'solved-grid' }, groupNums.map((g) => {
    const list = (solved && (solved[g] || solved[`g${g}`])) || [];
    return h('div', { class: 'solved-col' }, groupBadge(g), h('p', { class: 'muted' }, `맞힌 말 ${list.length}개`),
      list.length ? h('div', { class: 'chips' }, list.map((w) => h('span', { class: 'chip' }, w))) : h('p', { class: 'muted' }, '없어요'));
  }));
}

/**
 * 게임 종료 결과. summary 모양:
 *  speed_group/tele : { mode, groups:[번호..], groupScores:{1:n}, solved:{1:[..]}, total, plays? }
 *  speed_all        : { mode, total, solved:[..] }
 *  live             : { mode, total, results:[{ prompt, label, correct, total, effect, delta }] }
 */
export function finalView(summary, { title } = {}) {
  const wrap = h('div', { class: 'final-view' }, mascot(96, 'wow'), h('h2', null, title || '게임 끝!'));
  if (!summary) { wrap.append(h('p', { class: 'muted' }, '결과를 불러오는 중이에요…')); return wrap; }
  if (summary.mode === 'speed_all') {
    wrap.append(h('div', { class: 'total-big' }, h('span', null, '우리 반 총점'), h('strong', { dataset: { stat: 'total' } }, `${summary.total || 0}점`)),
      h('h3', null, '맞힌 말'), (summary.solved || []).length ? h('div', { class: 'chips' }, summary.solved.map((w) => h('span', { class: 'chip' }, w))) : h('p', { class: 'muted' }, '아쉽게도 맞힌 말이 없어요'));
  } else if (summary.mode === 'live') {
    wrap.append(h('div', { class: 'total-big' }, h('span', null, '우리 반 최종 점수'), h('strong', { dataset: { stat: 'total' } }, `${summary.total || 0}점`)),
      h('div', { class: 'live-table' }, (summary.results || []).map((r, i) => h('div', { class: 'live-row' },
        h('span', { class: 'sb-rank' }, `${i + 1}`), h('span', { class: 'lr-q' }, r.prompt || '(그림 문제)'), h('span', { class: 'muted' }, `정답: ${r.label}`),
        h('span', { class: 'chip' }, `${r.correct}/${r.total}명`), h('span', { class: 'chip' }, r.effect || '카드 없음'), h('strong', null, `${r.delta >= 0 ? '+' : ''}${r.delta}점`)))));
  } else {
    const groups = summary.groups || [];
    const entries = groups.map((g) => ({ g, score: (summary.groupScores && (summary.groupScores[g] ?? summary.groupScores[`g${g}`])) || 0 })).sort((a, b) => b.score - a.score || a.g - b.g);
    wrap.append(scoreboard(entries), h('div', { class: 'total-big' }, h('span', null, '전체 총점'), h('strong', { dataset: { stat: 'total' } }, `${summary.total || 0}점`)),
      h('h3', null, summary.mode === 'tele' ? '모둠별 맞힌 제시어' : '모둠별 맞힌 말'), solvedLists(summary.solved, groups));
  }
  return wrap;
}

/* ═════════ 3. 공부하기 개인 점수 순위 (TV) ═════════ */
export function studyRanking(students) {
  const list = [...students].filter((s) => !s.isFake || true)
    .sort((a, b) => (b.studyScore || 0) - (a.studyScore || 0) || toMs(a.joinedAt) - toMs(b.joinedAt));
  let rank = 0, prev = null;
  const rows = list.map((s, i) => {
    if ((s.studyScore || 0) !== prev) { rank = i + 1; prev = s.studyScore || 0; }
    return h('div', { class: `rank-row r${Math.min(rank, 4)}` },
      h('span', { class: 'sb-rank' }, rank <= 3 ? MEDAL[rank - 1] : `${rank}`),
      h('span', { class: 'rank-name' }, s.nickname),
      s.groupId ? groupBadge(s.groupId, { compact: true }) : null,
      h('strong', null, `${s.studyScore || 0}점`));
  });
  return h('div', { class: 'study-ranking' }, h('h2', null, '공부하기 개인 점수 순위'), list.length ? h('div', { class: 'rank-grid' }, rows) : h('p', { class: 'muted' }, '아직 학생이 없어요'));
}

/* ═════════ 4. 텔레스트레이션 체인 한 페이지 ═════════ */
/** 그림을 크게 보여 줘요 */
export function zoomImage(src) {
  const modal = showModal(h('div', { class: 'center-col' }, h('img', { class: 'zoom-img', src, alt: '확대한 그림' }),
    h('button', { class: 'btn primary', type: 'button', onclick: () => modal.close() }, '닫기')), { wide: true });
}

/**
 * chain: { word, steps:[{ r, type:'draw'|'text', data, by, locked }], final, correct }
 * 단계 수 L에 맞춰 줄·칸 수를 계산해서, 아무리 길어도 한 화면에 들어가게 해요.
 */
export function chainPage(chain, { label = '' } = {}) {
  const steps = [...chain.steps].sort((a, b) => a.r - b.r);
  const L = steps.length;
  const rows = L <= 6 ? 1 : Math.ceil(L / 6);
  const cols = Math.ceil(L / rows);
  const cells = steps.map((s) => {
    const who = h('span', { class: 'step-by' }, `${s.r}단계 · ${s.by || ''}${s.locked ? ' (시간 초과)' : ''}`);
    if (s.type === 'draw') {
      const body = s.data
        ? h('img', { class: 'step-img', src: s.data, alt: `${s.r}단계 그림`, onclick: () => zoomImage(s.data) })
        : h('div', { class: 'step-img blank' }, '그리지 못했어요');
      return h('div', { class: 'step draw' }, who, body);
    }
    return h('div', { class: 'step text' }, who, h('div', { class: 'bubble' }, s.data || '(작성 안 함)'));
  });
  return h('div', { class: 'chain-page' },
    h('div', { class: 'chain-head' }, label ? h('span', { class: 'muted' }, label) : null,
      h('h2', null, '제시어: ', h('span', { class: 'chain-word' }, chain.word)),
      h('span', { class: `verdict ${chain.correct ? 'ok' : 'bad'}`, dataset: { verdict: chain.correct ? 'ok' : 'bad' } }, chain.correct ? `정답! “${chain.final || ''}”` : `오답 “${chain.final || '(없음)'}”`)),
    h('div', { class: 'chain-grid', style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` } }, cells));
}
