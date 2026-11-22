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
import { getPool, loadSnapshot, persistChanges, saveAuditLog, resolveCompanyId, contractByEsignToken, companyIdForCustomer, fingerprint, touchedSlim } from './pg.js';
import { AUDIT_KEEP_DAYS, buildAuditEntry, skipAudit, undoSnapshot } from '../frontend/src/api/audit.js';
import { hashPassword, verifyPassword } from './password.js';
import { bootstrap } from './bootstrap.js';
import { hasFeature } from '../frontend/src/constants.js';
import { createUploadUrl, photoStoreConfigured, removeObjects, signDownloads, signPhotosIn } from './photoStore.js';
import { COOKIE_NAME, decodeSession, encodeSession, parseCookies, sessionCookie } from './session.js';
import { APP_HEADER, CO_HEADER, DEVICE_HEADER, appOf, mergeSession, viewSession } from '../frontend/src/api/sessionSlots.js';

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
  // 지금 화면(일반 / 기사모바일)의 로그인 칸만 바꾸고 다른 칸은 그대로 (sessionSlots.js)
  setSession(data) {
    const ctx = store.getStore();
    writeSession(ctx, mergeSession(ctx.fullSession, ctx.app, data, ctx.co));
  },
  clearSession() {
    const ctx = store.getStore();
    writeSession(ctx, mergeSession(ctx.fullSession, ctx.app, null, ctx.co));
  },
  publicBaseUrl: () => store.getStore().baseUrl,
  requestCompany: () => store.getStore().co || '',
  clientInfo: () => ({ userAgent: store.getStore().userAgent, ip: store.getStore().ip }),
  async resetDemoData() {
    throw new ApiError('서버 모드에서는 데이터 초기화를 할 수 없습니다.', 'FORBIDDEN');
  },
  // 비즈고 알림톡 (API Key 는 서버 환경변수에만)
  alimtalk: { configured: bizgoConfigured, listSenders, sendAlimtalk, inquiryReport },
  // 회사 자료 파일 저장소 (사진 저장소와 같은 Supabase Storage) — 시험(FILE_STORE_FAKE=1)은 가짜 주소
  files:
    process.env.FILE_STORE_FAKE === '1'
      ? { configured: () => true, uploadUrl: async (p) => `fake://upload/${p}`, downloadUrls: async (items) => Object.fromEntries(items.map((x) => [x.path, `fake://download/${x.path}`])), remove: async () => {} }
      : { configured: photoStoreConfigured, uploadUrl: createUploadUrl, downloadUrls: signDownloads, remove: removeObjects },
});

// 호출 가능한 서비스/함수 목록 (그 외는 거부)
const SERVICES = {
  auth: services.auth,
  companies: services.companies,
  users: services.users,
  auditLogs: services.auditLogs,
  engineers: services.engineers,
  teams: services.teams,
  callLogs: services.callLogs,
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
  fairs: services.fairs,
  imports: services.imports,
  customerApp: services.customerApp,
  companyFiles: services.companyFiles,
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
  'callLogs.list',
  'customers.list',
  'customers.findByPhone',
  'contracts.list',
  'contracts.listCached',
  'contracts.get',
  'contracts.group',
  'contracts.signBundle',
  'contracts.paperPhotos',
  'contracts.asPhotos',
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
  'engineerApp.myAs',
  'companyFiles.list',
  'engineerApp.colleagues',
  'engineerApp.asPhotos',
  'contracts.receipt',
  'companies.publicInfo',
  'scheduleSettings.get',
  'fairs.list',
  'engineerApp.myFairs',
]);

