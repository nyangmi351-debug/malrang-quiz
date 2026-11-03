// js/teacher-data.js — 교사 화면이 들고 있는 단어·문제 목록(메모리)과 번들 자동 동기화
// 단어 목록은 검수 화면을 볼 때만 "실시간 듣기"를 켜고, 그 밖에는 한 번만 읽어요(읽기 절약).

import * as D from './db.js';
import * as W from './words.js';
import { createBundleSync, approvedItems } from './packs.js';

export function createTeacherData(T) {
  const lists = { words: null, questions: null };
  const owners = { words: new Set(), questions: new Set() };
  const unsub = { words: null, questions: null };
  const lastSig = { words: null, questions: null };
  const subs = new Set();
  let syncStatus = 'idle';

  const notify = (kind) => subs.forEach((fn) => fn(kind));
  const sync = createBundleSync({
    code: T.code,
    getList: (kind) => lists[kind],
    getParts: (kind) => (T.room && T.room.packMeta && T.room.packMeta[kind] ? T.room.packMeta[kind].parts : 0),
    onStatus: (s) => { syncStatus = s; notify('sync'); }
  });

  const signature = (kind) => JSON.stringify(approvedItems(kind, lists[kind] || []));

  /** 목록을 한 번만 읽어 와요(이미 있으면 그대로 돌려줘요) */
  async function ensure(kind) {
    if (lists[kind]) return lists[kind];
    lists[kind] = kind === 'words' ? await W.fetchAllWords(T.code) : await W.fetchAllQuestions(T.code);   // [읽기]
    lastSig[kind] = signature(kind);
    notify(kind);
    return lists[kind];
  }

  /** 실시간 듣기를 켜요. owner(켠 주체)가 모두 놓으면 자동으로 꺼져요. */
  function watch(kind, owner) {
    owners[kind].add(owner);
    if (!unsub[kind]) {
      const col = kind === 'words' ? D.wordsCol(T.code) : D.questionsCol(T.code);
      let first = true;
      unsub[kind] = D.onSnapshot(col, (snap) => {   // [읽기] 처음 전체 + 바뀐 것만큼
        lists[kind] = snap.docs.map((d) => (kind === 'words' ? { key: d.id, ...d.data() } : { id: d.id, ...d.data() }));
        const sig = signature(kind);
        // 학생이 바꾼 문제(자동 승인·수정·삭제)가 번들에 반영되도록, 승인 목록이 달라졌으면 저장을 예약해요
        if (kind === 'questions' && (first || sig !== lastSig[kind])) sync.schedule('questions');
        lastSig[kind] = sig;
        first = false;
        notify(kind);
      }, (e) => { import('./ui.js').then((u) => u.handleError(e, { teacher: true })); });
    }
    return () => release(kind, owner);
  }
  function release(kind, owner) {
    owners[kind].delete(owner);
    if (!owners[kind].size && unsub[kind]) { unsub[kind](); unsub[kind] = null; }
  }

  /** 교사가 직접 바꾼 뒤 부르는 함수: 메모리 목록을 고치고(구독이 없을 때) 번들 저장을 예약해요 */
  function changed(kind, { reload = false } = {}) {
    if (reload || !unsub[kind]) {
      return (kind === 'words' ? W.fetchAllWords(T.code) : W.fetchAllQuestions(T.code)).then((l) => {   // [읽기]
        lists[kind] = l; notify(kind); sync.schedule(kind);
      });
    }
    sync.schedule(kind);
    return Promise.resolve();
  }

  /** 게임을 시작하기 전에: 저장 대기 중인 번들을 지금 저장해요 */
  async function flushBeforeGame() {
    if (owners.questions.size === 0 && T.room.settings.autoApproveQuestions) {
      watch('questions', 'flush');
      await ensure('questions');
      sync.schedule('questions');
    }
    await sync.flushNow();
    release('questions', 'flush');
  }

  const onHide = () => sync.flushNow();
  const onVis = () => { if (document.visibilityState === 'hidden') sync.flushNow(); };
  function dispose() {
    ['words', 'questions'].forEach((k) => { if (unsub[k]) { unsub[k](); unsub[k] = null; } owners[k].clear(); });
    sync.flushNow();
    subs.clear();
    window.removeEventListener('pagehide', onHide);
    document.removeEventListener('visibilitychange', onVis);
  }
  window.addEventListener('pagehide', onHide);
  document.addEventListener('visibilitychange', onVis);

  return {
    get: (kind) => lists[kind], ensure, watch, release, changed, sync, flushBeforeGame, dispose,
    on: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    get syncStatus() { return syncStatus; }
  };
}
