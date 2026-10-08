# 배포 · 서버 연결 가이드

구성: **화면 + 서버 = Vercel**, **데이터베이스 = Supabase (서울)**

```
사용자 브라우저 ──▶ Vercel (화면 + /api/rpc 서버) ──▶ Supabase PostgreSQL (서울)
```

- 컴퓨터에 아무것도 설치하지 않고, 두 사이트의 웹 화면 설정만으로 배포할 수 있습니다.
- 서버가 처음 켜질 때 데이터베이스 표를 자동으로 만들고 운영자 계정을 발급합니다.

---

## 1단계 — Supabase 데이터베이스 만들기 (약 5분)

1. https://supabase.com 에 가입 (GitHub 계정으로 가능)
2. **유피스 전용 조직 만들기**: 왼쪽 위 조직 이름 → **New organization**
   - Name: `UFFICE`, Type: Company, Plan: **Free** (판매 시작할 때 이 조직만 Pro 로 전환)
   - 다른 개인 프로젝트는 다른 조직에 두면, 유피스를 유료로 바꿔도 비용이 따로 계산됩니다
   - 결제 이메일(Billing email)은 회사 이메일로 지정 권장
3. `UFFICE` 조직 안에서 **New project**
   - Name: `uffice` (자유)
   - Database Password: **강한 비밀번호 생성 후 따로 보관** (다시 볼 수 없음)
   - Region: **Northeast Asia (Seoul)** ← 개인정보가 국내에 저장되고 속도도 빠름
4. 프로젝트가 만들어지면 상단 **Connect** 버튼 → **Connection string** 탭
   - **Transaction pooler** (포트 `6543`) 주소를 복사
   - 예: `postgresql://postgres.abcd:[YOUR-PASSWORD]@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres`
   - `[YOUR-PASSWORD]` 부분을 3번에서 만든 비밀번호로 바꿈 → 이것이 **DATABASE_URL**

> Supabase 에서 표를 직접 만들 필요는 없습니다. 서버가 처음 켜질 때 자동으로 만듭니다.

---

## 2단계 — Vercel 에 연결하기 (약 5분)

> 계정 구성: 지금은 **개인 계정(Hobby, 무료)** 에 배포합니다. Vercel 의 팀(Team)은 유료(Pro) 전용이라,
> 실제 판매를 시작할 때 `UFFICE` 팀을 만들고 프로젝트를 옮기면 됩니다 (Settings → General → Transfer Project).

1. https://vercel.com 에 GitHub 계정으로 로그인
2. **Add New… → Project** → `lutaseo/uffices` 옆 **Import**
   - 목록에 없으면 "Adjust GitHub App Permissions" 에서 이 저장소 접근 허용
3. 설정 화면에서 **Root Directory 는 그대로(`./`)**, Framework Preset 은 **Other** (빌드 설정은 `vercel.json` 에 이미 있음)
4. **Environment Variables** 에 아래 값을 입력 (Environment 는 **Production** 만 체크 — 아래 "주의" 참고)

| 이름 | 값 | 설명 |
|---|---|---|
| `DATABASE_URL` | 1단계에서 만든 주소 | 데이터베이스 연결 |
| `SESSION_SECRET` | 64자 무작위 문자열 | 로그인 쿠키 서명용. 만드는 법 ↓ |
| `INIT_SUPER_LOGIN` | 예: `uffice-admin` | 최초 운영자(우리) 아이디 |
| `INIT_SUPER_PASSWORD` | 8자 이상 | 최초 운영자 비밀번호 |
| `VITE_API_MODE` | `server` | 화면을 서버 모드로 (없으면 데모 모드) |
| `INIT_DEMO_DATA` | `true` (선택) | 시험용 샘플 데이터(더좋은집, 계약 48건, admin/manager/gong 계정) 생성. 실서비스면 넣지 않음 |

**SESSION_SECRET 만드는 법**: 크롬에서 F12 → Console 탭에 아래를 붙여넣고 Enter → 나온 값을 복사
```js
crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '')
```

5. **Deploy** → 1~2분 뒤 `veritybase-xxxx.vercel.app` 주소가 생깁니다.

---

## 3단계 — 첫 접속 및 확인

1. 배포된 주소로 접속 → `INIT_SUPER_LOGIN` / `INIT_SUPER_PASSWORD` 로 로그인
2. 상단 **업체/계정관리 → + 업체 등록** 에서 업체(예: 더좋은집)와 관리자 계정 발급
3. 발급한 관리자 계정으로 다시 로그인 → 설정에서 기사/상품/아파트 등록 → 계약 등록
4. 다른 PC·휴대폰에서 로그인해도 같은 데이터가 보이면 서버 연결 성공입니다.
   (화면 상단에 "데모 모드" 표시가 **없어야** 정상)

