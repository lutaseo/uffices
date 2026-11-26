# 작업 규칙 (Claude Code)

- 사용자에게 드리는 설명·안내는 모두 **한국어**로, 전문 용어는 풀어서 설명합니다.
- 변경 후에는 **커밋·푸시·PR 까지 자동으로** 진행합니다 (사용자 승인됨). PR 은 CI 통과 후 `main` 에 합칩니다.
- 비밀값(DB 주소·비밀번호·SESSION_SECRET)은 코드·커밋·채팅에 넣지 않습니다. `.env`(git 제외) 또는 Vercel 환경변수에만.

## 구조
- 업무 로직: `frontend/src/api/` — 브라우저(데모)와 서버가 **같은 코드**를 실행. 권한 검사는 반드시 여기서.
  - 저장/세션/암호화는 `runtime.js` 를 통해서만 사용 (브라우저 전용 API 직접 사용 금지)
  - 새 서비스 함수를 만들면 `server/handler.js` 의 `SERVICES`(및 읽기 전용이면 `READ_ONLY`)와 `frontend/src/api/remote.js` 의 `SERVICE_NAMES` 에 등록
  - 데이터 형태를 바꾸면 `seed.js` 의 `migrate()` 와 `SCHEMA_VERSION` 갱신
  - **새 기능은 반드시 업체별 기능 스위치를 함께 만듭니다.** `frontend/src/constants.js` 의 `FEATURES` 에 한 줄 추가(`on`: 기본 켜짐 여부 — 특정 업체 전용·시험 기능은 `false`), 화면은 `currentHasFeature(key)`(또는 `hasFeature(company, key)`)로 숨기고, 서버 함수는 `requireFeature(db, user, key)` 로 막습니다. 운영자(super)가 업체/계정관리 > [수정/연장] > '기능 켜기/끄기'에서 업체마다 켭니다. 서버 시험도 추가.
- 서버: `server/` (PostgreSQL, 쿠키 세션, scrypt), Vercel 입구 `api/rpc.js`

## 파일 지도 (찾을 때 여기부터)
업무 로직 `frontend/src/api/`
- `contracts.js` 계약 전체(등록·수정·입금·사진·AS·서명·알림톡 `notifications`·가져오기 `imports`·고객확인 `customerApp`) — 큰 파일이라 함수 이름으로 grep
- `services.js` 로그인 `auth`·업체 `companies`·직원 `users`·기사 `engineers`·팀·상품·아파트·수정로그 `auditLogs`(되돌리기)·상담내역 `callLogs`·매입 `purchases`·재고 `stocks`
- `schedule.js` 일정·휴무·박람회 `fairs`·기사모바일 `engineerApp` / `core.js` 세션·권한·`requireFeature` / `views.js` 화면용 계약 모양·변경이력
- `files.js` 회사 자료 백업 `companyFiles`(파일은 Supabase Storage, 목록은 업체 정보 `files`) / `photoCleanup.js` 6개월 지난 사진 정리(압축 파일 내려받기 → 지우기)
- `audit.js` 수정로그 문구·되돌리기 자료 / `numbering.js` 계약번호(계약일 순) / `seed.js` 데모 자료·`migrate()` / `sessionSlots.js` 탭별 로그인 칸
- `constants.js`(src 바로 아래) 브랜드·시공 구분·`FEATURES` 기능 스위치

서버 `server/`
- `handler.js` 요청 처리(호출 목록 `SERVICES`·`READ_ONLY`·`LIGHT_TABLES`·`FOCUS_CALLS`, 잠금·BUSY)
- `pg.js` DB 읽기/쓰기(`loadSnapshot`·`persistChanges`) / `photoStore.js` 사진 저장소 / `page.js` 업체 주소별 첫 화면·앱 정보(manifest·아이콘)
- `session.js` 쿠키 / `health.js` `/api/rpc` 점검 / `bizgo.js` 알림톡 발송

화면 `frontend/src/`
- `App.jsx` 메뉴·주소 연결 / `pages/ContractPage.jsx` 계약 목록 / `ContractDetail.jsx` 계약 상세 / `ContractEditor.jsx` 계약 등록·수정
- `pages/StatsPage.jsx` 통계(매출·매입·차액) / `PurchasePage.jsx` 매입관리 / `StockPage.jsx` 재고체크 (통계정보 하위, 기능 `purchases`·`stocks`)
- `pages/EngineerApp.jsx` 기사모바일 / `ConsultHome.jsx` 상담실장 / `CustomerApp.jsx` 고객확인 / `SignPage.jsx` 서명 / `AccountManagement.jsx` 운영자 업체·계정
- `pages/settings/` 설정 화면들(가져오기·사진 정리·회사 자료 백업·알림톡·계약조건·수정로그·기사/팀/상품/아파트) / `components/ScheduleManagement.jsx` 일정 달력
- `components/InstallCard.jsx` + `utils/install.js` 앱 설치 / `auth/AuthContext.jsx` 로그인 상태

시험 `tests/server.test.js`(서버 시험, `VB_VERIFY_FAST=1` 로 빠른 불러오기 비교) · `tests/load/run.mjs`(부하 시험)

## 확인 명령
```bash
npm run build                       # 화면 빌드
TEST_DATABASE_URL=... npm test      # 서버 시험 (시험 전용 DB, 실서비스 DB 거부)
LOAD_DATABASE_URL=... npm run loadtest  # 부하 시험: 150명 동시 사용·동시 저장 (빈 시험 DB, 실서비스 DB 거부)
```
CI(`.github/workflows/ci.yml`)가 PR 마다 빌드와 서버 시험을 실행합니다.
