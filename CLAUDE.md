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

## 확인 명령
```bash
npm run build                       # 화면 빌드
TEST_DATABASE_URL=... npm test      # 서버 시험 (시험 전용 DB, 실서비스 DB 거부)
```
CI(`.github/workflows/ci.yml`)가 PR 마다 빌드와 서버 시험을 실행합니다.
