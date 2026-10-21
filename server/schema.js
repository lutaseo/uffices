// 데이터베이스 스키마 (PostgreSQL / Supabase). 서버가 처음 켜질 때 자동 적용됩니다.
// 여러 번 실행해도 안전합니다 (IF NOT EXISTS).
export const SCHEMA_SQL = `
-- ============================================================
-- VerityBase 데이터베이스 스키마 (PostgreSQL / Supabase)
--
-- 각 테이블은 id, company_id(업체 구분), data(JSON) 로 구성됩니다.
-- 업무 로직(frontend/src/api/*.js)이 다루는 데이터 형태를 그대로 저장해,
-- 데모 모드와 서버가 같은 코드를 쓰도록 했습니다.
-- 자주 찾는 값(로그인 아이디, 서명 링크 토큰)에는 인덱스를 둡니다.
-- 여러 번 실행해도 안전합니다 (IF NOT EXISTS).
-- ============================================================

CREATE TABLE IF NOT EXISTS meta (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','users','engineers','engineer_offs','teams','products',
                           'apartments','customers','contracts','notifications','payment_receipts']
  LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (
      id          bigint PRIMARY KEY,
      company_id  bigint,
      data        jsonb NOT NULL,
      updated_at  timestamptz NOT NULL DEFAULT now()
    )', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (company_id)', t || '_company_idx', t);
  END LOOP;
END $$;

-- 고객 서명 이미지 (용량이 커서 계약 데이터와 분리, 계약서를 열 때만 읽음)
CREATE TABLE IF NOT EXISTS contract_signatures (
  contract_id bigint PRIMARY KEY,
  company_id  bigint,
  image       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contract_signatures ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS users_login_idx ON users ((data->>'loginId'));
CREATE INDEX IF NOT EXISTS engineers_login_idx ON engineers ((data->>'loginId'));
CREATE INDEX IF NOT EXISTS contracts_esign_token_idx ON contracts ((data->'esign'->>'token'));
-- 입금 영수증 사진 (용량이 커서 계약별로 필요할 때만 읽음)
CREATE INDEX IF NOT EXISTS payment_receipts_contract_idx ON payment_receipts ((data->>'contractId'));

-- 브라우저에서 Supabase 로 직접 접근하지 못하도록 차단 (서버만 접근)
ALTER TABLE meta ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','users','engineers','engineer_offs','teams','products',
                           'apartments','customers','contracts','notifications','payment_receipts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
`;
