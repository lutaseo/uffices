// ============================================================
// 부하 시험 — 여러 사람이 동시에 쓰면 얼마나 버티는지 (계약 보기·등록·수정·사진)
//
//   LOAD_DATABASE_URL=postgresql://...(비어 있는 시험 전용 DB) npm run loadtest
//   선택: USERS=150 CONTRACTS=3000 SECONDS=180 THINK=20-60 (한 사람이 다음 작업까지 쉬는 초)
//
// ⚠ 시험 DB 의 표를 모두 지우고 시작합니다. 실서비스(Supabase) 주소는 거부합니다.
// 결과는 이 컴퓨터 기준 (DB 가 같은 컴퓨터라 실제보다 빠름) — 숫자가 늘어나는 경향을 보는 용도
// ============================================================
import { fork } from 'node:child_process';
import pg from 'pg';

const url = process.env.LOAD_DATABASE_URL;
if (!url) throw new Error('LOAD_DATABASE_URL 환경변수가 필요합니다 (시험 전용 DB).');
if (/supabase/i.test(url)) throw new Error('실서비스(Supabase) DB 에서는 부하 시험을 할 수 없습니다.');
const USERS = Number(process.env.USERS || 150);
const CONTRACTS = Number(process.env.CONTRACTS || 3000);
const SECONDS = Number(process.env.SECONDS || 180);
const [TMIN, TMAX] = String(process.env.THINK || '20-60').split('-').map((x) => Number(x) * 1000);
const SERVERS = 4;
const PORTS = Array.from({ length: SERVERS }, (_, i) => 3201 + i);
Object.assign(process.env, {
  DATABASE_URL: url,
  SESSION_SECRET: process.env.SESSION_SECRET || 'load-test-secret-0123456789abcdef-0123456789abcdef',
  INIT_SUPER_LOGIN: 'super',
  INIT_SUPER_PASSWORD: 'super-load-1234',
  INIT_DEMO_DATA: 'true',
});

// ---------- 1. 시험 자료 ----------
const c0 = new pg.Client({ connectionString: url });
await c0.connect();
await c0.query(`DROP TABLE IF EXISTS meta, companies, users, engineers, engineer_offs, teams, products, apartments, customers,
  contracts, notifications, contract_signatures, payment_receipts, audit_logs CASCADE`);
await c0.end();

const { handleRpc } = await import('../../server/handler.js');
const { getPool, closePool } = await import('../../server/pg.js');
let seedCookie = '';
const seedCall = async (service, method, ...args) => {
  const out = await handleRpc({ body: { service, method, args }, headers: { cookie: seedCookie, host: 'load.local' } });
  if (out.headers['Set-Cookie']) seedCookie = out.headers['Set-Cookie'].split(';')[0];
  const b = JSON.parse(out.body);
  if (out.status !== 200) throw new Error(`${service}.${method}: ${b.error?.message}`);
  return b.result;
};
console.log(`시험 자료 만드는 중: 계약 ${CONTRACTS}건, 실장 ${USERS}명 ...`);
await seedCall('auth', 'login', 'admin', 'admin1234', 'thegood');
const first = await seedCall('contracts', 'create', {
  brand: '더좋은집', category: '줄눈', customerName: '원본고객', customerPhone: '010-1111-2222', aptName: '시험아파트', dong: '101', ho: '1001',
  contractDate: '2026-09-27', totalAmount: 1500000, memo: '현관 비번 1234, 주차는 지하 2층. 오전 시공 원함. '.repeat(3),
  payments: [{ kind: '계약금', method: '계좌', amount: 300000, date: '2026-09-27' }],
});
const pool = getPool();
const { rows } = await pool.query('SELECT company_id, data FROM contracts WHERE id = $1', [first.id]);
const tpl = rows[0].data;
const companyId = rows[0].company_id;
tpl.history = Array.from({ length: 6 }, (_, i) => ({ at: new Date().toISOString(), byId: 1, byName: '관리자', byRole: 'ADMIN', action: '계약 수정', changes: [{ label: '금액', from: String(i), to: String(i + 1) }] }));
const ids = [], datas = [];
for (let i = 0; i < CONTRACTS; i++) {
  const d = { ...tpl, id: 100000 + i, customerName: `고객${i}`, customerPhone: `010-${2000 + (i % 7000)}-${String(i % 10000).padStart(4, '0')}`,
    customerToken: `load${i}${Math.random().toString(36).slice(2)}`, contractDate: `2026-${String(1 + (i % 11)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}` };
  delete d.customerId;
  ids.push(d.id); datas.push(JSON.stringify(d));
}
await pool.query(`INSERT INTO contracts (id, company_id, data, updated_at) SELECT id, $2, data::jsonb, now() FROM unnest($1::bigint[], $3::text[]) AS t(id, data)`, [ids, companyId, datas]);
await pool.query(`UPDATE meta SET value = jsonb_set(value, '{contracts}', $1::jsonb) WHERE key = 'seq'`, [String(100000 + CONTRACTS)]);
const perms = (await pool.query(`SELECT data->'permissions' AS p FROM users WHERE data->>'loginId' = 'manager'`)).rows[0].p;
const { hashPassword } = await import('../../server/password.js');
const hash = await hashPassword('load12345');
const userRows = Array.from({ length: USERS }, (_, i) => ({ id: 900000 + i, companyId: Number(companyId), loginId: `load${i}`, passwordHash: hash, name: `실장${i}`, role: 'MANAGER', permissions: perms, dataScope: 'ALL', active: true, createdAt: new Date().toISOString() }));
await pool.query(`INSERT INTO users (id, company_id, data, updated_at) SELECT id, $2, data::jsonb, now() FROM unnest($1::bigint[], $3::text[]) AS t(id, data)`, [userRows.map((u) => u.id), companyId, userRows.map((u) => JSON.stringify(u))]);
await closePool();

