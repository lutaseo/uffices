// ============================================================
// 데이터베이스 자동 준비
//   - 표(테이블)가 없으면 만들고
//   - 계정이 하나도 없으면 환경변수(INIT_SUPER_LOGIN / INIT_SUPER_PASSWORD)로 운영자 계정 발급
//   - INIT_DEMO_DATA=true 이면 시험용 샘플 데이터도 함께 생성
// 서버가 처음 요청을 받을 때 한 번 실행되며(npm run db:setup 으로 직접 실행도 가능),
// 여러 서버가 동시에 켜져도 DB 잠금으로 한 번만 실행됩니다.
// ============================================================

import { SCHEMA_SQL } from './schema.js';
import { persistChanges } from './pg.js';
import { hashPassword } from './password.js';
import { buildSeed, emptyDb, SCHEMA_VERSION } from '../frontend/src/api/seed.js';
import { ROLES } from '../frontend/src/auth/permissions.js';

// 잠금 번호 (예전 세션 잠금 20260927 과 다른 번호 — 남아 있는 옛 잠금에 걸리지 않게)
const LOCK_KEY = 20261001;
// 표 구조(SCHEMA_SQL)를 바꾸면 이 번호를 올림 → 다음 서버 시작 때 한 번만 다시 적용
export const DDL_VERSION = 2;

// 표 구조가 이미 최신이고 계정도 있으면 아무것도 하지 않음 (잠금·ALTER 없이 즉시 통과)
async function alreadyReady(client) {
  const { rows } = await client.query(`SELECT to_regclass('public.meta') IS NOT NULL AS has_meta`);
  if (!rows[0].has_meta) return false;
  const r = await client.query(`SELECT value FROM meta WHERE key = 'ddl_version'`);
  if (Number(r.rows[0]?.value) !== DDL_VERSION) return false;
  const u = await client.query('SELECT 1 FROM users LIMIT 1');
  return u.rows.length > 0;
}

export async function bootstrap(client, { demo = process.env.INIT_DEMO_DATA === 'true', log = () => {} } = {}) {
  // 빠른 확인도 시간 제한 안에서 (무엇에 막혀도 10초 안에 오류로 끝남)
  await client.query('BEGIN');
  let ok = false;
  try {
    await client.query(`SET LOCAL statement_timeout = '10s'; SET LOCAL lock_timeout = '10s'`);
    ok = await alreadyReady(client);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }
  if (ok) {
    log('✔ 표·계정 준비됨 (건너뜀)');
    return;
  }
  // 트랜잭션 잠금: 끝나면(COMMIT/ROLLBACK/연결 끊김) 자동으로 풀림 → 서버가 중간에 죽어도 다른 서버가 멈추지 않음
  //   (예전 세션 잠금은 Supabase 연결 풀러에서 풀리지 않고 남아 모든 요청이 무한 대기할 수 있었음)
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL lock_timeout = '10s'`);
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    if (!(await alreadyReady(client))) {
      await client.query(SCHEMA_SQL);
      await client.query(`INSERT INTO meta (key, value) VALUES ('seq', '{}') ON CONFLICT (key) DO NOTHING`);
      await client.query(`INSERT INTO meta (key, value) VALUES ('ddl_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [
        JSON.stringify(DDL_VERSION),
      ]);
      log('✔ 표(테이블) 준비 완료');
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  }

  {
    const { rows } = await client.query('SELECT count(*)::int AS n FROM users');
    if (rows[0].n > 0) {
      log(`ℹ 이미 계정이 ${rows[0].n}개 있어 데이터 생성을 건너뜁니다.`);
      return;
    }
    const loginId = process.env.INIT_SUPER_LOGIN;
    const password = process.env.INIT_SUPER_PASSWORD;
    if (!loginId || !password || password.length < 8) {
      throw new Error('INIT_SUPER_LOGIN, INIT_SUPER_PASSWORD(8자 이상) 환경변수를 설정해 주세요.');
    }

    await client.query('BEGIN');
    try {
      await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
      const again = await client.query('SELECT count(*)::int AS n FROM users');
      if (again.rows[0].n > 0) {
        await client.query('ROLLBACK');
        return; // 다른 서버가 먼저 만들었음
      }
      const db = demo ? await buildSeed(hashPassword) : { ...emptyDb(), version: SCHEMA_VERSION };
      const existingSuper = db.users.find((u) => u.role === ROLES.SUPER);
      const superUser = {
        id: existingSuper?.id ?? (db.seq.users = (db.seq.users || 0) + 1),
        loginId,
        passwordHash: await hashPassword(password),
        name: '유피스 운영자',
        phone: '',
        role: ROLES.SUPER,
        companyId: null,
        permissions: [],
        dataScope: 'all',
        teamId: null,
        position: '',
        active: true,
        createdAt: new Date().toISOString(),
        lastLoginAt: null,
      };
      db.users = [...db.users.filter((u) => u.role !== ROLES.SUPER), superUser];
      await client.query(
        `INSERT INTO meta (key, value) VALUES ('schema_version', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [JSON.stringify(db.version || SCHEMA_VERSION)],
      );
      await persistChanges(client, { ...emptyDb(), seq: {} }, db, new Set());
      await client.query('COMMIT');
      log(`✔ 운영자 계정 생성: ${loginId}${demo ? ' (+ 샘플 데이터: admin / manager / gong 계정)' : ''}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }
  }
}
