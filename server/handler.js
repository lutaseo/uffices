// ============================================================
// 서버 요청 처리 (POST /api/rpc)
//
// 화면이 { service, method, args } 를 보내면, 브라우저 데모 모드와 똑같은
// 업무 코드(frontend/src/api/services.js)를 서버에서 실행합니다.
//   1) 쿠키로 로그인 사용자 확인 → 그 업체의 데이터만 PostgreSQL 에서 읽음
//   2) 업무 코드 실행 (권한 검사 포함)
//   3) 업무 코드가 저장(saveDb)한 변경분만 DB 에 반영, 오류면 되돌림(롤백)
// 쓰기 요청은 DB 잠금으로 한 번에 하나씩 처리해 동시 수정 충돌을 막습니다.
// ============================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import * as services from '../frontend/src/api/services.js';
import { setRuntimeAdapter } from '../frontend/src/api/runtime.js';
import { ApiError } from '../frontend/src/api/core.js';
import { bizgoConfigured, listSenders, sendAlimtalk, inquiryReport } from './bizgo.js';
import { getPool, loadSnapshot, persistChanges, saveAuditLog, resolveCompanyId, contractByEsignToken, companyIdForCustomer, fingerprint } from './pg.js';
import { AUDIT_KEEP_DAYS, buildAuditEntry } from '../frontend/src/api/audit.js';
import { hashPassword, verifyPassword } from './password.js';
import { bootstrap } from './bootstrap.js';
import { COOKIE_NAME, decodeSession, encodeSession, parseCookies, sessionCookie } from './session.js';

const store = new AsyncLocalStorage();
const clone = (v) => JSON.parse(JSON.stringify(v));

// 업무 코드가 쓰는 저장/세션/암호화 기능을 서버용으로 연결
setRuntimeAdapter({
  async loadDb() {
    // 요청 하나 안에서는 같은 기준 데이터(마지막 저장 시점)의 사본을 돌려줌
    //   읽기 전용 요청은 저장하지 않으므로 사본 없이 그대로 (계약 수천 건 복사 비용 절약)
    const ctx = store.getStore();
    return ctx.readOnly ? ctx.committed : clone(ctx.committed);
  },
  saveDb(db) {
    store.getStore().committed = clone(db);
  },
  hashPassword,
  verifyPassword,
  getSession: () => store.getStore().session,
  setSession(data) {
    const ctx = store.getStore();
    ctx.session = data;
    ctx.setCookie = sessionCookie(encodeSession(data), { secure: ctx.secure });
  },
  clearSession() {
    const ctx = store.getStore();
    ctx.session = null;
    ctx.setCookie = sessionCookie('', { secure: ctx.secure });
  },
  publicBaseUrl: () => store.getStore().baseUrl,
  clientInfo: () => ({ userAgent: store.getStore().userAgent, ip: store.getStore().ip }),
  async resetDemoData() {
    throw new ApiError('서버 모드에서는 데이터 초기화를 할 수 없습니다.', 'FORBIDDEN');
  },
  // 비즈고 알림톡 (API Key 는 서버 환경변수에만)
  alimtalk: { configured: bizgoConfigured, listSenders, sendAlimtalk, inquiryReport },
});

// 호출 가능한 서비스/함수 목록 (그 외는 거부)
const SERVICES = {
  auth: services.auth,
  companies: services.companies,
  users: services.users,
  auditLogs: services.auditLogs,
  engineers: services.engineers,
  teams: services.teams,
  products: services.products,
  apartments: services.apartments,
  customers: services.customers,
  contracts: services.contracts,
  esign: services.esign,
  notifications: services.notifications,
  reports: services.reports,
  schedules: services.schedules,
  engineerOffs: services.engineerOffs,
  engineerApp: services.engineerApp,
  scheduleSettings: services.scheduleSettings,
  imports: services.imports,
  customerApp: services.customerApp,
};
const BLOCKED = new Set(['auth.resetDemoData']);