**설정이 끝나면 (보안)**
- 운영자 로그인 후 **설정 > 내 정보** 에서 비밀번호를 한 번 바꾸세요.
- `INIT_SUPER_PASSWORD` 는 계정이 하나도 없을 때만 쓰이므로 Vercel 환경변수에서 지워도 됩니다.

---

## 주의사항

### GitHub 2단계 인증
GitHub 아이디 하나로 코드·데이터베이스·배포에 모두 들어가므로 **2단계 인증을 꼭 켜세요**
(GitHub → Settings → Password and authentication → Two-factor authentication).

### 미리보기(Preview) 배포와 데이터베이스
Vercel 은 `main` 이 아닌 브랜치를 푸시할 때마다 미리보기 주소를 만듭니다. 환경변수를 Preview 에도 넣으면 **미리보기도 실서비스 DB 를 같이 쓰게 됩니다.**
- 권장: 위 환경변수는 **Production 에만** 입력 → 미리보기는 자동으로 데모 모드(브라우저 저장)로 동작
- 미리보기도 서버로 시험하고 싶으면 Supabase 프로젝트를 하나 더 만들어 Preview 환경변수에 그 주소를 넣으세요.

### 비밀번호·키 보관
- `DATABASE_URL`, `SESSION_SECRET` 은 채팅·카톡·문서에 붙여넣지 말고 Vercel 환경변수에만 입력하세요.
- `SESSION_SECRET` 을 바꾸면 모든 사용자가 로그아웃됩니다 (유출이 의심될 때 사용).

### (선택) 데이터베이스 인증서 검증
기본 설정은 데이터베이스와의 통신을 암호화합니다. 인증서까지 검증하려면 Supabase → Project Settings → Database → **SSL Configuration** 에서 인증서를 내려받아, 그 내용을 `DATABASE_CA_CERT` 환경변수에 넣으세요.

---

## 요금 (결정 전 확인)

| 서비스 | 무료 | 실서비스 |
|---|---|---|
| Supabase | 시험용으로 충분. **7일간 사용이 없으면 일시정지, 자동 백업 없음** | Pro 요금제 권장 (매일 백업, 일시정지 없음) |
| Vercel | Hobby: **개인·비상업 용도만** 허용 | 업체에 판매/운영하면 Pro 필요 |

- 추천: 시험 기간에는 둘 다 무료로 → 실제 업체에 제공하기 시작할 때 유료로 전환
- Vercel 비용이 부담되면 Cloudflare Pages(무료에서도 상업 사용 가능)로 옮길 수 있지만, 서버 함수 방식이 달라 추가 작업이 필요합니다.

---

## 도메인 연결 (구입 시)

1. 가비아·카페24·Cloudflare 등에서 도메인 구입 (예: `uffice.co.kr`)
2. Vercel 프로젝트 → Settings → **Domains** → 도메인 입력
3. 화면에 나오는 값(보통 `A 76.76.21.21` 또는 `CNAME cname.vercel-dns.com`)을 도메인 구입처 DNS 설정에 입력
4. HTTPS 인증서는 자동 발급됩니다
5. 전자서명 링크가 새 도메인으로 나가도록 환경변수 `PUBLIC_BASE_URL=https://uffice.co.kr/` 추가

업체별 주소가 필요해지면 `thegoodhouse.uffice.co.kr` 처럼 서브도메인을 붙이는 방식으로 확장할 수 있습니다.

---

## 브랜치와 배포

| 브랜치 | 배포 | 주소 |
|---|---|---|
| `main` | 실서비스 (Production) | `프로젝트명.vercel.app` / 연결한 도메인 |
| 그 외 | 미리보기 (Preview) | 푸시할 때마다 별도 주소 |

작업 브랜치의 변경 요청(PR)을 `main` 에 합치면 실서비스에 반영됩니다.

**다시 연결하기**: 프로젝트 → Settings → Git → Disconnect 후 다시 연결. 다른 계정으로 옮길 때는 Settings → General → Transfer Project.

---

## (개발자용) 내 컴퓨터에서 서버 모드로 실행

Node.js 20 이상 필요.

```bash
cp .env.example .env         # 값 채우기 (DATABASE_URL 은 Supabase 또는 로컬 PostgreSQL)
npm install
npm install --prefix frontend
npm run db:setup -- --demo   # (선택) 표 생성 + 샘플 데이터 — 서버가 자동으로도 실행
npm run dev:api              # 서버: http://localhost:3001
npm run dev                  # 화면: http://localhost:5173 (/api 요청은 서버로 전달)
```

`.env` 에서 `VITE_API_MODE=server` 를 지우면 서버 없이 데모 모드로 동작합니다.
