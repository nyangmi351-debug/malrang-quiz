// js/gamescreen.js — 학생 태블릿과 발표 화면(TV)이 함께 쓰는 "게임 화면 틀"
//   createGameScreen({ role:'student'|'present', code, getMe, getRoom }) → { el, update(room), destroy() }
//   게임 종류별 화면은 각 게임 파일(speed.js, live.js, tele.js)의 createView가 만들고,
//   여기서는 "구경만 하는 학생" 안내와 "최종 결과" 화면처럼 모든 게임이 같이 쓰는 부분만 맡아요.

import { h, mount } from './core.js';
import { mascot, playSound } from './ui.js';
import { finalView } from './results.js';
import { SPEED_GROUP, SPEED_ALL } from './speed.js';
import { LIVE } from './live.js';
import { TELE } from './tele.js';

const VIEWS = { speed_group: SPEED_GROUP, speed_all: SPEED_ALL, live: LIVE, tele: TELE };

export function createGameScreen({ role, code, getMe, getRoom }) {
  const el = h('div', { class: `game-frame ${role}` });
  let view = null, key = '', mode = '', finalShown = '';

  function destroyView() {
    if (view) { try { view.destroy(); } catch (e) { console.error(e); } view = null; }
  }

  function update(room) {
    const gs = room.gameState;
    const k = `${gs.mode}:${gs.gameId}`;
    if (k !== key) { destroyView(); key = k; mode = gs.mode; finalShown = ''; }

    if (gs.phase === 'final') {
      destroyView();
      const sig = `${k}:${gs.seq}`;
      if (finalShown !== sig) {
        finalShown = sig;
        const wrap = h('div', { class: 'final-wrap' }, finalView(gs.finalSummary),
          role === 'student' ? h('p', { class: 'muted center' }, '선생님이 결과를 닫으면 처음 화면으로 돌아가요.') : null);
        mount(el, wrap);
        playSound('fanfare');
      }
      return;
    }
    finalShown = '';

    if (role === 'student') {
      const me = getMe();
      const joined = gs.payload && Array.isArray(gs.payload.participants) && gs.payload.participants.includes(me.id);
      if (!joined) {
        destroyView();
        mount(el, h('div', { class: 'card center-col spectator' }, mascot(88, 'smile'),
          h('h2', null, '지금은 게임이 진행 중이에요'),
          h('p', { class: 'muted' }, '이번 게임은 시작할 때 화면이 켜져 있던 친구들이 함께해요. 끝나면 결과를 같이 볼 수 있어요.')));
        return;
      }
    }

    if (!view) {
      const def = VIEWS[mode];
      if (!def) { mount(el, h('p', { class: 'muted center' }, '알 수 없는 게임이에요. 화면을 새로고침해 주세요.')); return; }
      view = def.createView({ role, code, getMe, getRoom, gameKey: k });
      mount(el, view.el);
    }
    view.update(gs);
  }

  return { el, update, destroy: destroyView };
}
