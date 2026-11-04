// js/config.js — 설정 파일 (따로 채울 값은 없어요. 완성본입니다)
// 교사 PIN은 이제 코드에 적어 두지 않아요. 선생님마다 앱 화면에서 직접 [새 PIN 만들기]로 만들어요.

export const APP_VERSION = 'v2.5-final';   // 화면 맨 아래에 작게 보여요(배포 확인용). 업로드가 제대로 됐는지 확인할 때 써요

export const firebaseConfig = {
  apiKey: 'AIzaSyC-AJ4-A-mJvK8eOIEzfSLUJOMTRoGw35Q',
  authDomain: 'malrang-quiz.firebaseapp.com',
  projectId: 'malrang-quiz',
  storageBucket: 'malrang-quiz.firebasestorage.app',
  messagingSenderId: '181179028783',
  appId: '1:181179028783:web:97554373661aacc2dcbdda',
  measurementId: 'G-VVKDL9W830'   // Analytics SDK는 불러오지 않아요
};

// 시간·한도 상수
export const HEARTBEAT_MS = 5 * 60 * 1000;          // 학생이 "나 접속 중이에요" 신호를 보내는 간격
export const PRESENCE_WINDOW_MS = 7 * 60 * 1000;    // 이 시간 안에 신호가 있으면 "접속 중"
export const ROOM_LIST_LIMIT = 20;                  // 방 목록에 한 번에 보여 줄 개수([더 보기]로 더 보여 줘요)
export const STUDY_FLUSH_EVERY = 5;                 // 공부하기 점수를 5문제마다 한 번에 저장해요
export const IMAGE_PRELOAD_TIMEOUT_MS = 5000;
export const LIMITS = { nickname: 10, word: 30, meaning: 200, example: 200, question: 200, choice: 80, imageUrl: 500 };
export const TIMES = {
  teleDrawSec: 30, teleTextSec: 20,   // 텔레스트레이션 기본 시간(교사가 시작 때 선택)
  liveVoteSec: 5, liveRevealSec: 3, liveGraceMs: 1500,   // 라이브 퀴즈: 투표, 정답 공개 대기, 마감 후 응답 대기
  teleGraceMs: 2000, passCooldownMs: 2000,
  pingWaitSec: 10, bundleDebounceMs: 3000, bundleSplitBytes: 800000,
  resyncHiddenMs: 30 * 60 * 1000, beaconMs: 3000, beaconLostMs: 6000
};
