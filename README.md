# 말랑말랑 퀴즈 놀이터

교실에서 쓰는 국어 어휘(단어·관용 표현·속담) 퀴즈 웹앱이에요. 선생님은 방을 만들고, 학생은 태블릿으로 방 코드/QR로 들어와 단어를 내고, 공부하고, 함께 게임해요.

- 공부하기(자동 퀴즈) · 단어 카드(플래시카드) · 학생 단어 카드 엑셀(.xlsx) 내려받기
- 라이브 퀴즈(카드 뽑기 투표 · TV 정답자 게이지와 이름 목록) · 전체 스피드 퀴즈 · 모둠 스피드 퀴즈 · 텔레스트레이션
- 학생 퇴출: [학생] 탭의 이름 옆 [퇴출] 버튼 → 그 학생의 점수·단어·문제가 모두 완전히 삭제돼요
- 발표 화면(TV): `주소#present/방코드`
- 선생님 사용법: [guide.html](./guide.html)

## 파일 구성 (모두 같은 위치에 올려야 해요)

```
index.html      앱의 시작 화면
style.css       기본 디자인
games.css       게임 화면 디자인
guide.html      선생님 안내서
version.json    버전 확인용 작은 파일 (index.html이 예전 것인지 알아내는 데 써요)
js/             프로그램 파일 33개
```

## 기술

- 순수 HTML/CSS/JavaScript (빌드 과정 없음), Firebase Firestore (무료 Spark 요금제)
- GitHub Pages로 그대로 공개할 수 있어요.

## 새 버전을 올릴 때

1. 압축을 푼 **파일과 폴더 전부**(index.html, style.css, games.css, guide.html, version.json, README.md, js 폴더)를 GitHub에 올려요.
2. 1~2분 기다린 뒤 **Ctrl+Shift+R**(맥은 ⌘+Shift+R)로 새로고침해요.
3. 방 화면 맨 위(“PIN … · v2.5-final”)와 화면 맨 아래에 같은 버전이 보이면 제대로 올라간 거예요.

index.html이 js 파일 이름 뒤에 `?v=버전`을 붙여서 불러와요. 그래서 새 버전을 올리면 브라우저가 기억해 둔 예전 js 파일을 다시 쓰지 않아요.
(버전을 올려서 직접 고칠 때는 index.html의 `BUILD`·`FILES`·css의 `?v=`, `js/config.js`의 `APP_VERSION`, `version.json`을 함께 바꿔야 해요.)

## 알아 둘 점

- 로그인이 없어요. Firestore 규칙이 열려 있어서, 방 코드와 앱 주소를 학급 밖에 알리지 마세요.
- `js/config.js`의 Firebase 설정값(apiKey 등)은 웹앱에서는 공개되어도 정상인 값이에요.
