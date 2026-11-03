// js/config.js — 설정 파일 (따로 채울 값은 없어요. 완성본입니다)
// 교사 PIN을 바꾸고 싶으면 아래 TEACHER_PIN 한 줄의 숫자 4개만 바꾸면 돼요.

export const TEACHER_PIN = '0000';   // 기본값. 공개 저장소라 보안용이 아니라 학생의 실수 입장 방지용이에요
export const APP_VERSION = 'v1-step1';   // 화면 맨 아래에 작게 보여요(배포 확인용). 단계마다 바뀌어요

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
export const ROOM_LIST_LIMIT = 20;                  // 방 목록에 한 번에 보여 줄 개수
export const IMAGE_PRELOAD_TIMEOUT_MS = 5000;
export const LIMITS = { nickname: 10, word: 30, meaning: 200, example: 200, question: 200, choice: 80, imageUrl: 500 };
export const TIMES = {
  teleDrawSec: 30, teleTextSec: 20,   // 텔레스트레이션 기본 시간(교사가 시작 때 선택)
  liveVoteSec: 5, liveRevealSec: 3, liveGraceMs: 1500,   // 라이브 퀴즈: 투표, 정답 공개 대기, 마감 후 응답 대기
  teleGraceMs: 2000, passCooldownMs: 2000,
  pingWaitSec: 10, bundleDebounceMs: 3000, bundleSplitBytes: 800000,
  resyncHiddenMs: 30 * 60 * 1000, beaconMs: 3000, beaconLostMs: 6000
};