// 읽기 전용 호출 (DB 잠금 불필요)
const READ_ONLY = new Set([
  'auth.me',
  'companies.list',
  'users.list',
  'users.staffOptions',
  'engineers.list',
  'teams.list',
  'products.list',
  'apartments.list',
  'customers.list',
  'customers.findByPhone',
  'contracts.list',
  'contracts.listCached',
  'contracts.get',
  'contracts.group',
  'contracts.signBundle',
  'contracts.paperPhotos',
  'esign.getByToken',
  'customerApp.login',
  'customerApp.linkLogin',
  'customerApp.me',
  'customerApp.logout',
  'notifications.history',
  'notifications.gatewayStatus', // 비즈고 응답을 기다리는 동안 저장 잠금을 잡지 않게 (DB 는 안 바꿈)
  'notifications.testSend',
  'notifications.testResult',
  'companies.termsSettings',
  'auditLogs.list',
  'reports.contracts',
  'reports.engineers',
  'schedules.list',
  'engineerOffs.list',
  'engineerApp.mySchedules',
  'engineerApp.myOffs',
  'engineerApp.contract',
  'engineerApp.paperPhotos',
  'contracts.receipt',
  'companies.publicInfo',
  'scheduleSettings.get',
]);

// 트래픽 절약: 자주 불리는 가벼운 요청은 필요한 업체 표만 읽음 (나머지는 계약 등 전체)
//   여기 적은 함수가 다른 표를 쓰게 바뀌면 목록도 함께 고쳐야 합니다.
const LIGHT_TABLES = {
  'auth.me': [],
  'auth.login': [],
  'auth.logout': [],
  'auth.changePassword': [],
  'companies.publicInfo': [],
  'users.staffOptions': [],
  'engineers.list': [],
  'teams.list': ['teams'],
  'products.list': ['products'],
  'apartments.list': ['apartments'],
  'scheduleSettings.get': [],
  'notifications.gatewayStatus': [],
  'notifications.testSend': [],
  'notifications.testResult': [],
  'notifications.saveAlimtalkSettings': [],
  'companies.termsSettings': [], // 계약조건: 업체 표만
  'auditLogs.list': [], // 수정 로그: 로그 표만 (scope.auditLogs)
  'companies.saveContractTerms': [], // 업체 표만 바꿈 (운영자가 전체 업체 계약까지 읽지 않게)
};

// 입금 영수증 사진을 읽거나 바꾸는 요청 (첫 인자 = 계약 번호)
const RECEIPT_CALLS = new Set(['contracts.receipt', 'contracts.addPayment', 'contracts.updatePayment', 'contracts.removePayment', 'contracts.update', 'contracts.paymentPhotos', 'contracts.paperPhotos', 'contracts.setPaperPhotos', 'engineerApp.paperPhotos']);

// 계약 목록·통계: 저장하지 않는 요청이라 계약의 긴 글·변경이력 없이 읽어도 됨
const SLIM_CALLS = new Set(['contracts.list', 'contracts.listCached', 'reports.contracts', 'reports.engineers']);

const STATUS = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 };

// 서버 인스턴스마다 첫 요청 때 한 번 DB 준비 (표 생성 / 최초 운영자 계정)
let ready = null;
function ensureReady() {
  if (!ready) {
    ready = (async () => {
      const client = await getPool().connect();
      try {
        await bootstrap(client, { log: (m) => console.log(`[bootstrap] ${m}`) });
      } finally {
        client.release();
      }
    })().catch((e) => {
      ready = null; // 다음 요청에서 다시 시도
      throw e;
    });
  }
  return ready;
}