// ---------- 2. 서버 여러 대 ----------
const servers = await Promise.all(PORTS.map((p) => new Promise((ok) => {
  // DB 연결: 서버마다 20개 (Supabase 연결 관리자처럼 한꺼번에 많이 오면 줄 서서 기다림)
  const s = fork(new URL('./server.mjs', import.meta.url), [String(p)], { env: { ...process.env, DATABASE_POOL_MAX: '20' }, silent: true });
  s.on('message', (m) => m === 'ready' && ok(s));
})));

// ---------- 3. 가상 사용자 ----------
const stats = {};
const rec = (name, ms, err, bytes) => {
  const s = (stats[name] ||= { t: [], fail: 0, bytes: 0, errs: {} });
  s.t.push(ms); s.bytes += bytes;
  if (err) { s.fail++; s.errs[err] = (s.errs[err] || 0) + 1; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const photo = 'data:image/jpeg;base64,' + Buffer.alloc(300 * 1024, 7).toString('base64'); // 휴대폰 사진 1장 (압축 후 약 300KB)
function client(i) {
  let cookie = '';
  return async (service, method, ...args) => {
    const t = Date.now();
    let err = null, body = null, len = 0;
    try {
      const r = await fetch(`http://localhost:${PORTS[i % SERVERS]}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-vb-co': 'thegood', 'x-vb-device': 'pc' }, body: JSON.stringify({ service, method, args }) });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      const txt = await r.text();
      len = txt.length; body = JSON.parse(txt);
      if (r.status !== 200) err = `${r.status} ${body?.error?.message || ''}`.slice(0, 60);
    } catch (e) { err = e.message; }
    rec(`${service}.${method}`, Date.now() - t, err, len);
    return body?.result;
  };
}
const n = (i) => `${i}-${Date.now() % 100000}`;
async function person(i, until) {
  const call = client(i);
  await sleep(rnd(0, 15000)); // 출근하듯 15초에 걸쳐 들어옴
  await call('auth', 'login', `load${i}`, 'load12345', 'thegood');
  const list = await call('contracts', 'listCached', {}, '');
  let version = list?.version || '';
  const all = (list?.rows || []).map((r) => r.id);
  let mine = null;
  while (Date.now() < until) {
    await sleep(rnd(TMIN, TMAX));
    const p = Math.random();
    if (p < 0.35) { const r = await call('contracts', 'listCached', {}, version); if (r?.version) version = r.version; }
    else if (p < 0.65) await call('contracts', 'get', all[Math.floor(Math.random() * all.length)] || first.id);
    else if (p < 0.80) { const c = await call('contracts', 'create', { brand: '더좋은집', category: '줄눈', customerName: `부하${n(i)}`, customerPhone: `010-9${String(i % 1000).padStart(3, '0')}-${String(Date.now() % 10000).padStart(4, '0')}`, aptName: '부하아파트', contractDate: '2026-11-14', totalAmount: 1200000, payments: [] }); if (c?.id) mine = c.id; }
    else if (p < 0.90) { if (mine) { const g = await call('contracts', 'get', mine); if (g) await call('contracts', 'update', mine, { ...g, memo: `수정 ${Date.now()}` }); } }
    else if (mine) await call('contracts', 'setPaperPhotos', mine, { add: [photo] });
  }
}
const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(a.length * q))];
function report(title) {
  console.log(`\n■ ${title}`);
  console.log('요청'.padEnd(26), '건수', '실패', ' 중간ms', '  95%ms', ' 최대ms', ' 응답KB');
  for (const [k, s] of Object.entries(stats).sort()) {
    const t = s.t.sort((a, b) => a - b);
    console.log(k.padEnd(28), String(t.length).padStart(4), String(s.fail).padStart(4), ...[pct(t, 0.5), pct(t, 0.95), t[t.length - 1], Math.round(s.bytes / t.length / 1024)].map((v) => String(v).padStart(7)));
    for (const [e, c] of Object.entries(s.errs)) console.log('    실패', c, '건:', e);
  }
  for (const k of Object.keys(stats)) delete stats[k];
}

console.log(`평소 사용: ${USERS}명이 ${SECONDS}초 동안 (한 사람이 ${TMIN / 1000}~${TMAX / 1000}초마다 한 번씩 작업)`);
const t0 = Date.now();
await Promise.all(Array.from({ length: USERS }, (_, i) => person(i, t0 + SECONDS * 1000)));
report(`평소 사용 — ${USERS}명, ${Math.round((Date.now() - t0) / 1000)}초`);

// ---------- 4. 몰림: 모두가 같은 순간에 저장 ----------
const burst = Array.from({ length: USERS }, (_, i) => client(i));
for (let i = 0; i < USERS; i += 10) await Promise.all(burst.slice(i, i + 10).map((c, j) => c('auth', 'login', `load${i + j}`, 'load12345', 'thegood')));
delete stats['auth.login'];
await Promise.all(burst.map((c, i) => c('contracts', 'create', { brand: '더좋은집', category: '줄눈', customerName: `동시${n(i)}`, customerPhone: `010-8${String(i % 1000).padStart(3, '0')}-1234`, aptName: '동시아파트', contractDate: '2026-11-14', totalAmount: 1000000, payments: [] })));
report(`몰림 — ${USERS}명이 같은 순간에 계약 저장 (최대 = 마지막 사람이 기다린 시간)`);

servers.forEach((s) => s.kill());
