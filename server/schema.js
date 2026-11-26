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
                           'apartments','customers','contracts','notifications','payment_receipts',
                           'call_logs','purchases','stocks']
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

-- 수정 로그 (누가 언제 무엇을 바꿨는지 · 최근 2주만 보관)
CREATE TABLE IF NOT EXISTS audit_logs (
  id bigserial PRIMARY KEY,
  company_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_company_time_idx ON audit_logs (company_id, created_at DESC);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- 자료 기억해 두기(rowCache): 줄마다 마지막으로 쓴 트랜잭션 번호(vx) + 지운 줄 기록(row_deletes)
--   서버가 기억해 둔 표에서 바뀐 줄만 다시 읽도록 (DB 전송량 절약)
CREATE TABLE IF NOT EXISTS row_deletes (
  seq        bigserial PRIMARY KEY,
  tbl        text NOT NULL,
  row_id     bigint NOT NULL,
  company_id bigint,
  vx         xid8 NOT NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS row_deletes_find_idx ON row_deletes (tbl, company_id, vx);
CREATE INDEX IF NOT EXISTS row_deletes_at_idx ON row_deletes (at);
ALTER TABLE row_deletes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION vb_mark_row() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  NEW.vx := pg_current_xact_id();
  RETURN NEW;
END $f$;
CREATE OR REPLACE FUNCTION vb_log_delete() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO row_deletes (tbl, row_id, company_id, vx) VALUES (TG_TABLE_NAME, OLD.id, OLD.company_id, pg_current_xact_id());
  RETURN OLD;
END $f$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['engineer_offs','teams','products','apartments','customers','contracts',
                           'notifications','call_logs','purchases','stocks']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS vx xid8', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I (company_id, vx)', t || '_vx_idx', t);
    EXECUTE format('DROP TRIGGER IF EXISTS vb_mark ON %I', t);
    EXECUTE format('CREATE TRIGGER vb_mark BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION vb_mark_row()', t);
    EXECUTE format('DROP TRIGGER IF EXISTS vb_log_delete ON %I', t);
    EXECUTE format('CREATE TRIGGER vb_log_delete AFTER DELETE ON %I FOR EACH ROW EXECUTE FUNCTION vb_log_delete()', t);
  END LOOP;
END $$;

-- 브라우저에서 Supabase 로 직접 접근하지 못하도록 차단 (서버만 접근)
ALTER TABLE meta ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','users','engineers','engineer_offs','teams','products',
                           'apartments','customers','contracts','notifications','payment_receipts',
                           'call_logs','purchases','stocks']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
`;