// 트래픽 절약: 자주 불리는 가벼운 요청은 필요한 업체 표만 읽음 (나머지는 계약 등 전체)
//   여기 적은 함수가 다른 표를 쓰게 바뀌면 목록도 함께 고쳐야 합니다.
// 운영자가 특정 업체(args[0])의 자료를 읽고 쓰는 요청
const SUPER_COMPANY_CALLS = new Set(['contracts.sampleAdd', 'contracts.sampleClear']);
// 수정 로그를 남기지 않는 요청 (시연용 샘플)

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
  'imports.products': ['products'],
  'callLogs.list': ['callLogs'],
  'callLogs.save': ['callLogs'],
  'callLogs.remove': ['callLogs'],
  'apartments.list': ['apartments'],
  'apartments.importMany': ['apartments'],
  'scheduleSettings.get': [],
  'fairs.list': [], // 박람회 일정: 업체 표만 (계약은 읽지 않음)
  'fairs.save': [],
  'fairs.remove': [],
  'engineerApp.myFairs': [],
  'engineerApp.colleagues': [], // 기사 목록만
  'companyFiles.list': [], // 회사 자료: 업체 정보만
  'companyFiles.add': [],
  'companyFiles.confirm': [],
  'companyFiles.remove': [],
  'notifications.gatewayStatus': [],
  'notifications.testSend': [],
  'notifications.testResult': [],
  'notifications.saveAlimtalkSettings': [],
  'companies.termsSettings': [], // 계약조건: 업체 표만
  'auditLogs.list': [], // 수정 로그: 로그 표만 (scope.auditLogs)
  'companies.saveContractTerms': [], // 업체 표만 바꿈 (운영자가 전체 업체 계약까지 읽지 않게)
};

// 입금 영수증 사진을 읽거나 바꾸는 요청 (첫 인자 = 계약 번호)
const RECEIPT_CALLS = new Set(['contracts.receipt', 'contracts.addPayment', 'contracts.updatePayment', 'contracts.removePayment', 'contracts.update', 'contracts.paymentPhotos', 'contracts.paperPhotos', 'contracts.setPaperPhotos', 'contracts.asPhotos', 'contracts.setAs', 'contracts.addAsPhotos', 'engineerApp.paperPhotos', 'engineerApp.asPhotos']);

// 계약 목록·통계: 저장하지 않는 요청이라 계약의 긴 글·변경이력 없이 읽어도 됨
const SLIM_CALLS = new Set(['contracts.list', 'contracts.listCached', 'reports.contracts', 'reports.engineers', 'engineerApp.myAs']);

// 계약 하나(또는 고른 몇 건)를 보거나 고치는 요청: 그 계약만 전체로 읽고 나머지 계약은 긴 글·변경이력 없이 (트래픽·속도)
//   다른 계약까지 고치게 되면 자동으로 전체를 다시 읽어 처음부터 처리 (touchedSlim) — 결과는 예전과 같음
//   첫 인자 = 계약 번호(또는 번호 목록). contracts.create 는 모두 가볍게 (새 계약만 전체)
const FOCUS_CALLS = new Set([
  'contracts.get',
  'contracts.create',
  'contracts.update',
  'contracts.updateSchedule',
  'contracts.setAs',
  'contracts.moveToTrash',
  'contracts.restore',
  'contracts.setDiscount',
  'contracts.paperPhotos',
  'contracts.setPaperPhotos',
  'contracts.receipt',
  'contracts.addPayment',
  'contracts.updatePayment',
  'contracts.paymentPhotos',
  'contracts.removePayment',
  'contracts.addNote',
  'contracts.asPhotos',
  'contracts.addAsPhotos',
]);
const focusOf = (name, args) => (name === 'contracts.create' ? [] : [].concat(args[0]).map(Number).filter((x) => Number.isSafeInteger(x)));

