// js/testmode.js — 개발용 테스트 모드 (가짜 학생)
//   교사 화면의 [설정] 탭 맨 아래 "🔧 개발용 테스트 도구"에서 열어요.
//   가짜 학생은 따로 화면이 없고, 가짜 학생이 해야 하는 모든 동작(접속 신호, 참가자 확인 응답, 게임 중 답 내기)을
//   "게임을 진행하는 교사 창"이 대신 해 줘요. 그래서 학생 태블릿이 없어도 혼자서 게임 전체를 시험해 볼 수 있어요.
//   ※ 가짜 학생이 만드는 읽기·쓰기도 무료 한도(하루 읽기 5만, 쓰기 2만)에 포함돼요.

import { h, mount, normalizeNickname } from './core.js';
import { HEARTBEAT_MS } from './config.js';
import { GROUPS, toast, handleError, confirmDialog } from './ui.js';
import * as D from './db.js';
import * as SpeedMod from './speed.js';
import * as LiveMod from './live.js';
import * as TeleMod from './tele.js';

const rand = (a, b) => a + Math.random() * (b - a);

export function createTestMode(T) {
  const state = { scale: 1, accuracy: 70, timers: new Set(), lastPing: '', done: new Set() };
  const fakes = () => T.students.filter((s) => s.isFake);

  function later(fn, ms) {
    const id = setTimeout(() => { state.timers.delete(id); try { fn(); } catch (e) { console.error('[테스트 모드]', e); } }, Math.max(0, ms * state.scale));
    state.timers.add(id);
    return id;
  }
  /** 같은 일을 두 번 하지 않게 해 주는 도장. 처음이면 true */
  function once(key) { if (state.done.has(key)) return false; state.done.add(key); if (state.done.size > 2000) state.done.clear(); return true; }

  async function touchAll(extra = {}) {
    const list = fakes();
    if (!list.length) return;
    await D.batchEach(list, (b, s) => b.update(D.studentRef(T.code, s.id), { lastSeen: D.serverTimestamp(), ...extra }));   // [쓰기] 가짜 학생 수만큼
  }

  // 5분마다 "접속 중" 신호를 대신 보내요
  const beat = setInterval(() => { touchAll().catch(() => {}); }, HEARTBEAT_MS);

  const api = {
    T, state, rand, later, once, fakes,
    get scale() { return state.scale; },
    get accuracy() { return state.accuracy; },

    /** 방 문서의 게임 상태가 바뀔 때마다 교사 화면이 불러 줘요 */
    onGameState(gs, host) {
      if (!fakes().length) return;
      if (gs.driverId !== T.tabId) return;   // 가짜 학생은 진행 중인 교사 창 하나만 대신해요
      if (gs.mode === 'confirm') {
        const pingId = gs.payload && gs.payload.pingId;
        if (pingId && state.lastPing !== pingId) {
          state.lastPing = pingId;
          later(() => touchAll({ pingId }).catch((e) => handleError(e, { teacher: true })), rand(500, 2500));
        }
        return;
      }
      if (gs.mode === 'live' && LiveMod.fakeLive) LiveMod.fakeLive(api, gs, host);
      if (gs.mode === 'tele' && TeleMod.fakeTele) TeleMod.fakeTele(api, gs, host);
    },

    /** 스피드 퀴즈 진행 문서가 바뀔 때(스피드 퀴즈 진행자가 불러 줘요) */
    onSpeedDocs(docs, gs) {
      const fakeIds = new Set(fakes().map((s) => s.id));
      if (!fakeIds.size || gs.driverId !== T.tabId) return;
      const code = T.code;
      for (const [key, d] of Object.entries(docs)) {
        if (d.finished) continue;
        const members = SpeedMod.membersOf(gs.payload, key);
        const eid = SpeedMod.explainerOf(gs.payload, key, d);
        if (!members.length) continue;
        const ctx = SpeedMod.speedCtx(gs, key, d);
        const stamp = `${gs.gameId}:${key}:${d.step}`;
        if (fakeIds.has(eid)) {   // 설명자가 가짜 → 잠시 뒤 패스
          if (once(`sp-pass:${stamp}`)) later(() => SpeedMod.speedPass(code, ctx, d.step).catch((e) => handleError(e, { teacher: true })), rand(2500, 5000));
        } else if (members.some((m) => fakeIds.has(m) && m !== eid)) {   // 맞히는 가짜가 있으면 → 잠시 뒤 정답
          if (once(`sp-ans:${stamp}`)) later(() => SpeedMod.speedAnswer(code, ctx, d.step).catch((e) => handleError(e, { teacher: true })), rand(3000, 7000));
        }
      }
    },

    dispose() { clearInterval(beat); state.timers.forEach(clearTimeout); state.timers.clear(); }
  };
  return api;
}

