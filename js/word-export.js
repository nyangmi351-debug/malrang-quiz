// js/word-export.js — 학생들이 만든 단어 카드 목록을 엑셀 표로 내려받기 (교사용)
// 새로 읽어 오는 것은 없어요. 교사 화면이 이미 들고 있는 단어 목록·학생 목록으로 표를 만들어요 → 읽기 0건.

import { TYPE_LABEL, toMs } from './text.js';
import { buildXlsx, downloadBytes } from './xlsx-lite.js';

const STATUS_TEXT = { assigned: '작성 전', pending: '검수 대기', approved: '승인됨' };
const pad = (n) => String(n).padStart(2, '0');
export const fmtDateTime = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const COLUMNS = [
  { header: '번호', width: 6 }, { header: '모둠', width: 10 }, { header: '만든 학생', width: 12 }, { header: '단어', width: 16 },
  { header: '유형', width: 10 }, { header: '뜻', width: 40 }, { header: '예문', width: 40 }, { header: '그림 주소', width: 36 },
  { header: '상태', width: 10 }, { header: '출처', width: 12 }, { header: '최근 수정', width: 17 }
];

/** 엑셀에 담을 카드: 뜻이 적힌 카드만(교사가 올려 두고 아직 아무도 안 쓴 "작성 전" 카드는 빼요) */
export function exportableWords(words) { return (words || []).filter((w) => w && String(w.meaning || '').trim()); }

/** 단어 목록 + 학생 목록 → 표의 줄들 (모둠 → 학생 이름 → 단어 순서) */
export function buildWordRows(words, students) {
  const byId = new Map((students || []).map((s) => [s.id, s]));
  const list = exportableWords(words).map((w) => {
    const owner = byId.get(w.assignedTo);
    const nick = owner ? owner.nickname : (w.origin === 'student' ? (w.createdBy || '') : '');
    const groupId = owner ? owner.groupId || 0 : 0;
    return { w, nick, groupId };
  });
  list.sort((a, b) => ((a.groupId || 99) - (b.groupId || 99)) || (a.nick < b.nick ? -1 : a.nick > b.nick ? 1 : 0) || (a.w.word < b.w.word ? -1 : 1));
  return list.map(({ w, nick, groupId }, i) => [
    i + 1, groupId ? `${groupId}모둠` : '모둠 미선택', nick || '(담당자 없음)', w.word, TYPE_LABEL[w.type] || w.type || '',
    w.meaning || '', w.example || '', w.imageUrl || '', STATUS_TEXT[w.status] || w.status || '',
    w.origin === 'teacher' ? '교사가 올린 카드' : '학생이 직접 냄', fmtDateTime(toMs(w.updatedAt))
  ]);
}

export function exportFileName(roomName, now = new Date()) {
  const room = String(roomName || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 30);
  return `단어카드${room ? '_' + room : ''}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.xlsx`;
}

/** 엑셀 파일을 만들어 내려받아요. 내려받은 카드 수를 돌려줘요. */
export function downloadWordsXlsx({ words, students, roomName }) {
  const rows = buildWordRows(words, students);
  const bytes = buildXlsx({ sheetName: '단어 카드', columns: COLUMNS, rows });
  downloadBytes(bytes, exportFileName(roomName));
  return rows.length;
}