const STATUS = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404 };
// 저장 줄 서기(잠금) 최대 대기 — 기본 15초 (시험에서만 짧게: DB_LOCK_TIMEOUT=1s)
const LOCK_TIMEOUT = () => (/^\d{1,5}(ms|s)$/.test(String(process.env.DB_LOCK_TIMEOUT || '')) ? process.env.DB_LOCK_TIMEOUT : '15s');

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
async function writeAuditLog(client, { name, args, session, db, scope, changes }) {
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
  // 되돌리기용: 바뀐 행의 이전·이후 전체 (화면 목록에는 보내지 않음)
  const undo = undoSnapshot(name, changes);
  if (undo) entry.undo = undo;
  if (name === 'auditLogs.undo') entry.undoOf = Number(args[0]);
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

function writeSession(ctx, full) {
  ctx.fullSession = full;
  ctx.session = viewSession(full, ctx.app, ctx.co);
  ctx.setCookie = sessionCookie(full ? encodeSession(full) : '', { secure: ctx.secure, browserOnly: ctx.pc });
}

// 로그인 만료 시: 직원·기사모바일·고객모바일 로그인이 한 쿠키에 같이 있으므로 실패한 쪽만 지움
function keepOtherLogin(ctx, service) {
  const full = ctx.fullSession || {};
  // 업체 주소별 로그인: 예전 쿠키(업체 칸 없음)를 다른 업체 화면에서 열었으면 쿠키는 건드리지 않음 (원래 업체 로그인 유지)
  if (ctx.co && !full.cos) return null;
  let keep;
  if (ctx.co) {
    const cos = { ...full.cos };
    const part = cos[ctx.co] || {};
    if (service === 'customerApp') {
      const { customer, ...rest } = part; // eslint-disable-line no-unused-vars
      cos[ctx.co] = rest;
    } else {
      cos[ctx.co] = mergeSession(part, ctx.app, null) || {};
      if (part.customer) cos[ctx.co].customer = part.customer;
    }
    if (!Object.keys(cos[ctx.co]).filter((k) => k !== 'exp').length) delete cos[ctx.co];
    const { cos: _old, ...top } = full; // eslint-disable-line no-unused-vars
    keep = Object.keys(cos).length ? { ...top, cos } : top;
  } else if (service === 'customerApp') {
    const { customer, ...rest } = full; // eslint-disable-line no-unused-vars
    keep = rest;
  } else {
    keep = mergeSession(full, ctx.app, null) || {}; // 지금 화면의 직원/상담실장/기사 로그인만 지움
    if (full.customer) keep.customer = full.customer; // 고객모바일 로그인은 그대로
  }
  const out = keep && Object.keys(keep).filter((k) => k !== 'exp').length ? keep : null;
  return sessionCookie(out ? encodeSession(out) : '', { secure: ctx.secure, browserOnly: ctx.pc });
}

// req: { body, headers }  → { status, headers, body }
// 쓰기 잠금 (advisory lock): 업체마다 따로 줄을 세워 다른 업체 저장을 기다리지 않게
//   업체 요청: 전체 잠금(공유) + 그 업체 잠금(단독)  /  운영자·로그인 전·업체 없는 요청·외부 발송: 전체 잠금(단독 = 예전처럼 한 줄)
const LOCK_NS_ALL = 7351;
const LOCK_NS_COMPANY = 7352;
// 외부 서비스(알림톡 등)를 부르는 호출: 다시 실행되면 안 되므로 항상 한 줄로 (번호 충돌로 다시 실행될 일이 없게)
const GLOBAL_WRITE_CALLS = new Set(['notifications.send', 'notifications.testSend']);
// 로그인 아이디는 모든 업체에서 겹치면 안 됨 → 직원·기사 계정을 만들고 바꾸는 요청(가져오기 포함)도 한 줄로
const GLOBAL_WRITE_SERVICES = new Set(['users', 'engineers', 'imports', 'companies', 'auth']);
class SeqConflict extends Error {
  constructor() {
    super('번호 충돌 — 다시 실행');
    this.code = 'SEQ_CONFLICT';
  }
}

const RETRY = Symbol('retry');

// 요청 처리: 번호 충돌(다른 업체와 같은 순간 새 자료를 만듦)이면 연결을 돌려준 뒤 처음부터 다시 (최대 3번)
export async function handleRpc(req) {
  for (let attempt = 0; ; attempt += 1) {
    const out = await handleRpcOnce(req, attempt);
    if (out !== RETRY) return out;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 80));
  }
}

