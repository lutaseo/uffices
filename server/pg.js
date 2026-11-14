// PostgreSQL 연결 + 데이터 읽기/쓰기
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { photoStoreConfigured, uploadPhoto } from './photoStore.js';
import { hasFeature } from '../frontend/src/constants.js';

const TABLE_MAP = {
  companies: 'companies',
  users: 'users',
  engineers: 'engineers',
  engineerOffs: 'engineer_offs',
  teams: 'teams',
  products: 'products',
  apartments: 'apartments',
  customers: 'customers',
  contracts: 'contracts',
  notifications: 'notifications',
  paymentReceipts: 'payment_receipts',
};
export const TABLE_KEYS = Object.keys(TABLE_MAP);
// 업체별로 나뉘는 테이블 (요청한 사람의 업체 데이터만 읽음)
const COMPANY_SCOPED = ['engineerOffs', 'teams', 'products', 'apartments', 'customers', 'contracts', 'notifications', 'paymentReceipts'];
// 영수증 사진은 용량이 커서 기본으로 읽지 않음 (scope.receiptsFor 로 해당 계약 것만)
const HEAVY = ['paymentReceipts'];

let pool = null;

function sslOption(url) {
  if (process.env.DATABASE_SSL === 'disable' || /localhost|127\.0\.0\.1/.test(url)) return false;
  // Supabase 등: 전송 구간 암호화. DATABASE_CA_CERT(PEM)를 넣으면 서버 인증서까지 검증
  if (process.env.DATABASE_CA_CERT) return { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

export function getPool() {
  if (!pool) {
    const url = String(process.env.DATABASE_URL || '').trim(); // 복사·붙여넣기 때 들어간 공백/줄바꿈 제거
    if (!url) throw new Error('DATABASE_URL 환경변수가 필요합니다.');
    pool = new pg.Pool({
      connectionString: url.replace(/[?&]sslmode=[^&]*/, ''),
      ssl: sslOption(url),
      max: Number(process.env.DATABASE_POOL_MAX || 3), // 서버리스: 인스턴스당 연결 수를 작게
      idleTimeoutMillis: 10000,
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

const rows = async (client, sql, params = []) => (await client.query(sql, params)).rows;

// 요청 범위(scope)에 필요한 데이터만 읽어 업무 로직이 쓰는 db 객체 형태로 만듦
//   scope.companyId: 이 업체의 업무 데이터 로드
//   scope.allCompanies: 운영자 — 업체별 계약 건수만 필요 → 계약은 요약만 로드 (저장 안 함)
//   scope.tables: 읽을 업체 표 목록 (가벼운 요청은 계약 등 큰 표를 읽지 않음)
//   scope.signatureFor: 이 계약의 서명 이미지도 함께 로드 (계약서 보기)
//   scope.slimContracts: 계약의 긴 글·변경이력은 빼고 로드 (목록·통계 — 읽기 전용 요청만)
// scope.slimContracts 일 때 계약에서 빼고 읽을 항목 (목록용 — 읽기 전용 요청에만 사용)
const SLIM_DROP = ['history', 'memo', 'happyCallMemo', 'notes', 'engineerNote', 'customerNote'].map((k) => `- '${k}'`).join(' ');

export async function loadSnapshot(client, scope) {
  const db = { seq: {}, version: 2 };
  const readOnly = new Set();
  let slimIds = null; // 가볍게 읽은 계약 번호들 (scope.focusContracts)
  const meta = await rows(client, `SELECT key, value FROM meta WHERE key IN ('seq','schema_version')`);
  meta.forEach((m) => {
    if (m.key === 'seq') db.seq = m.value;
    if (m.key === 'schema_version') db.version = m.value;
  });
  const toObj = (r) => r.data;

  // 업체/계정/기사: 로그인 아이디 중복 검사 등에 필요 (행 수가 적음)
  for (const key of ['companies', 'users', 'engineers']) {
    db[key] = (await rows(client, `SELECT data FROM ${TABLE_MAP[key]} ORDER BY id`)).map(toObj);
  }
  // scope.tables: 이 요청에 필요한 업체 표만 (없으면 전부) — 트래픽 절약
  const wanted = scope.tables || COMPANY_SCOPED.filter((k) => !HEAVY.includes(k));
  for (const key of COMPANY_SCOPED) {
    if (key === 'paymentReceipts' && scope.companyId && scope.receiptsFor) {
      db[key] = (
        // receiptsFor: 계약 번호 하나, 또는 여러 건(AS 접수 등 목록에서 고른 계약들)
        await rows(client, `SELECT data FROM payment_receipts WHERE company_id = $1 AND data->>'contractId' = ANY($2::text[]) ORDER BY id`, [
          scope.companyId,
          [].concat(scope.receiptsFor).map((x) => String(Number(x))),
        ])
      ).map(toObj);
    } else if (scope.companyId && wanted.includes(key)) {
      // 목록 요청(읽기 전용)은 계약의 긴 글·변경이력을 DB 에서 아예 읽지 않음
      const cols = key === 'contracts' && scope.slimContracts ? `data ${SLIM_DROP}` : 'data';
      if (key === 'contracts' && scope.focusContracts) {
        // 계약 하나를 보거나 고칠 때: 그 계약만 전체, 나머지는 긴 글·변경이력 없이 (번호·묶음 계산에 필요한 값은 그대로)
        const focus = scope.focusContracts.filter((x) => Number.isSafeInteger(x));
        const got = await rows(
          client,
          `SELECT id, (id = ANY($2::bigint[])) AS full, CASE WHEN id = ANY($2::bigint[]) THEN data ELSE data ${SLIM_DROP} END AS data
             FROM contracts WHERE company_id = $1 ORDER BY id`,
          [scope.companyId, focus],
        );
        db.contracts = got.map(toObj);
        slimIds = new Set(got.filter((r) => !r.full).map((r) => Number(r.id)));
        continue;
      }
      db[key] = (await rows(client, `SELECT ${cols} AS data FROM ${TABLE_MAP[key]} WHERE company_id = $1 ORDER BY id`, [scope.companyId])).map(toObj);
    } else {
      db[key] = [];
      readOnly.add(key);
    }
  }
  // 수정 로그 화면: 이 업체의 최근 기록 (읽기 전용)
  if (scope.auditLogs && scope.companyId) {
    // 되돌리기용 이전·이후 자료(undo)는 크므로 목록에서는 빼고 '있음'만
    db.auditLogs = (
      await rows(
        client,
        `SELECT id, created_at, data - 'undo' AS data, (data ? 'undo') AS has_undo FROM audit_logs WHERE company_id = $1 ORDER BY created_at DESC, id DESC LIMIT 3000`,
        [scope.companyId],
      )
    ).map((r) => ({ ...r.data, hasUndo: !!r.has_undo, id: Number(r.id), at: new Date(r.created_at).toISOString() }));
  }
  // 되돌리기: 그 기록 하나(전체) + 그 기록을 되돌린 기록
  if (scope.auditLogId && scope.companyId) {
    db.auditLogs = (
      await rows(
        client,
        `SELECT id, created_at, CASE WHEN id = $2 THEN data ELSE data - 'undo' END AS data FROM audit_logs
          WHERE company_id = $1 AND (id = $2 OR data->>'undoOf' = $3)`,
        [scope.companyId, scope.auditLogId, String(scope.auditLogId)],
      )
    ).map((r) => ({ ...r.data, id: Number(r.id), at: new Date(r.created_at).toISOString() }));
    // 사진(영수증 등)은 평소에 읽지 않는 표 → 이 기록이 바꾼 사진만 읽어 둠 (되돌릴 때 비교·복구)
    const target = db.auditLogs.find((r) => r.id === scope.auditLogId);
    const photoIds = (target?.undo || []).filter((x) => x.table === 'paymentReceipts').map((x) => Number(x.id));
    if (photoIds.length) {
      db.paymentReceipts = (
        await rows(client, `SELECT data FROM payment_receipts WHERE company_id = $1 AND id = ANY($2::bigint[]) ORDER BY id`, [scope.companyId, photoIds])
      ).map(toObj);
      readOnly.delete('paymentReceipts');
    }
  }
  // 목록 변경 확인(listCached): 계약 전체 대신 담당자별 건수·마지막 수정·번호 합만 (트래픽 절약)
  //   COLLATE "C" — 시각 문자열을 화면 코드(자바스크립트)와 같은 글자 순서로 비교
  if (scope.contractSummary && scope.companyId) {
    db.contractSummary = (
      await rows(
        client,
        `SELECT data->>'ownerId' AS owner, count(*)::int AS n, max(data->>'updatedAt' COLLATE "C") AS upd, coalesce(sum(id), 0)::bigint AS ids
           FROM contracts WHERE company_id = $1 GROUP BY 1`,
        [scope.companyId],
      )
    ).map((r) => ({ ownerId: r.owner, count: Number(r.n), maxUpd: r.upd || '', idSum: Number(r.ids) }));
  }
  const sigId = Number(scope.signatureFor);
  if (Number.isSafeInteger(sigId) && sigId > 0 && db.contracts.length) {
    const id = sigId; // 숫자가 아닌 번호가 오면 DB 오류(500) 대신 서명 없이 진행 → 업무 코드가 '계약을 찾을 수 없습니다'로 안내
    const sig = await rows(client, `SELECT image FROM contract_signatures WHERE contract_id = $1 AND company_id = $2`, [id, scope.companyId]);
    const c = db.contracts.find((x) => x.id === id);
    if (sig[0] && c?.esign) c.esign.signature = sig[0].image;
  }
  if (scope.allCompanies) {
    db.contracts = (await rows(client, `SELECT id, company_id, data->>'deletedAt' AS deleted_at FROM contracts`)).map((r) => ({
      id: Number(r.id), // bigint 는 문자열로 오므로 숫자로 변환
      companyId: Number(r.company_id),
      deletedAt: r.deleted_at,
    }));
    readOnly.add('contracts');
  }
  return { db, readOnly, slimIds };
}

// 계약의 서명 이미지는 별도 표에 저장 → 계약 데이터에서는 떼어냄
function splitSignature(row) {
  if (!row.esign?.signature) return [row, null];
  const { signature, ...esign } = row.esign;
  return [{ ...row, esign }, signature];
}

// 변경된 행만 저장 (추가/수정/삭제)
// 저장 전 상태의 '지문'만 만들어 둠 (전체 복사 대신 행마다 JSON 글자 하나) → 쓰기 요청이 가벼워짐
// 가볍게 읽은 계약을 업무 코드가 바꾸거나 지웠는지 (그러면 전체를 다시 읽어 처음부터 — 빠진 항목이 지워지지 않게)
export function touchedSlim(fp, after, slimIds) {
  if (!slimIds?.size) return false;
  const prev = fp.contracts.rows;
  let seen = 0;
  for (const r of after.contracts || []) {
    if (!slimIds.has(r.id)) continue;
    seen++;
    if (JSON.stringify(r) !== prev.get(r.id)) return true;
  }
  return seen !== slimIds.size;
}

export function fingerprint(db) {
  const fp = { __fingerprint: true };
  for (const key of TABLE_KEYS) {
    const isContracts = key === 'contracts';
    const rows = new Map();
    const sigs = new Map();
    for (const r of db[key] || []) {
      const [data, sig] = isContracts ? splitSignature(r) : [r, null];
      if (sig) sigs.set(r.id, sig);
      rows.set(r.id, JSON.stringify(data));
    }
    fp[key] = { rows, sigs };
  }
  return fp;
}

// 반환: 바뀐 행 목록 [{ table, before(이전 JSON 문자열 | null), after(행 | null) }] — 수정 로그용
export async function persistChanges(client, before, after, readOnly) {
  const fp = before && before.__fingerprint ? before : fingerprint(before);
  const changes = [];
  for (const key of TABLE_KEYS) {
    if (readOnly.has(key)) continue;
    const table = TABLE_MAP[key];
    const isContracts = key === 'contracts';
    const prevSig = fp[key].sigs;
    const prev = fp[key].rows;
    const nextIds = new Set();
    const ids = [];
    const companyIds = [];
    const datas = [];
    for (const original of after[key] || []) {
      const [row, sig] = isContracts ? splitSignature(original) : [original, null];
      nextIds.add(row.id);
      if (sig && sig !== prevSig.get(row.id)) {
        await client.query(
          `INSERT INTO contract_signatures (contract_id, company_id, image, updated_at) VALUES ($1, $2, $3, now())
           ON CONFLICT (contract_id) DO UPDATE SET image = EXCLUDED.image, updated_at = now()`,
          [row.id, row.companyId, sig],
        );
      }
      const json = JSON.stringify(row);
      if (prev.get(row.id) === json) continue;
      changes.push({ table: key, before: prev.get(row.id) ?? null, after: row });
      ids.push(row.id);
      companyIds.push(key === 'companies' ? row.id : row.companyId ?? null);
      datas.push(json);
    }
    // 새 사진은 사진 전용 저장소로 (업체 스위치·설정이 있을 때) — DB·수정로그에는 'vbstore:경로' 만
    if (key === 'paymentReceipts' && photoStoreConfigured()) {
      await Promise.all(
        changes.map(async (ch) => {
          if (ch.table !== key || !ch.after || !String(ch.after.image || '').startsWith('data:')) return;
          if (!hasFeature(after.companies?.find((c) => c.id === ch.after.companyId), 'photoStorage')) return;
          const ext = /^data:image\/(png|webp)/.exec(ch.after.image)?.[1] || 'jpg';
          const path = `${ch.after.companyId}/${ch.after.contractId || 0}/${ch.after.id}-${randomBytes(6).toString('hex')}.${ext}`;
          const stored = await uploadPhoto(ch.after.image, path);
          if (!stored) return;
          ch.after = { ...ch.after, image: stored };
          datas[ids.indexOf(ch.after.id)] = JSON.stringify(ch.after);
        }),
      );
    }
    // 바뀐 행을 표마다 한 번에 저장 (DB 가 멀어도 왕복 횟수가 적도록)
    for (let i = 0; i < ids.length; i += 500) {
      await client.query(
        `INSERT INTO ${table} (id, company_id, data, updated_at)
         SELECT id, company_id, data::jsonb, now() FROM unnest($1::bigint[], $2::bigint[], $3::text[]) AS t(id, company_id, data)
         ON CONFLICT (id) DO UPDATE SET company_id = EXCLUDED.company_id, data = EXCLUDED.data, updated_at = now()`,
        [ids.slice(i, i + 500), companyIds.slice(i, i + 500), datas.slice(i, i + 500)],
      );
    }
    const removed = [...prev.keys()].filter((id) => !nextIds.has(id));
    removed.forEach((id) => changes.push({ table: key, before: prev.get(id), after: null }));
    if (removed.length) {
      await client.query(`DELETE FROM ${table} WHERE id = ANY($1::bigint[])`, [removed]);
      if (isContracts) await client.query(`DELETE FROM contract_signatures WHERE contract_id = ANY($1::bigint[])`, [removed]);
    }
  }
  if (JSON.stringify(before.seq) !== JSON.stringify(after.seq)) {
    await client.query(
      `INSERT INTO meta (key, value) VALUES ('seq', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(after.seq)],
    );
  }
  return changes;
}

// 수정 로그 저장 + 2주 지난 기록 지우기 (그 업체 것만, 색인으로 빠름)
export async function saveAuditLog(client, companyId, entry, keepDays) {
  await client.query(`INSERT INTO audit_logs (company_id, data) VALUES ($1, $2::jsonb)`, [companyId ?? null, JSON.stringify(entry)]);
  await client.query(`DELETE FROM audit_logs WHERE company_id IS NOT DISTINCT FROM $1 AND created_at < now() - make_interval(days => $2)`, [
    companyId ?? null,
    keepDays,
  ]);
}

// 요청 전에 로그인한 사람의 업체를 알아냄
export async function resolveCompanyId(client, session) {
  if (session?.userId) {
    const r = await rows(client, `SELECT data->>'companyId' AS c, data->>'role' AS role FROM users WHERE id = $1`, [session.userId]);
    if (!r[0]) return { companyId: null };
    return { companyId: r[0].c ? Number(r[0].c) : null, isSuper: r[0].role === 'SUPER' };
  }
  if (session?.engineerId) {
    const r = await rows(client, `SELECT company_id FROM engineers WHERE id = $1`, [session.engineerId]);
    return { companyId: r[0] ? Number(r[0].company_id) : null };
  }
  return { companyId: null };
}

// 고객모바일: 업체 주소 코드 / 고객 링크 → 업체 번호 (없으면 null)
export async function companyIdForCustomer(client, name, args, session) {
  if (name === 'customerApp.login') {
    const r = await rows(client, `SELECT id FROM companies WHERE data->>'code' = $1`, [String(args[0] || '').toLowerCase()]);
    return r[0] ? Number(r[0].id) : null;
  }
  if (name === 'customerApp.linkLogin') {
    // 고객확인페이지 값 또는 서명 링크 값(지금·예전) — services.js customerApp.linkLogin 과 같게
    const r = await rows(
      client,
      `SELECT company_id FROM contracts WHERE data->>'customerToken' = $1 OR data->'esign'->>'token' = $1 OR (data->'esign'->'pastTokens') ? $1 LIMIT 1`,
      [String(args[0] || '')],
    );
    return r[0] ? Number(r[0].company_id) : null;
  }
  return session?.customer?.companyId ? Number(session.customer.companyId) : null;
}

// 서명 링크 → { companyId, contractId } (없으면 null 들)
export async function contractByEsignToken(client, token) {
  // 지금 서명 링크 값 → 예전 서명 링크 값 → 고객확인페이지 값 순으로 (contracts.js bundleByToken 과 같게)
  const t = String(token || '');
  let r = await rows(client, `SELECT id, company_id FROM contracts WHERE data->'esign'->>'token' = $1 ORDER BY id LIMIT 1`, [t]);
  if (!r[0] && t) {
    r = await rows(client, `SELECT id, company_id FROM contracts WHERE (data->'esign'->'pastTokens') ? $1 OR data->>'customerToken' = $1 ORDER BY id LIMIT 1`, [t]);
  }
  return r[0] ? { companyId: Number(r[0].company_id), contractId: Number(r[0].id) } : { companyId: null, contractId: null };
}