/* ═════════ 화면: [설정] 탭 안의 테스트 도구 ═════════ */
export function mountTestTools(box, T) {
  const test = T.test;
  const countEl = h('strong', { dataset: { stat: 'fake-count' } });
  const num = h('input', { type: 'number', min: '1', max: '40', value: '12', dataset: { field: 'fake-n' }, 'aria-label': '만들 가짜 학생 수' });
  const dist = h('select', { dataset: { field: 'fake-dist' } },
    h('option', { value: 'even' }, '모둠에 골고루'),
    h('option', { value: 'none' }, '모둠 선택 안 함'),
    h('option', { value: 'first' }, '1모둠에 모두'));
  const speed = h('select', { dataset: { field: 'fake-speed' }, onchange: () => { test.state.scale = Number(speed.value); } },
    h('option', { value: '1' }, '가짜 학생 속도: 보통'), h('option', { value: '0.3' }, '빠르게 (시험용)'));
  const acc = h('input', { type: 'number', min: '0', max: '100', value: String(test.state.accuracy), dataset: { field: 'fake-acc' }, onchange: () => { test.state.accuracy = Math.max(0, Math.min(100, Number(acc.value) || 0)); } });
  const makeBtn = h('button', { class: 'btn small primary', type: 'button', dataset: { act: 'fake-make' }, onclick: make }, '가짜 학생 만들기');
  const delBtn = h('button', { class: 'btn small danger-ghost', type: 'button', dataset: { act: 'fake-del' }, onclick: removeAll }, '가짜 학생 모두 삭제');

  function refresh() { countEl.textContent = `${test.fakes().length}명`; }
  const off = T.on('students', refresh);

  async function make() {
    const n = Math.max(1, Math.min(40, Math.floor(Number(num.value) || 0)));
    makeBtn.disabled = true;
    try {
      const groupCount = T.room.settings.groupCount;
      const used = new Set(T.students.map((s) => s.id));
      const list = [];
      for (let i = 1; list.length < n && i < 500; i++) {
        const nick = `테스트${i}`;
        if (!used.has(normalizeNickname(nick))) list.push(nick);
      }
      await D.batchEach(list.map((nick, i) => ({ nick, i })), (b, { nick, i }) => {   // [쓰기] n건
        let groupId = null;
        if (dist.value === 'even') groupId = (i % groupCount) + 1;
        else if (dist.value === 'first') groupId = 1;
        b.set(D.studentRef(T.code, normalizeNickname(nick)), {
          nickname: nick, groupId, studyScore: 0, wordCount: 0, questionCount: 0, isFake: true,
          joinedAt: D.serverTimestamp(), lastSeen: D.serverTimestamp(), pingId: ''
        });
      });
      toast(`가짜 학생 ${list.length}명을 만들었어요.`, 'ok');
    } catch (e) { handleError(e, { teacher: true }); }
    makeBtn.disabled = false;
  }

  async function removeAll() {
    const list = test.fakes();
    if (!list.length) { toast('지울 가짜 학생이 없어요.', 'info'); return; }
    const ok = await confirmDialog({ title: '가짜 학생을 모두 지울까요?', message: `${list.length}명이 사라져요. 진짜 학생은 그대로예요.`, okText: '삭제', danger: true });
    if (!ok) return;
    try {
      await D.batchEach(list, (b, s) => b.delete(D.studentRef(T.code, s.id)));   // [삭제]
      toast('가짜 학생을 모두 지웠어요.', 'ok');
    } catch (e) { handleError(e, { teacher: true }); }
  }

  mount(box,
    h('p', { class: 'msg warn' }, '⚠️ 가짜 학생이 만드는 읽기·쓰기도 무료 한도(하루 읽기 5만, 쓰기 2만)에 포함돼요. 시험이 끝나면 꼭 지워 주세요.'),
    h('p', null, '지금까지 만든 가짜 학생: ', countEl),
    h('div', { class: 'form-row' }, h('label', null, '인원 ', num), h('label', null, '모둠 ', dist), makeBtn, delBtn),
    h('div', { class: 'form-row' }, speed, h('label', null, '라이브 퀴즈 정답률(%) ', acc)),
    h('p', { class: 'muted' }, `모둠 ${GROUPS.slice(1, T.room.settings.groupCount + 1).map((g) => g.icon).join(' ')} · 게임 중에 가짜 학생은 이 교사 창이 대신 움직여요. 게임을 진행하는 창을 닫지 마세요.`));
  refresh();
  return () => off();
}