async function handleRpcOnce(req, attempt) {
  const { body, headers } = req;
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
    co: /^[a-z0-9-]{2,30}$/.test(String(headers[CO_HEADER] || '')) ? String(headers[CO_HEADER]) : '', // 이 탭의 업체 주소 — 업체마다 로그인 따로
    pc: headers[DEVICE_HEADER] === 'pc', // PC: 창을 닫으면 로그인이 풀리는 쿠키
    app: appOf(headers[APP_HEADER]), // 화면 종류 — 상담실장(/t)·기사모바일(/m)은 일반 화면과 따로 로그인
    fullSession: decodeSession(cookies[COOKIE_NAME]),
    setCookie: null,
    secure: proto === 'https',
    baseUrl: process.env.PUBLIC_BASE_URL || `${proto}://${host}/`,
    userAgent: String(headers['user-agent'] || '').slice(0, 300),
    ip: String(headers['x-forwarded-for'] || '').split(',')[0].trim(),
    committed: null,
    readOnly: READ_ONLY.has(name),
  };
  ctx.session = viewSession(ctx.fullSession, ctx.app, ctx.co);

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
    await client.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT()}'; SET LOCAL statement_timeout = '45s'; SET LOCAL idle_in_transaction_session_timeout = '60s'`);

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
      if (who.isSuper && SUPER_COMPANY_CALLS.has(name)) scope = { companyId: Number(args[0]) || -1 }; // 운영자가 한 업체 자료를 다룸 (시연 샘플)
      if (LIGHT_TABLES[name]) scope.tables = LIGHT_TABLES[name];
      if (name === 'contracts.get' || name === 'contracts.signBundle') scope.signatureFor = args[0]; // 계약서 보기일 때만 서명 이미지 로드
      if (RECEIPT_CALLS.has(name)) scope.receiptsFor = args[0]; // 이 계약의 영수증 사진만 로드
      if (name === 'auditLogs.list') scope.auditLogs = true; // 수정 로그 화면
      if (name === 'auditLogs.undo') scope.auditLogId = Number(args[0]) || -1; // 되돌리기: 그 기록 하나 (+ 이미 되돌렸는지)
      if (SLIM_CALLS.has(name) && readOnlyCall) scope.slimContracts = true; // 목록: 긴 글·변경이력은 읽지 않음
      if (FOCUS_CALLS.has(name) && scope.companyId && !scope.tables && hasFeature(await companyRow(client, scope.companyId), 'fastLoad')) {
        scope.focusContracts = focusOf(name, args);
      }
    }
    // 쓰기 잠금: 업체마다 따로 (기능 parallelSave 가 꺼진 업체·운영자 등은 예전처럼 전체 한 줄)
    if (!readOnlyCall) {
      const cid = Number(scope.companyId) > 0 ? Number(scope.companyId) : null;
      const perCompany = cid && !scope.allCompanies && !GLOBAL_WRITE_CALLS.has(name) && !GLOBAL_WRITE_SERVICES.has(service) && hasFeature(await companyRow(client, cid), 'parallelSave');
      if (perCompany) {
        await client.query('SELECT pg_advisory_xact_lock_shared($1, 0)', [LOCK_NS_ALL]);
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [LOCK_NS_COMPANY, cid]);
      } else {
        await client.query('SELECT pg_advisory_xact_lock($1, 0)', [LOCK_NS_ALL]);
      }
    }
    // 계약 목록 '바뀌었나' 확인: 먼저 계약 요약만 읽어 보고, 바뀌었을 때만 계약 전체를 다시 읽음 (트래픽 절약)
    const quickCheck = name === 'contracts.listCached' && args[1] && scope.companyId;
    const { focusContracts: _focus, ...fullScope } = scope; // eslint-disable-line no-unused-vars
    if (quickCheck) Object.assign(scope, { tables: ['teams'], contractSummary: true });
    const sessionAtStart = ctx.session; // 수정 로그: 요청한 사람
    const fullSessionAtStart = ctx.fullSession;
    const tLoad = Date.now();
    let { db, readOnly, slimIds } = await loadSnapshot(client, scope);
    let seqBase = { ...(db.seq || {}) }; // 읽은 때의 번호표 — 저장할 때 다른 업체가 그사이 늘린 번호와 합침
    let loadMs = Date.now() - tLoad;
    let before = readOnlyCall ? null : fingerprint(db); // 저장 비교용 지문 (읽기 전용은 생략)
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
      seqBase = { ...(db.seq || {}) };
      loadMs += Date.now() - t2;
      ctx.committed = db;
      error = null;
      try {
        result = await store.run(ctx, () => fn(...args));
      } catch (e) {
        error = e;
      }
    }

    // 가볍게 읽은 계약까지 고쳤으면 → 전체를 다시 읽고 처음부터 (빠진 긴 글·변경이력이 지워지지 않게)
    if (slimIds && !readOnlyCall && touchedSlim(before, ctx.committed, slimIds)) {
      const t2 = Date.now();
      ({ db, readOnly } = await loadSnapshot(client, fullScope));
      seqBase = { ...(db.seq || {}) };
      loadMs += Date.now() - t2;
      before = fingerprint(db);
      Object.assign(ctx, { session: sessionAtStart, fullSession: fullSessionAtStart, setCookie: null, committed: db });
      slimIds = null;
      error = null;
      try {
        result = await store.run(ctx, () => fn(...args));
      } catch (e) {
        error = e;
      }
    }
    // 시험용: 가볍게 읽은 결과가 전체로 읽은 결과와 똑같은지 매번 비교 (VB_VERIFY_FAST=1)
    if (slimIds && process.env.VB_VERIFY_FAST === '1') {
      await verifyFast({ slimIds, client, fullScope, fn, args, ctx, sessionAtStart, fullSessionAtStart, readOnlyCall, result, error, slimDb: ctx.committed, name, seqBase });
    }

    // 업무 코드가 저장(saveDb)한 내용만 반영. (예: 로그인 실패 횟수는 오류여도 저장됨)
    if (!readOnlyCall) {
      // 번호표(seq): 이번 요청이 늘린 표만 반영. 그사이 다른 업체가 같은 표 번호를 늘렸으면 처음부터 다시 (번호 겹침 방지)
      const seqAfter = ctx.committed.seq || {};
      const grown = Object.keys(seqAfter).filter((t) => (seqAfter[t] || 0) !== (seqBase[t] || 0));
      let seqWrite = null;
      if (grown.length) {
        const cur = (await client.query(`SELECT value FROM meta WHERE key = 'seq' FOR UPDATE`)).rows[0]?.value || {};
        if (grown.some((t) => (cur[t] || 0) !== (seqBase[t] || 0))) throw new SeqConflict();
        seqWrite = { ...cur, ...Object.fromEntries(grown.map((t) => [t, seqAfter[t]])) };
      }
      const changes = await persistChanges(client, before, ctx.committed, readOnly, seqWrite);
      if (!error && changes.length && !skipAudit(name)) await writeAuditLog(client, { name, args, session: sessionAtStart, db, scope, changes });
    }
    await client.query('COMMIT');
    // 느린 요청 기록 (Vercel 로그에서 '[느림]' 으로 검색) — 다음에 느릴 때 원인을 바로 찾기 위함
    const totalMs = Date.now() - startedAt;
    if (totalMs > 3000) console.warn(`[느림] ${name} 전체 ${totalMs}ms (DB 읽기 ${loadMs}ms, 계약 ${db.contracts?.length ?? 0}건)`);

    const extraHeaders = ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {};
    if (error) {
      if (error instanceof ApiError) {
        const kept = error.code === 'UNAUTHORIZED' ? keepOtherLogin(ctx, service) : null;
        const cookieHeaders = kept ? { 'Set-Cookie': kept } : error.code === 'UNAUTHORIZED' ? {} : extraHeaders;
        return json(STATUS[error.code] || 400, { error: { message: error.message, code: error.code } }, cookieHeaders);
      }
      throw error;
    }
    const ok = json(200, { result: result === undefined ? null : result }, extraHeaders);
    if (photoStoreConfigured()) ok.body = await signPhotosIn(ok.body); // 사진 저장소의 사진 → 4시간짜리 주소
    return ok;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e?.code === 'SEQ_CONFLICT' && attempt < 3) return RETRY; // finally 에서 연결을 돌려준 뒤 handleRpc 가 다시 실행
    console.error(`[rpc] ${name} 실패:`, e);
    // 55P03 잠금 대기 초과, 57014 시간 초과 → 다른 요청이 처리 중이라 잠시 뒤 다시 시도하면 됨
    //   code 'BUSY' 는 저장이 취소(롤백)된 것이 확실한 경우 → 화면이 알아서 다시 보냄 (remote.js)
    const busy = e && (e.code === '55P03' || e.code === '57014');
    const message = busy ? '다른 작업을 처리하느라 서버가 바쁩니다. 잠시 후 다시 시도해 주세요.' : '서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
    return json(busy ? 503 : 500, { error: { message, code: busy ? 'BUSY' : 'SERVER' } });
  } finally {
    client.release();
  }
}