// 수정 로그 한 줄 저장 (실패해도 본 저장은 그대로 — SAVEPOINT 로 분리)
async function writeAuditLog(client, { name, session, db, scope, changes }) {
  let actor;
  if (session?.userId) {
    const u = db.users.find((x) => x.id === session.userId);
    actor = { id: session.userId, kind: 'user', name: u?.name || '', loginId: u?.loginId || '', role: u?.role || '' };
  } else if (session?.engineerId) {
    const e = db.engineers.find((x) => x.id === session.engineerId);
    actor = { id: session.engineerId, kind: 'engineer', name: e?.name || '', loginId: e?.loginId || '', role: 'ENGINEER' };
  } else {
    actor = { id: null, kind: 'customer', name: '고객', loginId: '', role: 'CUSTOMER' };
  }
  const entry = buildAuditEntry({ action: name, actor, changes, db });
  if (!entry) return;
  const first = changes[0];
  const row = first.after || (typeof first.before === 'string' ? JSON.parse(first.before) : first.before) || {};
  const companyId = scope.companyId ?? (first.table === 'companies' ? row.id : row.companyId) ?? null;
  await client.query('SAVEPOINT audit_log');
  try {
    await saveAuditLog(client, companyId, entry, AUDIT_KEEP_DAYS);
    await client.query('RELEASE SAVEPOINT audit_log');
  } catch (e) {
    await client.query('ROLLBACK TO SAVEPOINT audit_log').catch(() => {});
    console.error('[수정 로그] 저장 실패:', e.message);
  }
}

// 로그인 만료 시: 직원 로그인과 고객모바일 로그인은 한 쿠키에 같이 있으므로 실패한 쪽만 지움
function keepOtherLogin(ctx, service) {
  const { exp, customer, ...staff } = ctx.session || {}; // eslint-disable-line no-unused-vars
  const keep = service === 'customerApp' ? staff : customer ? { customer } : {};
  return sessionCookie(Object.keys(keep).length ? encodeSession(keep) : '', { secure: ctx.secure });
}

