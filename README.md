# VerityBase — 전자계약 · 시공일정 관리

[![CI](https://github.com/lutaseo/uffices/actions/workflows/ci.yml/badge.svg)](https://github.com/lutaseo/uffices/actions/workflows/ci.yml)

인테리어 시공(줄눈·청소·탄성·새집증후군·나노코팅) 업체를 위한 **전자계약 + 시공일정 관리** 서비스입니다.
여러 업체가 함께 쓰는 구조로, 운영자(우리)가 업체에 계정을 발급하고 업체 관리자가 직원(실장)에게 권한을 나눠 줍니다.

- 실서비스: https://veritybase.vercel.app
- 배포·서버 연결 안내: [docs/DEPLOY.md](docs/DEPLOY.md)
- 점검 결과·설계·남은 작업: [docs/REVIEW.md](docs/REVIEW.md)

---

## 주요 기능

| 메뉴 | 기능 |
|---|---|
| **계약관리** | 계약일·시공예정일·완료일·취소일·입주예정일 **기간검색**, 필터, 금액 합계(매출취소·환불 포함), 휴지통, 엑셀 다운로드. 번호는 **계약일 순서**(최신 = 전체 건수), 목록은 번호순 |
| **계약 상세** | 목록 줄을 누르면 이동. 같은 계약자·현장의 시공을 한 화면에서: 기본정보 · 시공정보 · 상세시공(시공등록, 알림톡) · 시공별 계약금액 · 입금(입금/환불 등록·수정) · 진행상황, 탭(계약정보·계약자·시공관리·상담내역) |
| **계약서 작성** | 계약정보 → 시공정보(시공예정일 ①②③, 기사배정/팀배정) → 시공상태 → 상품·금액·입금 → 해피콜 → **변경이력** |
| **전자계약** | 고객에게 서명 링크 발송 → 고객이 휴대폰에서 계약서 확인 후 손서명 (IP·기기 정보 기록) |
| **계약승인** | 실장이 등록한 계약은 '승인대기' → 승인 권한자가 승인/미승인 |
| **일정관리** | 달력에 기사별 일정·**휴무(오전/오후/종일)** 표시, 휴무 시간대 배정 자동 차단 |
| **기사모바일** | 기사가 휴대폰으로 내 일정 확인, 시공상태 보고, 본인 휴무 등록 |
| **계약자관리** | 계약자 등록/수정, 연락처 중복 확인 (계약 등록 시 자동 연결) |
| **진행상황 · 통계** | 상태별 현황, 7일 내 시공 예정, 월별/구분별/담당자별 통계 |
| **설정** | 사용자(실장)·기사·팀·상품·아파트 관리, 일정관리설정 |

### 권한 구조

```
운영자 (우리)        업체 등록, 이용기간 설정, 업체 관리자 계정 발급·정지
 └─ 업체 관리자       업체의 모든 기능 + 실장 계정 발급, 메뉴별 권한 위임
     └─ 실장          관리자가 준 권한만 사용 (본인 작성 계약만 보기 등 범위 제한 가능)
기사                  기사모바일 전용 (내 일정·보고·휴무)
```

### 기사 휴무 규칙

| 휴무 | 배정 가능한 일정 |
|---|---|
| 종일 | 없음 |
| 오전 | 오후 시간 / 오후(시간미정) |
| 오후 | 오전 시간 / 오전(시간미정) |

- 이미 일정이 있는 시간대에는 휴무 등록 불가
- 팀배정은 **팀원 전원**이 휴무일 때만 차단
- 오전/오후 기준 시각(기본 12:00)은 설정에서 변경

### 화면 주소

화면마다 주소가 있어 휴대폰·브라우저의 **뒤로가기/앞으로가기/새로고침**이 사이트 안에서 동작하고, 주소를 공유할 수 있습니다.

업체마다 **주소 코드**가 있어 `https://veritybase.vercel.app/{업체코드}` 로 접속합니다 (예: 더좋은집 = `/thegood`).
업체 코드는 운영자가 [업체/계정관리]에서 정하며, 아래 주소는 모두 업체 코드 뒤에 붙습니다 (예: `/thegood/contracts`).
업체 주소에서는 **그 업체 계정만** 로그인할 수 있고, 운영자는 코드 없는 첫 주소(`/`)에서 로그인합니다.

| 주소 | 화면 |
|---|---|
| `/contracts` · `/contracts/trash` | 계약 목록 · 휴지통 |
| `/contracts/12` · `/contracts/12/edit` | 계약 상세 · 수정 |
| `/contracts/new` · `/contracts/new?from=12` | 계약 등록 · 같은 현장 시공 추가 |
| `/customers` `/schedule` `/progress` `/stats` | 계약자관리 · 일정관리 · 진행상황 · 통계 |
| `/settings/users` `/settings/engineers` `/settings/teams` `/settings/products` `/settings/apartments` `/settings/schedule` | 설정 |
| `/{업체코드}` | 업체 로그인 (업체 이름 표시) |
| `/settings/import` | 데이터 가져오기 (관리자: 기사 목록 · 예전 프로그램 계약 엑셀) |
| `/me` · `/admin` | 내 정보 · 업체/계정관리(운영자, 업체 코드 없음) |
| `/engineer` · `/engineer/off` | 기사모바일 (내 일정 · 휴무 설정) |
| `/sign/토큰` | 고객 전자서명 (로그인 불필요) |

모바일(768px 이하)에서는 입력 양식이 위아래로 쌓이고, 칸이 많은 표는 표 안에서만 가로로 스크롤됩니다.

---

## 구성

```
사용자 브라우저 ──▶ Vercel (화면 + /api/rpc 서버 함수) ──▶ Supabase PostgreSQL (서울)
```

| 폴더 | 내용 |
|---|---|
| `frontend/` | 화면 (React + Vite) |
| `frontend/src/api/` | **업무 로직** — 권한 검사, 휴무 규칙 등. 브라우저(데모)와 서버가 같은 코드를 실행 |
| `server/` | 서버: 요청 처리, PostgreSQL 연결, 로그인 쿠키, 비밀번호 암호화, DB 자동 준비 |
| `api/rpc.js` | Vercel 서버 함수 입구 (`POST /api/rpc`) |
| `tests/` | 서버 자동 시험 |
| `docs/` | 배포 안내, 점검 결과·설계 문서 |

### 두 가지 실행 모드

| 모드 | 설정 | 데이터 저장 | 용도 |
|---|---|---|---|
| **서버 모드** | `VITE_API_MODE=server` | Supabase(PostgreSQL) — 모든 PC가 같은 데이터 | 실서비스 |
| **데모 모드** | (설정 없음) | 각 브라우저(localStorage) | 화면 시연·개발, Vercel 미리보기 |

데모 모드 시험 계정: `super / super1234` (운영자), `admin / admin1234` (관리자), `manager / manager1234` (실장), `gong / gong1234` (기사)

---

## 개발

Node.js 20 이상 필요.

### 화면만 (데모 모드)
```bash
npm install --prefix frontend
npm run dev                     # http://localhost:5173
```

### 서버 모드
```bash
cp .env.example .env            # DATABASE_URL 등 입력 (로컬 PostgreSQL 또는 시험용 Supabase)
npm install
npm install --prefix frontend
npm run dev:api                 # 서버 http://localhost:3001 (표 자동 생성)
npm run dev                     # 화면 http://localhost:5173 (/api 요청은 서버로 전달)
```

### 환경변수

| 이름 | 필수 | 설명 |
|---|---|---|
| `DATABASE_URL` | ✔ | PostgreSQL 주소 (Supabase는 Transaction pooler, 포트 6543) |
| `SESSION_SECRET` | ✔ | 로그인 쿠키 서명용 무작위 문자열 (32자 이상) |
| `INIT_SUPER_LOGIN` / `INIT_SUPER_PASSWORD` | 최초 1회 | DB가 비어 있을 때 만들 운영자 계정 |
| `VITE_API_MODE` | ✔ (서버 모드) | `server` |
| `INIT_DEMO_DATA` | | `true`면 최초 생성 시 샘플 데이터 포함 |
| `PUBLIC_BASE_URL` | | 전자서명 링크 기본 주소 (도메인 연결 시) |
| `DATABASE_CA_CERT` | | DB 서버 인증서 검증용 CA (PEM) |

비밀값은 `.env`(git 제외) 또는 Vercel 환경변수에만 넣고, 코드·채팅·문서에 적지 않습니다.

### 시험
```bash
TEST_DATABASE_URL=postgresql://postgres:비밀번호@localhost:5432/uffice_test npm test
```
- 시험 전용 DB의 표를 지웠다가 다시 만들므로 **실서비스 DB 주소는 거부**합니다.
- 확인 항목: 권한 차단, 실장 범위 제한, 동시 등록 번호 중복, 변경이력, 휴무·팀배정 규칙, 기사 보고, 전자서명, 로그인 잠금

---

## CI / CD (자동)

| 단계 | 언제 | 무엇을 |
|---|---|---|
| **CI** (GitHub Actions) | PR 생성·수정, `main` 반영 시 | 설치 → 화면 빌드(데모·서버 모드) → 서버 시험 (임시 PostgreSQL) |
| **미리보기 배포** (Vercel) | `main` 외 브랜치 푸시 시 | 브랜치별 미리보기 주소 (데모 모드) |
| **실서비스 배포** (Vercel) | `main` 반영 시 | https://veritybase.vercel.app 자동 갱신 |

작업 흐름: 작업 브랜치에 올림 → PR → CI 통과 확인 → `main`에 합침 → 자동 배포.
문제가 생기면 Vercel 대시보드의 **Instant Rollback**으로 이전 배포로 즉시 되돌릴 수 있습니다.

---

## 보안

- 권한 검사는 서버에서 수행 (화면을 우회해도 차단)
- 로그인: 서명된 HttpOnly·SameSite·Secure 쿠키(12시간), 5회 실패 시 10분 잠금
- 비밀번호: scrypt + 사용자별 salt 로 암호화 저장, 응답에 포함하지 않음
- 업체별 데이터 분리, Supabase 표는 RLS로 브라우저 직접 접근 차단
- 전자서명 증빙: 서명자 IP·기기 정보·시각 기록

## 남은 작업

- 비즈고 알림톡 실제 발송 연동 (현재 테스트 모드)
- 전자서명 법적 증빙 강화: 서명 완료본 PDF + 위변조 방지 해시, 휴대폰 본인인증
- 상담관리 · 공지사항 메뉴, 우편번호/지도 검색

자세한 내용은 [docs/REVIEW.md](docs/REVIEW.md) 참고.