async function companyRow(client, companyId) {
  const r = await client.query(`SELECT data FROM companies WHERE id = $1`, [companyId]);
  return r.rows[0]?.data || null;
}

// 시험용 비교: 같은 요청을 전체로 읽은 자료에서 한 번 더 실행해 응답·저장될 자료가 같은지 (다르면 오류)
async function verifyFast({ slimIds, client, fullScope, fn, args, ctx, sessionAtStart, fullSessionAtStart, readOnlyCall, result, error, slimDb, name, seqBase }) {
  const { db: full } = await loadSnapshot(client, fullScope);
  if (seqBase) full.seq = { ...seqBase }; // 같은 번호표로 비교 (그사이 다른 업체가 번호를 늘렸을 수 있음)
  const originals = new Map(full.contracts.map((r) => [r.id, r]));
  const ctx2 = { ...ctx, session: sessionAtStart, fullSession: fullSessionAtStart, setCookie: null, committed: clone(full) };
  let result2;
  let error2 = null;
  try {
    result2 = await store.run(ctx2, () => fn(...args));
  } catch (e) {
    error2 = e;
  }
  // 항목 순서·시각·무작위 값(토큰)은 빼고 비교
  const norm = (v) => {
    const walk = (x, k = '') => {
      if (/token/i.test(k)) return '*';
      if (typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(x)) return 'T';
      if (Array.isArray(x)) return x.map((y) => walk(y));
      if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map((key) => [key, walk(x[key], key)]));
      return x;
    };
    return JSON.stringify(walk(v ?? null));
  };
  const problems = [];
  if (norm(result) !== norm(result2)) problems.push('응답이 다름');
  if ((error?.message || '') !== (error2?.message || '')) problems.push(`오류가 다름: ${error?.message} / ${error2?.message}`);
  if (!readOnlyCall) {
    // 저장될 자료: 가볍게 읽고 안 바뀐 계약은 원래 전체 행으로 바꿔 놓고 비교
    const a = { ...slimDb, contracts: slimDb.contracts.map((r) => (slimIds.has(r.id) ? originals.get(r.id) : r)) };
    for (const key of Object.keys(ctx2.committed)) {
      if (!Array.isArray(ctx2.committed[key])) continue;
      const x = norm((a[key] || []).slice().sort((p, q) => p.id - q.id));
      const y = norm(ctx2.committed[key].slice().sort((p, q) => p.id - q.id));
      if (x !== y) problems.push(`저장 자료가 다름: ${key}`);
    }
  }
  if (problems.length) throw new Error(`[빠른 읽기 비교] ${name}: ${problems.join(', ')}`);
}

function json(status, body, headers = {}) {
  return { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(body) };
}