// req: { body, headers }  → { status, headers, body }
export async function handleRpc({ body, headers }) {
  const { service, method, args = [] } = body || {};
  const name = `${service}.${method}`;
  const fn = SERVICES[service] && Object.prototype.hasOwnProperty.call(SERVICES[service], method) ? SERVICES[service][method] : null;
  if (typeof fn !== 'function' || BLOCKED.has(name) || !Array.isArray(args)) {
    return json(400, { error: { message: '알 수 없는 요청입니다.', code: 'BAD_REQUEST' } });
  }

  const cookies = parseCookies(headers.cookie || '');
  const proto = headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  const host = headers['x-forwarded-host'] || headers.host || 'localhost';
  const ctx = {
    session: decodeSession(cookies[COOKIE_NAME]),
    setCookie: null,
    secure: proto === 'https',
    baseUrl: process.env.PUBLIC_BASE_URL || `${proto}://${host}/`,
    userAgent: String(headers['user-agent'] || '').slice(0, 300),
    ip: String(headers['x-forwarded-for'] || '').split(',')[0].trim(),
    committed: null,
    readOnly: READ_ONLY.has(name),
  };

  const readOnlyCall = READ_ONLY.has(name);
  const startedAt = Date.now();
  try {
    await ensureReady();
  } catch (e) {
    console.error('[bootstrap] 실패:', e.message);
    return json(503, { error: { message: `서버 설정이 완료되지 않았습니다: ${e.message}`, code: 'SETUP' } });
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // 무엇이든 무한정 기다리지 않게: 잠금 대기 15초, 한 문장 45초, 트랜잭션 중 멈춤 60초 넘으면 오류로 끝냄
    //   (Vercel 함수 제한 60초 안에서 '불러오는 중...'이 끝없이 이어지지 않도록)
    await client.query(`SET LOCAL lock_timeout = '15s'; SET LOCAL statement_timeout = '45s'; SET LOCAL idle_in_transaction_session_timeout = '60s'`);
    if (!readOnlyCall) await client.query(`SELECT 1 FROM meta WHERE key = 'seq' FOR UPDATE`); // 쓰기 직렬화

    // 필요한 업체 데이터 범위 결정
    let scope;
    if (service === 'esign') {
      const { companyId, contractId } = await contractByEsignToken(client, args[0]);
      scope = { companyId };
      if (name === 'esign.getByToken' && contractId) scope.signatureFor = contractId; // 서명 후 다시 열면 본인 서명 표시
    } else if (service === 'customerApp') {
      scope = { companyId: await companyIdForCustomer(client, name, args, ctx.session) }; // 고객모바일
    } else {
      const who = await resolveCompanyId(client, ctx.session);
      scope = who.isSuper ? { allCompanies: true } : { companyId: who.companyId };
      if (LIGHT_TABLES[name]) scope.tables = LIGHT_TABLES[name];
      if (name === 'contracts.get' || name === 'contracts.signBundle') scope.signatureFor = args[0]; // 계약서 보기일 때만 서명 이미지 로드
      if (RECEIPT_CALLS.has(name)) scope.receiptsFor = args[0]; // 이 계약의 영수증 사진만 로드
      if (name === 'auditLogs.list') scope.auditLogs = true; // 수정 로그 화면
      if (SLIM_CALLS.has(name) && readOnlyCall) scope.slimContracts = true; // 목록: 긴 글·변경이력은 읽지 않음
    }
    // 계약 목록 '바뀌었나' 확인: 먼저 계약 요약만 읽어 보고, 바뀌었을 때만 계약 전체를 다시 읽음 (트래픽 절약)
    const quickCheck = name === 'contracts.listCached' && args[1] && scope.companyId;
    const fullScope = { ...scope };
    if (quickCheck) Object.assign(scope, { tables: ['teams'], contractSummary: true });
    const sessionAtStart = ctx.session; // 수정 로그: 요청한 사람
    const tLoad = Date.now();
    let { db, readOnly } = await loadSnapshot(client, scope);
    let loadMs = Date.now() - tLoad;
    const before = readOnlyCall ? null : fingerprint(db); // 저장 비교용 지문 (읽기 전용은 생략)
    ctx.committed = db;

    let result;
    let error = null;
    try {
      result = await store.run(ctx, () => fn(...args));
    } catch (e) {
      error = e;
    }
    if (quickCheck && error?.code === 'NEED_FULL_LOAD') {
      const t2 = Date.now();
      ({ db, readOnly } = await loadSnapshot(client, fullScope));
      loadMs += Date.now() - t2;
      ctx.committed = db;
      error = null;
      try {
        result = await store.run(ctx, () => fn(...args));
      } catch (e) {
        error = e;
      }
    }

    // 업무 코드가 저장(saveDb)한 내용만 반영. (예: 로그인 실패 횟수는 오류여도 저장됨)
    if (!readOnlyCall) {
      const changes = await persistChanges(client, before, ctx.committed, readOnly);
      if (!error && changes.length) await writeAuditLog(client, { name, session: sessionAtStart, db, scope, changes });
    }
    await client.query('COMMIT');
    // 느린 요청 기록 (Vercel 로그에서 '[느림]' 으로 검색) — 다음에 느릴 때 원인을 바로 찾기 위함
    const totalMs = Date.now() - startedAt;
    if (totalMs > 3000) console.warn(`[느림] ${name} 전체 ${totalMs}ms (DB 읽기 ${loadMs}ms, 계약 ${db.contracts?.length ?? 0}건)`);

    const extraHeaders = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
    if (error) {
      if (error instanceof ApiError) {
        const cookieHeaders = error.code === 'UNAUTHORIZED' ? { 'Set-Cookie': keepOtherLogin(ctx, service) } : extraHeaders;
        return json(STATUS[error.code] || 400, { error: { message: error.message, code: error.code } }, cookieHeaders);
      }
      throw error;
    }
    return json(200, { result: result === undefined ? null : result }, extraHeaders);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`[rpc] ${name} 실패:`, e);
    // 55P03 잠금 대기 초과, 57014 시간 초과 → 다른 요청이 처리 중이라 잠시 뒤 다시 시도하면 됨
    const busy = e && (e.code === '55P03' || e.code === '57014');
    const message = busy ? '다른 작업을 처리하느라 서버가 바쁩니다. 잠시 후 다시 시도해 주세요.' : '서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    return json(busy ? 503 : 500, { error: { message, code: 'SERVER' } });
  } finally {
    client.release();
  }
}

function json(status, body, headers = {}) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(body) };
}
