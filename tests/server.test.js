// ============================================================
// 서버 자동 시험 (GitHub Actions 에서 매번 실행)
//
// 실제 PostgreSQL 에 서버 요청 처리(handleRpc)를 그대로 실행해
// 권한 검사·휴무 규칙·전자서명·동시 등록을 확인합니다.
//
// ⚠ 시험 전에 데이터베이스의 표를 모두 지웁니다.
//    그래서 DATABASE_URL 이 아닌 TEST_DATABASE_URL 만 사용하고,
//    Supabase 주소는 거부합니다 (실서비스 DB 보호).
//
// 로컬 실행: TEST_DATABASE_URL=postgresql://... npm test
// ============================================================

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL 환경변수가 필요합니다 (시험 전용 DB).');
if (/supabase/i.test(url)) throw new Error('실서비스(Supabase) DB 에서는 시험을 실행할 수 없습니다.');

process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ||= 'test-session-secret-0123456789abcdef-0123456789';
process.env.INIT_SUPER_LOGIN = 'super';
process.env.INIT_SUPER_PASSWORD = 'super-test-1234';
process.env.INIT_DEMO_DATA = 'true';
process.env.VB_VERIFY_FAST = '1'; // 빠른 불러오기: 매 요청마다 전체로 읽은 결과와 같은지 비교 (다르면 실패)

const { handleRpc } = await import('../server/handler.js');
const { closePool } = await import('../server/pg.js');
const { healthReport } = await import('../server/health.js');

// 로그인 쿠키를 기억하는 시험용 사용자
function client(headers = {}) {
  let cookie = '';
  const call = async (service, method, ...args) => {
    const out = await handleRpc({ body: { service, method, args }, headers: { cookie, host: 'test.local', ...headers } });
    const setCookie = out.headers['Set-Cookie'];
    if (setCookie) cookie = setCookie.split(';')[0];
    call.lastCookie = setCookie || call.lastCookie;
    return { status: out.status, ...JSON.parse(out.body) };
  };
  call.ok = async (...a) => {
    const r = await call(...a);
    assert.equal(r.status, 200, `${a[0]}.${a[1]} 실패: ${r.error?.message}`);
    return r.result;
  };
  return call;
}

before(async () => {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`DROP TABLE IF EXISTS meta, companies, users, engineers, engineer_offs, teams, products,
    apartments, customers, contracts, notifications, contract_signatures, payment_receipts CASCADE`);
  await c.end();
});

after(closePool);

const admin = client();
const manager = client();
const base = { brand: '더좋은집', customerName: '시험고객', customerPhone: '010-4444-5555', aptName: '시험아파트', contractDate: '2026-09-27' };

test('첫 요청 시 표 자동 생성 + 운영자·샘플 계정', async () => {
  const sup = client();
  assert.equal((await sup('auth', 'login', 'super', 'super1234')).status, 400, '샘플 super 비밀번호는 환경변수 값으로 대체');
  const me = await sup.ok('auth', 'login', 'super', 'super-test-1234');
  assert.equal(me.user.role, 'SUPER');
  const [company] = await sup.ok('companies', 'list');
  assert.equal(company.contractCount, 48);
  assert.equal((await sup('contracts', 'list', {})).status, 403, '운영자는 업체 계약 조회 불가');
});

test('로그인: 쿠키 보안 속성, 비밀번호 해시 비노출', async () => {
  const secure = client({ 'x-forwarded-proto': 'https' });
  const me = await secure.ok('auth', 'login', 'admin', 'admin1234');
  assert.match(secure.lastCookie, /HttpOnly/);
  assert.match(secure.lastCookie, /SameSite=Lax/);
  assert.match(secure.lastCookie, /Secure/);
  assert.ok(!JSON.stringify(me).includes('passwordHash'));
  assert.match(secure.lastCookie, /Max-Age=43200/, '휴대폰·태블릿(기본): 12시간 유지');
  // PC: 기간 없는 쿠키 → 브라우저를 모두 닫으면 로그인이 풀림 (서명 안의 12시간 만료는 그대로)
  const pc = client({ 'x-forwarded-proto': 'https', 'x-vb-device': 'pc' });
  await pc.ok('auth', 'login', 'admin', 'admin1234');
  assert.ok(!/Max-Age|Expires/.test(pc.lastCookie), pc.lastCookie);
  assert.equal((await pc.ok('auth', 'me')).user.loginId, 'admin');
  await pc.ok('auth', 'logout');
  assert.match(pc.lastCookie, /Max-Age=0/, 'PC 로그아웃은 쿠키 지움');
  await admin.ok('auth', 'login', 'admin', 'admin1234');
  await manager.ok('auth', 'login', 'manager', 'manager1234');
});

test('비로그인·허용 외 호출 차단', async () => {
  const anon = client();
  assert.equal((await anon('contracts', 'list', {})).status, 401);
  assert.equal((await admin('auth', 'resetDemoData')).status, 400);
  assert.equal((await admin('contracts', '__proto__')).status, 400);
  assert.equal((await admin('nope', 'list')).status, 400);
});

test('실장 권한(본인 계약만): 전체 계약을 보되 다른 사람 계약은 금액 가림·보기만, 통계는 본인 것만, 삭제 불가, 등록하면 바로 승인', async () => {
  assert.equal((await manager.ok('auth', 'me')).user.dataScope, 'own', '샘플 실장은 본인 계약만 설정');
  const all = await admin.ok('contracts', 'list', {});
  const seen = await manager.ok('contracts', 'list', {});
  assert.equal(seen.length, all.length, '실장도 전체 계약이 보임');
  const me = (await manager.ok('auth', 'me')).user;
  const mine = seen.filter((c) => !c.readOnly);
  const others = seen.filter((c) => c.readOnly);
  assert.ok(mine.length > 0 && others.length > 0);
  assert.ok(mine.every((c) => typeof c.totalAmount === 'number' && !c.amountHidden), '본인 계약은 금액 보임');
  assert.ok(others.every((c) => c.amountHidden && c.totalAmount === null && c.payments.length === 0), '다른 사람 계약은 금액·입금 가림');
  assert.ok((await manager.ok('auth', 'me')).user.permissions.every((p) => p !== 'sales.total'), '회사 매출 합계는 체크한 실장만');
  // 다른 사람 계약: 상세·계약서는 보이고(금액 없이), 수정·입금·영수증은 막힘
  const other = others[0];
  const got = await manager.ok('contracts', 'get', other.id);
  assert.ok(got.readOnly && got.amountHidden && got.totalAmount === null);
  const group = await manager.ok('contracts', 'group', other.id);
  assert.ok(group.contracts.every((c) => c.amountHidden || c.ownerId === me.id));
  assert.ok((await manager.ok('contracts', 'signBundle', other.id)).contracts.every((c) => c.amountHidden || c.ownerId === me.id), '계약서도 금액 가림');
  const upd = await manager('contracts', 'update', other.id, { memo: '남의 계약 수정' });
  assert.equal(upd.status, 403, '다른 사람 계약 수정 불가');
  assert.match(upd.error.message, /보기만/);
  assert.equal((await manager('contracts', 'addPayment', other.id, { date: '2026-10-01', kind: '잔금', method: '현금', amount: 1000 })).status, 403);
  assert.equal((await manager('contracts', 'moveToTrash', [mine[0].id])).status, 403);
  const created = await manager.ok('contracts', 'create', { ...base, customerName: '실장고객' });
  assert.equal(created.approval, '승인', '계약승인은 고르지 않고 모두 승인');
  assert.ok(!created.readOnly, '본인이 등록한 계약은 수정 가능');
});

test('동시 계약 등록 10건: 번호 중복 없음', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => admin('contracts', 'create', { ...base, customerName: `동시${i}` })),
  );
  assert.ok(results.every((r) => r.status === 200));
  assert.equal(new Set(results.map((r) => r.result.no)).size, 10);
});

test('계약 수정 시 변경이력 기록, 고객명은 변경 불가', async () => {
  const c = await admin.ok('contracts', 'create', base);
  const updated = await admin.ok('contracts', 'update', c.id, { ...c, customerName: '바꾼이름', status: '배정' });
  assert.equal(updated.customerName, '시험고객');
  const full = await admin.ok('contracts', 'get', c.id);
  const last = full.history.at(-1);
  assert.equal(last.action, '계약 수정');
  assert.ok(last.changes.some((ch) => ch.label === '시공상태' && ch.to === '배정'));
});

test('휴무: 종일/반일 휴무 시간대 배정 차단, 반대 시간대는 허용', async () => {
  const offs = await admin.ok('engineerOffs', 'list', {});
  const dayOff = offs.find((o) => o.period === 'DAY');
  let r = await admin('contracts', 'create', { ...base, schedules: [{ date: dayOff.date, time: '14:00', engineerId: dayOff.engineerId }] });
  assert.equal(r.status, 400);
  assert.match(r.error.message, /종일 휴무/);

  const amOff = offs.find((o) => o.period === 'AM');
  r = await admin('contracts', 'create', { ...base, schedules: [{ date: amOff.date, time: '', engineerId: amOff.engineerId }] });
  assert.equal(r.status, 400, '시간 미정은 반일 휴무와 겹침');
  r = await admin('contracts', 'create', { ...base, schedules: [{ date: amOff.date, time: '09:00', engineerId: amOff.engineerId }] });
  assert.equal(r.status, 400, '오전 휴무에 09:00 배정 불가');
  await admin.ok('contracts', 'create', { ...base, schedules: [{ date: amOff.date, time: '14:00', engineerId: amOff.engineerId }] });
});

test('휴무: 배정된 시간대에는 휴무 등록 불가', async () => {
  const c = await admin.ok('contracts', 'create', { ...base, schedules: [{ date: '2027-01-05', time: '10:00', engineerId: 4 }] });
  assert.ok(c);
  let r = await admin('engineerOffs', 'set', { engineerId: 4, date: '2027-01-05', period: 'AM', reason: '시험' });
  assert.equal(r.status, 400);
  await admin.ok('engineerOffs', 'set', { engineerId: 4, date: '2027-01-05', period: 'PM', reason: '시험' });
});

test('팀배정: 팀원 전원 휴무일 때만 차단', async () => {
  const teams = await admin.ok('teams', 'list');
  const smile = teams.find((t) => t.name === '스마일팀');
  const members = (await admin.ok('engineers', 'list')).filter((e) => e.teamId === smile.id);
  assert.equal(members.length, 2);
  const date = '2027-02-10';
  const team = (time) => ({ ...base, schedules: [{ date, time, assignType: 'team', teamId: smile.id }] });

  await admin.ok('engineerOffs', 'set', { engineerId: members[0].id, date, period: 'AM', reason: '시험' });
  const c = await admin.ok('contracts', 'create', team('09:00')); // 1명만 휴무 → 가능
  let r = await admin('engineerOffs', 'set', { engineerId: members[1].id, date, period: 'AM', reason: '시험' });
  assert.equal(r.status, 400, '팀 일정이 있는 시간대에 마지막 팀원 휴무 불가');

  await admin.ok('contracts', 'moveToTrash', [c.id]);
  await admin.ok('engineerOffs', 'set', { engineerId: members[1].id, date, period: 'AM', reason: '시험' });
  r = await admin('contracts', 'create', team('09:00'));
  assert.equal(r.status, 400, '전원 오전 휴무 → 오전 팀 배정 불가');
  await admin.ok('contracts', 'create', team('14:00'));
});

test('기사모바일: 계약 목록 차단, 본인 일정 보고 → 계약서에 반영', async () => {
  const eng = client();
  const me = await eng.ok('auth', 'login', 'gong', 'gong1234');
  assert.equal(me.user.role, 'ENGINEER');
  assert.equal((await eng('contracts', 'list', {})).status, 403);
  const [s] = await eng.ok('engineerApp', 'mySchedules', { from: '2000-01-01', to: '2100-12-31' });
  await eng.ok('engineerApp', 'report', { contractId: s.contractId, stepIndex: s.stepIndex, mobileStatus: '시공완료', memo: '완료' });
  const c = await admin.ok('contracts', 'get', s.contractId);
  assert.equal(c.schedules[s.stepIndex].mobileStatus, '시공완료');
});

test('전자서명: 링크 조회(내부정보 제외) → 서명 → 이미지는 별도 저장', async () => {
  const [target] = await admin.ok('contracts', 'list', { esignStatus: '미발송' });
  const { token, url: link } = await admin.ok('contracts', 'requestSign', target.id);
  assert.match(link, /^http:\/\/test\.local\/sign\/[\w-]+$/);
  const anon = client({ 'x-forwarded-for': '203.0.113.7' });
  const view = await anon.ok('esign', 'getByToken', token);
  assert.equal(view.contract.history, undefined);
  assert.equal(view.contract.memo, undefined);
  const img = `data:image/png;base64,${'A'.repeat(5000)}`;
  await anon.ok('esign', 'sign', token, { signerName: '고객', signature: img, agreed: true });

  const signed = await admin.ok('contracts', 'get', target.id);
  assert.equal(signed.esign.status, '서명완료');
  assert.equal(signed.esign.signature, img);
  assert.equal(signed.esign.ip, '203.0.113.7');
  const list = await admin.ok('contracts', 'list', {});
  assert.ok(list.every((c) => !c.esign?.signature), '목록에는 서명 이미지 없음');
});

test('로그인 여러 번 실패해도 잠기지 않음, 로그아웃 후 차단', async () => {
  const bad = client();
  for (let i = 0; i < 6; i++) assert.equal((await bad('auth', 'login', 'manager', 'wrong')).status, 400);
  assert.equal((await bad.ok('auth', 'login', 'manager', 'manager1234')).user.loginId, 'manager', '틀린 뒤에도 바로 로그인');

  await admin.ok('auth', 'logout');
  assert.equal((await admin('contracts', 'list', {})).status, 401);
});

test('계약번호: 계약일 순서로 부여, 예전 날짜 계약은 그 위치에 들어감, 목록은 번호순', async () => {
  await admin.ok('auth', 'login', 'admin', 'admin1234'); // 앞 시험에서 로그아웃했으므로 다시 로그인
  const before = await admin.ok('contracts', 'list', {});
  const total = before.length;
  assert.equal(before[0].no, total, '최신 계약 번호 = 전체 건수');
  assert.ok(before.every((c, i) => i === 0 || before[i - 1].no > c.no), '번호 내림차순 정렬');

  const oldest = await admin.ok('contracts', 'create', { ...base, customerName: '오래된계약', contractDate: '2000-01-01' });
  assert.equal(oldest.no, 1, '가장 오래된 계약일 → 1번');
  const after = await admin.ok('contracts', 'list', {});
  assert.equal(after[0].no, total + 1);
  assert.equal(new Set(after.map((c) => c.no)).size, after.length, '번호 중복 없음');

  await admin.ok('contracts', 'moveToTrash', [oldest.id]);
  const trash = await admin.ok('contracts', 'list', { trash: true });
  assert.equal(trash.find((c) => c.id === oldest.id).no, null, '휴지통 계약은 번호 없음');
  assert.equal((await admin.ok('contracts', 'list', {}))[0].no, total);
});

test('계약 상세: 같은 계약자·현장 시공 묶음, 입금/환불/수정/삭제, 상담내역', async () => {
  const site = { ...base, customerName: '묶음고객', customerPhone: '010-7070-8080', aptName: '묶음아파트', dong: '101', ho: '202', totalAmount: 500000 };
  const a = await admin.ok('contracts', 'create', { ...site, category: '줄눈' });
  const b = await admin.ok('contracts', 'create', { ...site, category: '청소', totalAmount: 300000 });
  await admin.ok('contracts', 'create', { ...site, ho: '999', category: '탄성' }); // 다른 호수 → 다른 묶음

  const g = await admin.ok('contracts', 'group', a.id);
  assert.deepEqual(g.contracts.map((c) => c.id).sort(), [a.id, b.id].sort());
  assert.equal(g.otherContracts.length, 1, '같은 계약자의 다른 현장');

  let c = await admin.ok('contracts', 'addPayment', a.id, { kind: '계약금', method: '카드', amount: 100000, cardLast4: '1234-5678-9012-3456' });
  assert.equal(c.payments[0].cardLast4, '3456', '카드번호는 끝 4자리만 저장');
  c = await admin.ok('contracts', 'addPayment', a.id, { kind: '환불', method: '계좌이체', amount: 20000 });
  const { calcAmounts } = await import('../frontend/src/utils/contract.js');
  let amt = calcAmounts(c);
  assert.equal(amt.paid, 100000);
  assert.equal(amt.refund, 20000);
  assert.equal(amt.balance, 500000 - (100000 - 20000));

  c = await admin.ok('contracts', 'updatePayment', a.id, c.payments[0].id, { ...c.payments[0], amount: 150000 });
  assert.equal(calcAmounts(c).paid, 150000);
  c = await admin.ok('contracts', 'removePayment', a.id, c.payments[1].id);
  assert.equal(calcAmounts(c).refund, 0);
  assert.ok(c.history.some((h) => h.action === '입금 수정'));

  assert.ok([403, 404].includes((await manager('contracts', 'addPayment', a.id, { amount: 1000 })).status), '본인 계약이 아닌 실장은 입금 등록 불가');

  await admin.ok('contracts', 'addNote', b.id, '고객 통화: 오전 선호');
  const g2 = await admin.ok('contracts', 'group', a.id);
  assert.equal(g2.notes[0].text, '고객 통화: 오전 선호');
  assert.equal(g2.notes[0].category, '청소');
});

test('기사관리: 담당시공 여러 개, 주소(우편번호·상세), 예전 기사 데이터 호환', async () => {
  const list = await admin.ok('engineers', 'list', { includeInactive: true });
  assert.ok(list.every((e) => Array.isArray(e.categories)), '예전 기사도 categories 로 내려줌');
  const saved = await admin.ok('engineers', 'save', {
    name: '황선근',
    phone: '01044492514',
    categories: ['청소', '줄눈', '없는품목'],
    zipcode: '06133',
    address: '서울특별시 강남구 테헤란로 123',
    addressDetail: '101호',
  });
  assert.deepEqual(saved.categories, ['줄눈', '청소']);
  assert.equal(saved.category, '줄눈·청소');
  assert.equal(saved.phone, '010-4449-2514');
  assert.equal(saved.zipcode, '06133');
  assert.equal(saved.addressDetail, '101호');
  await admin.ok('engineerOffs', 'set', { engineerId: saved.id, date: '2027-02-10', period: 'DAY', reason: '개인' });
  const offs = await admin.ok('engineerOffs', 'list', { engineerId: saved.id, from: '2027-02-01', to: '2027-02-28' });
  assert.equal(offs.length, 1);
});

test('기사 아이디 변경: 업체 관리자만, 바꾼 아이디로 로그인(비밀번호 그대로), 실장은 불가', async () => {
  const e = await admin.ok('engineers', 'save', { name: '아이디변경기사', phone: '010-5151-6262', loginId: 'oldengid', password: 'eng5151' });
  const moved = await admin.ok('engineers', 'save', { ...e, loginId: 'newengid' });
  assert.equal(moved.loginId, 'newengid');
  assert.equal(moved.hasPassword, true, '비밀번호 유지');
  assert.equal((await client()('auth', 'login', 'oldengid', 'eng5151')).status, 400, '예전 아이디는 안 됨');
  assert.equal((await client().ok('auth', 'login', 'newengid', 'eng5151')).user.role, 'ENGINEER');
  await admin.ok('engineers', 'save', { name: '중복확인기사', phone: '010-5151-7373', loginId: 'dupengid', password: 'dup5151' });
  assert.equal((await admin('engineers', 'save', { ...moved, loginId: 'dupengid' })).status, 400, '다른 기사와 같은 아이디는 불가');

  await admin.ok('users', 'create', { loginId: 'engsetmgr', password: 'engset1234', name: '기사관리실장', permissions: ['settings.manage'] });
  const mgr = client();
  await mgr.ok('auth', 'login', 'engsetmgr', 'engset1234');
  assert.equal((await mgr('engineers', 'save', { ...moved, loginId: 'mgrchanged' })).status, 403, '실장은 아이디 변경 불가');
  assert.equal((await mgr.ok('engineers', 'save', { ...moved, memo: '실장 메모' })).loginId, 'newengid', '다른 항목은 수정 가능');
});

test('로그인 주소로 구분: 기사 아이디와 직원 아이디가 같아도 됨 (/m 은 기사, 일반 화면은 직원 우선)', async () => {
  await admin.ok('users', 'create', { loginId: 'twin0955', password: 'staff0955', name: '겸직직원' });
  const e = await admin.ok('engineers', 'save', { name: '겸직기사', phone: '010-0955-0955', loginId: 'twin0955', password: 'eng0955' });
  assert.equal(e.loginId, 'twin0955', '직원과 같은 아이디로 기사 등록 가능');
  assert.equal((await admin('users', 'create', { loginId: 'twin0955', password: 'x12345', name: '중복직원' })).status, 400, '직원끼리는 중복 불가');

  const staff = client();
  assert.equal((await staff.ok('auth', 'login', 'twin0955', 'staff0955', '', 'staff')).user.role, 'MANAGER', '일반 화면 → 직원');
  const eng = client();
  assert.equal((await eng.ok('auth', 'login', 'twin0955', 'eng0955', '', 'engineer')).user.role, 'ENGINEER', '/m → 기사');
  assert.equal((await client()('auth', 'login', 'twin0955', 'eng0955', '', 'staff')).status, 400, '일반 화면에서는 직원 비밀번호');
  assert.equal((await client()('auth', 'login', 'twin0955', 'staff0955', '', 'engineer')).status, 400, '/m 에서는 기사 비밀번호');
  // 직원 계정이 없는 기사 아이디는 일반 화면에서도 기사로 (예전처럼)
  await admin.ok('engineers', 'save', { name: '기사만', phone: '010-0956-0956', loginId: 'onlyeng', password: 'only0956' });
  assert.equal((await client().ok('auth', 'login', 'onlyeng', 'only0956', '', 'staff')).user.role, 'ENGINEER');
  // /t(상담실장)는 직원 계정만 — 기사 아이디로는 안 됨
  assert.equal((await client().ok('auth', 'login', 'twin0955', 'staff0955', '', 'manager')).user.role, 'MANAGER', '/t → 직원');
  assert.equal((await client()('auth', 'login', 'onlyeng', 'only0956', '', 'manager')).status, 400, '/t 에서는 기사 로그인 불가');
  // /m 에서는 직원 계정으로 로그인 불가
  assert.equal((await client()('auth', 'login', 'admin', 'admin1234', '', 'engineer')).status, 400);
});

test('한 브라우저에서 따로 로그인: 일반 화면 · 상담실장(/t) · 기사모바일(/m) 탭이 서로의 로그인을 바꾸지 않음', async () => {
  await admin.ok('engineers', 'save', { name: '탭기사', phone: '010-0957-0957', loginId: 'tabeng', password: 'tab0957' });
  let cookie = '';
  const tab = (app) => async (service, method, ...args) => {
    const out = await handleRpc({ body: { service, method, args }, headers: { cookie, host: 'test.local', ...(app ? { 'x-vb-app': app } : {}) } });
    const set = out.headers['Set-Cookie'];
    if (set) cookie = set.split(';')[0].replace(/^uffice_session=$/, '');
    return { status: out.status, ...JSON.parse(out.body) };
  };
  const general = tab('');
  const consult = tab('manager');
  const mobile = tab('engineer');
  assert.equal((await general('auth', 'login', 'admin', 'admin1234', '', 'staff')).result.user.role, 'ADMIN');
  assert.equal((await mobile('auth', 'me')).status, 401, '기사 탭은 따로 로그인해야 함');
  assert.equal((await consult('auth', 'me')).status, 401, '상담실장 탭도 따로');
  assert.equal((await mobile('auth', 'login', 'tabeng', 'tab0957', '', 'engineer')).result.user.role, 'ENGINEER');
  assert.equal((await consult('auth', 'login', 'manager', 'manager1234', '', 'manager')).result.user.role, 'MANAGER');
  assert.equal((await general('auth', 'me')).result.user.role, 'ADMIN', '일반 탭은 그대로 관리자');
  assert.equal((await mobile('auth', 'me')).result.user.role, 'ENGINEER');
  assert.equal((await consult('auth', 'me')).result.user.role, 'MANAGER');
  // 기사 탭 로그아웃 → 다른 탭은 그대로
  await mobile('auth', 'logout');
  assert.equal((await mobile('auth', 'me')).status, 401);
  assert.equal((await general('auth', 'me')).result.user.role, 'ADMIN');
  assert.equal((await consult('auth', 'me')).result.user.role, 'MANAGER');
  // 일반 탭 로그아웃 → 상담실장 탭은 그대로
  await general('auth', 'logout');
  assert.equal((await general('auth', 'me')).status, 401);
  assert.equal((await consult('auth', 'me')).result.user.role, 'MANAGER');
  // 예전 쿠키(칸 나누기 전 기사 로그인): 기사 탭에서도 그대로 로그인 상태 (다시 로그인 안 해도 됨)
  cookie = '';
  await general('auth', 'login', 'tabeng', 'tab0957', '', 'engineer'); // 머리글 없이 = 예전 방식으로 맨 위에 기사 로그인
  assert.equal((await mobile('auth', 'me')).result.user.role, 'ENGINEER', '예전 기사 로그인은 기사 탭에서 유지');
  await general('auth', 'login', 'admin', 'admin1234', '', 'staff');
  assert.equal((await mobile('auth', 'me')).result.user.role, 'ENGINEER', '일반 탭에서 로그인해도 기사 로그인은 그대로');
});

test('수정로그: 누가 무엇을 바꿨는지 기록, 관리자만 조회, 로그인은 기록 안 함, 2주 지난 기록은 지움', async () => {
  const { getPool } = await import('../server/pg.js');
  const companyId = (await admin.ok('auth', 'me')).user.companyId;
  const who = `로그고객${Date.now() % 100000}`; // 시험 DB 에 남은 예전 기록과 섞이지 않게
  const c = await admin.ok('contracts', 'create', { ...base, customerName: who, customerPhone: '010-1212-3434' });
  const full = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...full, customerPhone: '010-1212-9999', memo: '로그 확인', contractDate: '2026-09-28' });
  await client().ok('auth', 'login', 'admin', 'admin1234');

  const { rows } = await admin.ok('auditLogs', 'list', { q: who });
  const edit = rows.find((r) => r.action === '계약 수정');
  assert.ok(edit, '계약 수정 기록');
  assert.equal(edit.actor.loginId, 'admin');
  const item = edit.items.find((i) => i.target.startsWith(`계약 ${who}`) && i.fields);
  assert.ok(item.fields.some((f) => f.label === '계약일' && f.from === '2026-09-27' && f.to === '2026-09-28'), '업무 값은 이전 → 이후');
  const phone = item.fields.find((f) => f.label === '연락처①');
  assert.ok(phone && phone.from === undefined && phone.to === undefined, '연락처는 변경만, 값은 남기지 않음');
  assert.ok(!JSON.stringify(rows).includes('010-1212-9999'), '기록 어디에도 새 연락처 값 없음');
  assert.ok(item.fields.some((f) => f.label === '메모' && f.from === undefined));
  assert.ok(rows.some((r) => r.action === '계약 등록'));
  const all = (await admin.ok('auditLogs', 'list', {})).rows;
  assert.ok(!all.some((r) => r.call === 'auth.login'), '로그인은 기록 안 함');

  await admin.ok('users', 'create', { loginId: 'logviewmgr', password: 'logview1234', name: '로그실장' });
  const mgr = client();
  await mgr.ok('auth', 'login', 'logviewmgr', 'logview1234');
  assert.equal((await mgr('auditLogs', 'list', {})).status, 403, '실장은 조회 불가');

  // 2주 지난 기록은 다음 저장 때 지워짐
  await getPool().query(`INSERT INTO audit_logs (company_id, created_at, data) VALUES ($1, now() - interval '15 days', '{"action":"옛기록","items":[]}'::jsonb)`, [companyId]);
  await admin.ok('contracts', 'update', c.id, { ...(await admin.ok('contracts', 'get', c.id)), memo: '로그 확인2' });
  const { rows: left } = await getPool().query(`SELECT count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND data->>'action' = '옛기록'`, [companyId]);
  assert.equal(left[0].n, 0);
});

test('실물 계약서 사진: 추가·보기·삭제, 최대 10장, 계약 수정·입금 변경에도 유지, 기사는 못 봄', async () => {
  const img = 'data:image/jpeg;base64,' + Buffer.from('paper-contract').toString('base64');
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '종이계약', customerPhone: '010-5656-7878' });
  let v = await admin.ok('contracts', 'setPaperPhotos', c.id, { add: [img, img] });
  assert.equal(v.paperPhotoCount, 2);
  const list = await admin.ok('contracts', 'paperPhotos', c.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].image, img);

  // 계약 수정(입금 줄 바뀜)에도 실물 계약서 사진은 그대로
  const full = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...full, payments: [{ kind: '계약금', method: '현금', amount: 10000, date: '2026-10-01' }] });
  await admin.ok('contracts', 'update', c.id, { ...(await admin.ok('contracts', 'get', c.id)), payments: [] });
  assert.equal((await admin.ok('contracts', 'paperPhotos', c.id)).length, 2, '입금 정리 때 지워지지 않음');
  assert.equal((await admin.ok('contracts', 'get', c.id)).paperPhotoCount, 2);

  v = await admin.ok('contracts', 'setPaperPhotos', c.id, { remove: [list[0].id] });
  assert.equal(v.paperPhotoCount, 1);
  const tooMany = await admin('contracts', 'setPaperPhotos', c.id, { add: Array(10).fill(img) });
  assert.equal(tooMany.status, 400, '최대 10장');
  assert.equal((await admin('contracts', 'setPaperPhotos', c.id, { add: ['not-an-image'] })).status, 400);
  assert.ok((await admin.ok('contracts', 'get', c.id)).history.some((h) => h.action === '실물 계약서 사진'));

  const eng = client();
  await eng.ok('auth', 'login', 'gong', 'gong1234', '', 'engineer');
  assert.notEqual((await eng('contracts', 'paperPhotos', c.id)).status, 200, '기사는 사무실용 기능으로는 못 봄');
  assert.equal((await eng('engineerApp', 'paperPhotos', c.id)).status, 403, '배정 안 된 계약은 못 봄');
  // 기사에게 배정하면 기사모바일에서 보기 가능
  const gongId = (await admin.ok('engineers', 'list')).find((e) => e.loginId === 'gong').id;
  const cur = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...cur, schedules: [{ date: '2027-04-12', time: '09:00', assignType: 'engineer', engineerId: gongId }] });
  const mine = await eng.ok('engineerApp', 'contract', c.id);
  assert.equal(mine.contracts.find((x) => x.id === c.id).paperPhotoCount, 1);
  const seen = await eng.ok('engineerApp', 'paperPhotos', c.id);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].image, img);
});

test('서버 연결 점검(/api/rpc GET): 비밀값은 숨기고 설정·DB 상태만 표시', async () => {
  const r = await healthReport();
  assert.equal(r.DB연결, '정상');
  assert.match(r.계정, /운영자 1개/);
  assert.equal(r.설정값.DATABASE_URL, '있음');
  assert.ok(!JSON.stringify(r).includes(process.env.SESSION_SECRET));
  assert.ok(!JSON.stringify(r).includes(process.env.INIT_SUPER_PASSWORD));
});

test('업체 주소 코드: 로그인 화면 조회, 그 업체 계정만 로그인, 코드 중복·형식 검사', async () => {
  const anon = client();
  const pub = await anon.ok('companies', 'publicInfo', 'thegood');
  assert.equal(pub.name, '더좋은집');
  assert.match(pub.periodEnd, /^\d{4}-\d{2}-\d{2}$/, '로그인 화면에 이용기간(끝나는 날) 표시');
  assert.deepEqual(Object.keys(pub).sort(), ['code', 'name', 'periodEnd', 'periodStart'], '로그인 전에는 이름·이용기간만');
  assert.equal(await anon.ok('companies', 'publicInfo', 'nope'), null);

  const sup = client();
  await sup.ok('auth', 'login', 'super', 'super-test-1234');
  const other = await sup.ok('companies', 'create', {
    company: { code: 'Other-Co', name: '다른업체', periodStart: '2026-01-01', periodEnd: '2027-12-31' },
    admin: { loginId: 'otheradmin', password: 'other1234', name: '다른관리자' },
  });
  assert.equal(other.code, 'other-co', '소문자로 저장');
  assert.equal((await sup('companies', 'create', {
    company: { code: 'thegood', name: '중복', periodStart: '2026-01-01', periodEnd: '2027-12-31' },
    admin: { loginId: 'dup1', password: 'dup12345', name: '중복' },
  })).status, 400, '이미 쓰는 코드');
  assert.equal((await sup('companies', 'update', other.id, { code: 'admin' })).status, 400, '예약어');
  assert.equal((await sup('companies', 'update', other.id, { code: '한글' })).status, 400, '형식');

  const a = client();
  assert.equal((await a('auth', 'login', 'admin', 'admin1234', 'other-co')).status, 400, '다른 업체 주소에서는 로그인 불가');
  assert.equal((await a('auth', 'login', 'admin', 'admin1234', 'nope')).status, 400, '없는 업체 주소');
  const me = await a.ok('auth', 'login', 'admin', 'admin1234', 'thegood');
  assert.equal(me.company.code, 'thegood');
  const e = client();
  assert.equal((await e('auth', 'login', 'gong', 'gong1234', 'other-co')).status, 400, '기사도 자기 업체 주소에서만');
  await e.ok('auth', 'login', 'gong', 'gong1234', 'thegood');
  await a.ok('auth', 'login', 'otheradmin', 'other1234', 'other-co');

  // 한 브라우저에서 두 업체 주소에 각각 로그인: 서로의 로그인을 바꾸지 않음 (x-vb-co 로 업체 칸을 나눔)
  {
    let cookie = '';
    const as = (co) => async (service, method, ...args) => {
      const out = await handleRpc({ body: { service, method, args }, headers: { cookie, host: 'test.local', 'x-vb-co': co } });
      const sc = out.headers['Set-Cookie'];
      if (sc) cookie = sc.split(';')[0];
      return { status: out.status, ...JSON.parse(out.body) };
    };
    const good = as('thegood');
    const oth = as('other-co');
    assert.equal((await good('auth', 'login', 'admin', 'admin1234', 'thegood')).status, 200);
    assert.equal((await oth('auth', 'me')).status, 401, '다른 업체 주소에서는 아직 로그인 전');
    assert.equal((await oth('auth', 'login', 'otheradmin', 'other1234', 'other-co')).status, 200);
    assert.equal((await good('auth', 'me')).result.user.loginId, 'admin', '첫 업체 로그인은 그대로');
    assert.equal((await oth('auth', 'me')).result.user.loginId, 'otheradmin');
    await oth('auth', 'logout');
    assert.equal((await oth('auth', 'me')).status, 401);
    assert.equal((await good('auth', 'me')).result.user.loginId, 'admin', '다른 업체 로그아웃은 영향 없음');
    // 예전 쿠키(업체 칸 없음)는 그 업체 화면에서 그대로 로그인 유지, 다른 업체 화면에서는 그 업체 계정이 아니면 로그인 안 된 것으로
    const legacy = client();
    await legacy.ok('auth', 'login', 'admin', 'admin1234');
    const legacyCookie = legacy.lastCookie.split(';')[0];
    const same = await handleRpc({ body: { service: 'auth', method: 'me', args: [] }, headers: { cookie: legacyCookie, host: 'test.local', 'x-vb-co': 'thegood' } });
    assert.equal(same.status, 200, '배포 전 로그인은 그 업체 화면에서 그대로');
    const peek = await handleRpc({ body: { service: 'auth', method: 'me', args: [] }, headers: { cookie: legacyCookie, host: 'test.local', 'x-vb-co': 'other-co' } });
    assert.equal(peek.status, 401, '다른 업체 계정 쿠키로는 그 업체 화면을 못 씀');
    assert.ok(!peek.headers['Set-Cookie'], '원래 업체 로그인은 지우지 않음');
  }
});

test('데이터 가져오기: 기사 목록 + 예전 계약 파일(중복 없이, 기사 자동 연결)', async () => {
  const { parseLegacyHtml, mapLegacyRow } = await import('../frontend/src/utils/legacyImport.js');
  const row = (no, brand, cat, name, site, date1, who1, status) => `<tr>
    <td>${no}</td><td>${brand}</td><td>${cat}</td><td>박람</td><td>시공</td><td>${status}</td><td>2026-05-01</td>
    <td>${name}(승인)</td><td>010-1111-2222</td><td>${site}</td><td>84A</td>
    <!--<td>욕실2개 + 현관</td><td>주방 벽타일</td>--><!--<td>후기 조건</td><td>실리콘 서비스</td>-->
    <td>1,000,000</td><td>할인금액 : 100,000</td><td>상품권 : 0</td><td>900,000</td><td>300,000</td><td>600,000</td>
    <td>① : ${date1}</td><td>② : </td><td>${status}</td><td>① : ${who1}</td><td>② : </td><td>현관 먼저</td><!--<td>잔금 메모</td>--><td></td><td></td><td></td></tr>`;
  const html = `<table><thead><tr><td>번호</td></tr></thead><tbody>
    ${row(9001, '더좋은집', '줄눈', '추가)가져오기고객', '시험아파트101-1001호', '2026-06-01(9:00)', '줄)가져온기사', '미정')}
    ${row(9002, '신화홈케어', '청소', '가져오기고객2', '-', '(무관)', '', '취소')}
  </tbody></table>`;
  const rows = parseLegacyHtml(html).map(mapLegacyRow);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].customerName, '가져오기고객');
  assert.deepEqual([rows[0].aptName, rows[0].dong, rows[0].ho], ['시험아파트', '101', '1001']);
  assert.equal(rows[0].schedules[0].time, '09:00');
  assert.match(rows[0].items, /욕실2개/);

  const eng = await admin.ok('imports', 'engineers', [{ name: '청)이관기사', loginId: 'importeng', phone: '010-3333-4444' }]);
  assert.equal(eng.created, 1);
  const r1 = await admin.ok('imports', 'contracts', rows);
  assert.equal(r1.created, 2, JSON.stringify(r1.errors));
  assert.deepEqual(r1.newEngineers, ['줄)가져온기사']);
  assert.deepEqual(r1.newBrands, ['신화홈케어']);
  const r2 = await admin.ok('imports', 'contracts', rows);
  assert.equal(r2.created, 0);
  assert.equal(r2.skipped, 2, '같은 예전 번호는 건너뜀');

  const list = await admin.ok('contracts', 'list', { keyword: '가져오기고객' });
  const c = (list.items || list).find((x) => x.customerName === '가져오기고객');
  assert.ok(c.schedules[0].engineerId, '시공담당 기사 연결');
  assert.equal((await manager('imports', 'contracts', rows)).status, 403, '실장은 가져오기 불가');
});

test('트래픽 절약: 가벼운 요청은 필요한 표만 읽고, 다른 데이터는 지우지 않음', async () => {
  const before = (await admin.ok('contracts', 'list', {})).length;
  const me = await admin.ok('auth', 'me');
  assert.equal(me.company.code, 'thegood');
  assert.ok((await admin.ok('teams', 'list')).length > 0, '팀 목록은 팀 표만 읽어도 나옴');
  assert.ok((await admin.ok('engineers', 'list')).length > 0);
  await admin.ok('auth', 'changePassword', 'admin1234', 'admin1234');
  const after = (await admin.ok('contracts', 'list', {})).length;
  assert.ok(before > 0);
  assert.equal(after, before, '가벼운 요청 뒤에도 계약 데이터 그대로');
});

test('할인 적용: 금액·상품권·사유 저장, 변경이력, 총액 초과 차단, 실장(금액권한 없음) 사유 숨김', async () => {
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '할인고객', customerPhone: '010-7777-1212', totalAmount: 1000000 });
  const d = await admin.ok('contracts', 'setDiscount', c.id, { discount: 100000, voucher: 50000, discountReason: '잔금 현금 할인' });
  assert.equal(d.discount, 100000);
  assert.equal(d.voucher, 50000);
  assert.equal(d.discountReason, '잔금 현금 할인');
  assert.equal(d.history.at(-1).action, '할인 적용');
  assert.equal((await admin('contracts', 'setDiscount', c.id, { discount: 2000000 })).status, 400, '총액보다 큰 할인 차단');
  const m = await manager('contracts', 'get', c.id);
  if (m.status === 200) assert.equal(m.result.discountReason, null, '금액 권한 없으면 사유도 숨김');
});

test('입금 영수증 사진: 첨부·보기·교체·삭제, 계약 목록에는 사진 없이 표시만', async () => {
  const img = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '영수증고객', customerPhone: '010-7777-3434', totalAmount: 500000 });
  let v = await admin.ok('contracts', 'addPayment', c.id, { date: '2026-09-29', kind: '잔금', method: '카드', amount: 200000, receiptImage: img });
  const p = v.payments.at(-1);
  assert.equal(p.hasReceipt, true);
  assert.equal(p.receiptImage, undefined, '계약 데이터에는 사진을 넣지 않음');
  assert.equal((await admin.ok('contracts', 'receipt', c.id, p.id)).image, img);
  const list = await admin.ok('contracts', 'list', { keyword: '영수증고객' });
  assert.ok(!JSON.stringify(list).includes('fake'), '목록 응답에 사진 없음');
  v = await admin.ok('contracts', 'updatePayment', c.id, p.id, { ...p, amount: 210000 });
  assert.equal(v.payments.at(-1).hasReceipt, true, '사진 그대로 두고 금액만 수정');
  assert.equal((await admin('contracts', 'addPayment', c.id, { amount: 1000, receiptImage: 'data:text/html;base64,AAAA' })).status, 400, '사진 파일만 허용');
  v = await admin.ok('contracts', 'updatePayment', c.id, p.id, { ...p, receiptImage: null });
  assert.equal(v.payments.at(-1).hasReceipt, false);
  assert.equal((await admin('contracts', 'receipt', c.id, p.id)).status, 404);
});

test('계약 목록은 가볍게: 긴 글·변경이력 없이 보내고, 금액·일정은 그대로 / 상세·수정에는 전체', async () => {
  const c = await admin.ok('contracts', 'create', {
    ...base,
    customerName: '목록고객',
    customerPhone: '010-7777-5656',
    totalAmount: 800000,
    memo: '내부 메모 긴 글',
    engineerNote: '현관 비밀번호',
  });
  await admin.ok('contracts', 'addPayment', c.id, { date: '2026-09-30', kind: '계약금', method: '계좌이체', amount: 100000, memo: '입금자 홍길동' });
  const row = (await admin.ok('contracts', 'list', {})).find((x) => x.id === c.id);
  assert.ok(row, '목록에 나옴');
  for (const k of ['history', 'memo', 'engineerNote', 'happyCallMemo']) assert.equal(row[k], undefined, `목록에는 ${k} 없음`);
  assert.equal(row.totalAmount, 800000);
  assert.deepEqual(row.payments, [{ amount: 100000, method: '계좌이체', kind: '계약금' }], '입금은 금액·방법·항목만');
  assert.equal(row.esign.status, c.esign.status);
  assert.equal(row.no, c.no);
  const stats = (await admin.ok('reports', 'contracts', {})).find((x) => x.id === c.id);
  assert.equal(stats?.memo, undefined, '통계도 가볍게');
  const full = await admin.ok('contracts', 'get', c.id);
  assert.equal(full.memo, '내부 메모 긴 글', '상세에는 전체');
  assert.equal(full.engineerNote, '현관 비밀번호');
  assert.ok(full.history.length >= 2);
  // 목록 조회 뒤에도 저장된 데이터는 그대로 (가볍게 읽은 것이 저장되지 않음)
  await admin.ok('contracts', 'update', c.id, { ...full, happyCallMemo: '해피콜 완료' });
  const again = await admin.ok('contracts', 'get', c.id);
  assert.equal(again.memo, '내부 메모 긴 글');
  assert.equal(again.happyCallMemo, '해피콜 완료');
});

test('회사 매출 합계: 권한 없는 실장은 통계에 금액이 없고, 관리자가 허락하면 보임', async () => {
  const boss = client();
  await boss.ok('auth', 'login', 'admin', 'admin1234');
  await boss.ok('users', 'create', {
    role: 'MANAGER',
    loginId: 'salesmgr',
    password: 'sales1234',
    name: '상담실장',
    permissions: ['contract.view', 'contract.amount', 'stats.view'],
    dataScope: 'all',
  });
  const mgr = client();
  await mgr.ok('auth', 'login', 'salesmgr', 'sales1234');
  const rows = await mgr.ok('reports', 'contracts', {});
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.totalAmount === null && r.payments.length === 0), '통계 데이터에 금액 없음');
  const list = await mgr.ok('contracts', 'list', {});
  assert.ok(list.some((r) => r.totalAmount > 0), '계약별 금액(금액 권한)은 그대로 보임');
  const u = (await boss.ok('users', 'list')).find((x) => x.loginId === 'salesmgr');
  await boss.ok('users', 'update', u.id, { permissions: [...u.permissions, 'sales.total'] });
  await mgr.ok('auth', 'login', 'salesmgr', 'sales1234');
  assert.ok((await mgr.ok('reports', 'contracts', {})).some((r) => r.totalAmount > 0), '허락 후에는 통계 금액 보임');
});

test('입금 영수증 사진 여러 장: 추가·일부 삭제·최대 5장, 계약 수정 뒤에도 사진 수 유지', async () => {
  const img = (n) => 'data:image/jpeg;base64,' + Buffer.from(`fake-jpeg-${n}`).toString('base64');
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '여러장고객', customerPhone: '010-7777-9090', totalAmount: 900000 });
  let v = await admin.ok('contracts', 'addPayment', c.id, { date: '2026-10-01', kind: '계약금', method: '카드', amount: 300000, receiptImages: [img(1), img(2)] });
  let p = v.payments.at(-1);
  assert.equal(p.receiptCount, 2);
  let r = await admin.ok('contracts', 'receipt', c.id, p.id);
  assert.deepEqual(r.images.map((x) => x.image), [img(1), img(2)]);
  v = await admin.ok('contracts', 'updatePayment', c.id, p.id, { ...p, receiptImages: [img(3)], removeReceiptIds: [r.images[0].id] });
  p = v.payments.at(-1);
  assert.equal(p.receiptCount, 2, '1장 지우고 1장 추가');
  r = await admin.ok('contracts', 'receipt', c.id, p.id);
  assert.deepEqual(r.images.map((x) => x.image), [img(2), img(3)]);
  const tooMany = await admin('contracts', 'updatePayment', c.id, p.id, { ...p, receiptImages: [img(4), img(5), img(6), img(7)] });
  assert.equal(tooMany.status, 400, '5장 넘으면 거절');
  const full = await admin.ok('contracts', 'get', c.id);
  const fp = full.payments.find((x) => x.id === p.id);
  const after = await admin.ok('contracts', 'update', c.id, { ...full, payments: full.payments.map((x) => (x.id === p.id ? { ...x, receiptCount: 0, hasReceipt: false } : x)) });
  assert.equal(after.payments.find((x) => x.id === fp.id).receiptCount, 2, '화면 값과 관계없이 실제 사진 수 유지');
  assert.equal((await admin.ok('contracts', 'receipt', c.id, p.id)).images.length, 2);
});

test('계약 수정 화면 입금 줄 사진: paymentPhotos 로 추가·삭제, 변경이력 기록', async () => {
  const img = (n) => 'data:image/jpeg;base64,' + Buffer.from(`pay-photo-${n}`).toString('base64');
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '줄사진고객', customerPhone: '010-7777-8080', totalAmount: 500000, payments: [{ date: '2026-10-01', kind: '계약금', method: '카드', amount: 100000 }] });
  const pid = c.payments[0].id;
  let v = await admin.ok('contracts', 'paymentPhotos', c.id, pid, { add: [img(1), img(2)] });
  assert.equal(v.payments[0].receiptCount, 2);
  assert.equal(v.history.at(-1).action, '영수증 사진 변경');
  const r = await admin.ok('contracts', 'receipt', c.id, pid);
  v = await admin.ok('contracts', 'paymentPhotos', c.id, pid, { remove: [r.images[0].id] });
  assert.equal(v.payments[0].receiptCount, 1);
  assert.equal((await manager('contracts', 'paymentPhotos', c.id, pid, { add: [img(3)] })).status >= 400, true, '권한 없는 실장 차단');
});

test('고객 참고사항: 저장·이력, 서명 링크(고객)에는 보이고 내부 메모는 숨김, 서명 후 고쳐도 다시 서명 안 받음', async () => {
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '참고고객', customerPhone: '010-7777-4545', memo: '내부 메모', customerNote: '시공 후 24시간 물 사용 금지' });
  assert.equal(c.customerNote, '시공 후 24시간 물 사용 금지');
  const { url } = await admin.ok('contracts', 'requestSign', c.id);
  const token = url.split('/sign/')[1];
  const anon = client();
  const view = await anon.ok('esign', 'getByToken', token);
  assert.equal(view.contract.customerNote, '시공 후 24시간 물 사용 금지', '고객 화면에 보임');
  assert.equal(view.contract.memo, undefined, '내부 메모는 숨김');
  await anon.ok('esign', 'sign', token, { signerName: '참고고객', signature: 'data:image/png;base64,AAAA', agreed: true });
  const full = await admin.ok('contracts', 'get', c.id);
  const u = await admin.ok('contracts', 'update', c.id, { ...full, customerNote: '바뀐 안내', totalAmount: (full.totalAmount || 0) + 10000 });
  assert.equal(u.esign.status, '서명완료', '서명 뒤 고쳐도 서명완료 그대로');
  assert.equal((await anon.ok('esign', 'getByToken', token)).contract.customerNote, '바뀐 안내', '보낸 서명 링크도 그대로 열림 (고친 내용으로)');
  assert.ok(u.history.at(-1).changes.some((ch) => ch.label === '고객 참고사항'));
  const row = (await admin.ok('contracts', 'list', {})).find((x) => x.id === c.id);
  assert.equal(row.customerNote, undefined, '목록에는 안 보냄');
});

test('서명 링크가 계속 열림: 다시 요청 전 예전 링크, 고객확인페이지 값으로 /e 열기, 서명 링크 값으로 고객확인페이지 열기, 예전에 풀린 서명 되돌리기', async () => {
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '링크고객', customerPhone: '010-7878-1212', category: '나노코팅' });
  const first = (await admin.ok('contracts', 'requestSign', c.id)).url.split('/sign/')[1];
  const second = (await admin.ok('contracts', 'requestSign', c.id)).url.split('/sign/')[1];
  assert.notEqual(first, second);
  const anon = client();
  assert.equal((await anon.ok('esign', 'getByToken', first)).contract.id, c.id, '다시 요청하기 전에 보낸 링크도 열림');
  const { token: custToken } = await admin.ok('contracts', 'customerLink', c.id);
  assert.equal((await anon.ok('esign', 'getByToken', custToken)).contract.id, c.id, '계약완료 알림톡 값(고객확인페이지)으로 /e 열어도 계약서');
  await anon.ok('esign', 'sign', first, { signerName: '링크고객', signature: 'data:image/png;base64,QkJC', agreed: true });
  assert.equal((await admin.ok('contracts', 'get', c.id)).esign.status, '서명완료', '예전 링크로 서명해도 됨');
  const phone = client();
  assert.ok((await phone.ok('customerApp', 'linkLogin', second)).contracts.some((x) => x.id === c.id), '서명 링크 값으로 고객확인페이지 열기');
  assert.equal((await client()('esign', 'getByToken', 'no-such-token')).status, 404);
  // 알림톡: 화면이 링크 값(#{ecode})을 비운 채 보내도 서버가 채움 → /e/?q= 빈 링크로 나가지 않음
  await admin.ok('notifications', 'send', { contractId: c.id, template: '계약완료', templateKey: '계약완료', variables: { 고객명: '링크고객', ecode: '' }, buttons: [{ name: '내 계약 확인', url: 'https://veritybase.vercel.app/thegood/c/?q=' }], target: '고객', brand: '더좋은집', receiverName: '링크고객', receiverPhone: '010-7878-1212', message: 'x' });
  await admin.ok('notifications', 'send', { contractId: c.id, template: '서명요청', templateKey: '서명요청', variables: { 고객명: '링크고객', ecode: 'wrong-value' }, buttons: [], target: '고객', brand: '더좋은집', receiverName: '링크고객', receiverPhone: '010-7878-1212', message: 'x' });
  const logs = await admin.ok('notifications', 'history', c.id);
  const [doneLog, signLog] = logs.slice(-2);
  assert.equal(doneLog.variables.ecode, custToken, '계약완료: 비어 있으면 고객확인페이지 값');
  assert.ok(doneLog.buttons[0].url.endsWith(`?q=${custToken}`), '기록된 버튼 주소에도 값');
  assert.equal(signLog.variables.ecode, second, '서명요청: 이 계약 것이 아닌 값이면 지금 서명 링크 값');
  for (const v of [doneLog.variables.ecode, signLog.variables.ecode]) assert.equal((await client().ok('esign', 'getByToken', v)).contract.id, c.id, '보낸 값으로 /e 열림');

  // 예전 규칙으로 서명이 풀린 계약 → 서명완료로 되돌림 (한 번만)
  const d = await admin.ok('contracts', 'create', { ...base, customerName: '풀린고객', customerPhone: '010-7878-3434', category: '나노코팅' });
  const tk = (await admin.ok('contracts', 'requestSign', d.id)).url.split('/sign/')[1];
  await anon.ok('esign', 'sign', tk, { signerName: '풀린고객', signature: 'data:image/png;base64,Q0ND', agreed: true });
  const pgc = new pg.Client({ connectionString: url });
  await pgc.connect();
  await pgc.query(`UPDATE contracts SET data = jsonb_set(data, '{esign}', (data->'esign') || '{"status":"미발송","token":null}'::jsonb || jsonb_build_object('previousSignedAt', data->'esign'->'signedAt')) WHERE id = $1`, [d.id]);
  await pgc.query(`UPDATE companies SET data = data - 'signRestored'`);
  await pgc.end();
  assert.equal((await admin.ok('contracts', 'get', d.id)).esign.status, '미발송');
  const r = await admin.ok('contracts', 'repairCustomerLinks');
  assert.ok(r.restored >= 1);
  const back = await admin.ok('contracts', 'get', d.id);
  assert.equal(back.esign.status, '서명완료', '서명완료로 되돌림');
  assert.ok(back.esign.token && back.esign.signature, '링크 값·서명 이미지 있음');
  assert.equal((await admin.ok('contracts', 'repairCustomerLinks')).restored, 0, '두 번째는 할 일 없음');
});

test('목록 변경 확인(listCached): 그대로면 목록 없이 응답, 수정·입금·휴지통·권한이 바뀌면 새 목록', async () => {
  const first = await admin.ok('contracts', 'listCached', {}, '');
  assert.ok(first.rows.length > 0 && first.version);
  const same = await admin.ok('contracts', 'listCached', {}, first.version);
  assert.equal(same.unchanged, true, '바뀐 게 없으면 목록 안 보냄');
  assert.equal(same.rows, undefined);
  const c = first.rows[0];
  const full = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...full, memo: `${full.memo || ''} 변경확인` });
  const afterEdit = await admin.ok('contracts', 'listCached', {}, first.version);
  assert.ok(afterEdit.rows, '수정 후에는 새 목록');
  await admin.ok('contracts', 'moveToTrash', [c.id]);
  const afterTrash = await admin.ok('contracts', 'listCached', {}, afterEdit.version);
  assert.ok(afterTrash.rows && !afterTrash.rows.some((r) => r.id === c.id), '휴지통 이동 반영');
  await admin.ok('contracts', 'restore', [c.id]);
  const other = await admin.ok('contracts', 'listCached', { brand: '더좋은집' }, afterTrash.version);
  assert.ok(other.rows, '검색 조건이 다르면 새 목록');
  const mine = await manager.ok('contracts', 'listCached', {}, first.version);
  assert.ok(mine.rows, '다른 계정은 같은 확인표를 써도 새 목록');

  // 빠른 확인(계약 요약만 읽기)과 전체 읽기가 같은 확인표를 만들어야 함
  const base1 = await admin.ok('contracts', 'listCached', {}, '');
  assert.equal((await admin.ok('contracts', 'listCached', {}, base1.version)).unchanged, true, '전체 → 빠른 확인 일치');
  const mine2 = await manager.ok('contracts', 'listCached', {}, '');
  assert.equal((await manager.ok('contracts', 'listCached', {}, mine2.version)).unchanged, true, '본인 건만 보는 실장도 일치');
  // 입금 등록도 변경으로 잡힘
  const target = base1.rows.find((r) => !r.deletedAt);
  await admin.ok('contracts', 'addPayment', target.id, { date: '2026-10-01', kind: '잔금', method: '현금', amount: 1000 });
  const afterPay = await admin.ok('contracts', 'listCached', {}, base1.version);
  assert.ok(afterPay.rows, '입금 후 새 목록');
  assert.equal((await admin.ok('contracts', 'listCached', {}, afterPay.version)).unchanged, true);
  // 실장도 전체 계약을 보므로 다른 사람이 등록한 계약도 목록에 새로 나타남
  const mineNow = await manager.ok('contracts', 'listCached', {}, '');
  await admin.ok('contracts', 'create', { ...base, customerName: '남의계약', customerPhone: '010-8282-9393' });
  const mineAfter = await manager.ok('contracts', 'listCached', {}, mineNow.version);
  assert.ok(mineAfter.rows && mineAfter.rows.some((r) => r.customerName === '남의계약' && r.readOnly), '다른 사람 계약도 (보기만) 나타남');
});

test('줄눈·청소 한 장 계약서: 같은 고객(이름+전화)·같은 브랜드끼리 한 링크로 서명, 코팅·다른 브랜드·이미 서명한 건은 따로', async () => {
  const site = { ...base, customerName: '한장고객', customerPhone: '010-6060-1212', aptName: '한장아파트', dong: '102', ho: '303' };
  const a = await admin.ok('contracts', 'create', { ...site, category: '줄눈', totalAmount: 500000, customerNote: '줄눈 안내' });
  const b = await admin.ok('contracts', 'create', { ...site, category: '청소', totalAmount: 300000, customerNote: '청소 안내' });
  const otherSite = await admin.ok('contracts', 'create', { ...site, ho: '404', category: '청소' }); // 같은 고객이어도 다른 호수 → 따로
  const other = await admin.ok('contracts', 'create', { ...site, customerPhone: '010-6060-9999', category: '청소' }); // 전화번호 다르면 따로
  const coat = await admin.ok('contracts', 'create', { ...site, category: '나노코팅' }); // 코팅은 같은 현장이어도 따로
  const otherBrand = await admin.ok('contracts', 'create', { ...site, brand: '더스타트', category: '청소' }); // 브랜드가 다르면 따로

  const before = await admin.ok('contracts', 'signBundle', b.id);
  assert.deepEqual(before.contracts.map((c) => c.id), [a.id, b.id], '서명 전: 같은 고객(이름+전화)·같은 현장의 줄눈·청소 함께');
  assert.deepEqual((await admin.ok('contracts', 'signBundle', otherSite.id)).contracts.map((c) => c.id), [otherSite.id], '다른 현장은 계약서 따로');
  assert.equal(before.token, null, '아직 링크 없음');

  const { token, count } = await admin.ok('contracts', 'requestSign', a.id);
  assert.equal(count, 2);
  const anon = client();
  const view = await anon.ok('esign', 'getByToken', token);
  assert.deepEqual(view.contracts.map((c) => c.category), ['줄눈', '청소']);
  assert.deepEqual(view.contracts.map((c) => c.customerNote || ''), ['줄눈 안내', '청소 안내']);
  assert.ok(view.contracts.every((c) => c.memo === undefined && c.history === undefined));
  assert.equal((await admin.ok('contracts', 'signBundle', b.id)).token, token, '청소 쪽에서 봐도 같은 링크');

  const img = 'data:image/png;base64,QUJD';
  await anon.ok('esign', 'sign', token, { signerName: '한장고객', signature: img, agreed: true });
  for (const id of [a.id, b.id]) {
    const c = await admin.ok('contracts', 'get', id);
    assert.equal(c.esign.status, '서명완료');
    assert.equal(c.esign.signature, img, '두 계약 모두 서명 이미지 저장');
  }
  assert.equal((await admin.ok('contracts', 'get', other.id)).esign.status, '미발송', '전화번호가 다른 고객은 그대로');
  assert.equal((await admin.ok('contracts', 'get', coat.id)).esign.status, '미발송', '코팅은 따로');
  assert.equal((await admin.ok('contracts', 'get', otherBrand.id)).esign.status, '미발송', '다른 브랜드는 따로');
  assert.deepEqual((await admin.ok('contracts', 'signBundle', coat.id)).contracts.map((c) => c.id), [coat.id], '코팅 계약서는 한 장 따로');
  const again = await anon.ok('esign', 'getByToken', token);
  assert.ok(again.contracts.every((c) => c.esign.status === '서명완료' && c.esign.signature === img), '서명 후 다시 열면 둘 다 서명 표시');
  const r = await anon('esign', 'sign', token, { signerName: '한장고객', signature: img, agreed: true });
  assert.notEqual(r.status, 200, '두 번 서명 불가');

  // 서명 후 청소를 하나 더 추가 → 새 요청에는 서명 안 된 것만
  const c3 = await admin.ok('contracts', 'create', { ...site, category: '청소' });
  const later = await admin.ok('contracts', 'signBundle', c3.id);
  assert.deepEqual(later.contracts.map((c) => c.id), [c3.id], '이미 서명한 줄눈·청소는 다시 서명하지 않음');
  const signedView = await admin.ok('contracts', 'signBundle', a.id);
  assert.deepEqual(signedView.contracts.map((c) => c.id), [a.id, b.id], '서명한 계약서는 함께 서명한 묶음으로 보임');
  assert.equal((await admin.ok('contracts', 'get', otherSite.id)).esign.status, '미발송', '다른 현장은 서명 안 됨 (따로 받음)');
  assert.ok(signedView.contracts.every((c) => c.esign.signature === img));
  // 계약 번호가 잘못 오면 서버 오류(500)가 아니라 '찾을 수 없음' 안내
  for (const bad of ['abc', null, '']) {
    const r = await admin('contracts', 'signBundle', bad);
    assert.equal(r.status, 404, `번호 ${JSON.stringify(bad)}`);
  }
});

test('계약 조건: 서명할 때 조건을 계약에 함께 보관 (나중에 조건을 바꿔도 서명한 계약서는 그대로)', async () => {
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '약관고객', customerPhone: '010-3434-5656', category: '나노코팅' });
  const { token } = await admin.ok('contracts', 'requestSign', c.id);
  await client().ok('esign', 'sign', token, { signerName: '약관고객', signature: 'data:image/png;base64,QQ==', agreed: true });
  const signed = await admin.ok('contracts', 'get', c.id);
  assert.ok(Array.isArray(signed.esign.terms) && signed.esign.terms.length > 0, '서명 당시 조건 저장');
});

test('계약조건 (운영자 화면): 업체·브랜드별 저장, 구분에 맞는 조건만 서명 보관, 운영자만, 비우면 기본으로', async () => {
  const sup = client();
  await sup.ok('auth', 'login', 'super', 'super-test-1234');
  const myCompanyId = (await admin.ok('auth', 'me')).user.companyId;
  const st = await sup.ok('companies', 'termsSettings');
  const mine = st.companies.find((x) => x.id === myCompanyId);
  assert.ok(mine && mine.brands.includes(base.brand), '업체 브랜드 목록');
  assert.ok(mine.terms[base.brand].length > 0, '입력 전에도 지금 쓰는 조건이 보임');

  const terms = ['중요 조항: 갑과 을은 성실히 이행한다.', '[줄눈]\n*줄눈 AS 1년', '[청소]\n*청소 당일 검수'];
  await sup.ok('companies', 'saveContractTerms', { companyId: myCompanyId, brand: base.brand, terms });
  assert.equal((await admin('companies', 'saveContractTerms', { companyId: myCompanyId, brand: base.brand, terms })).status, 403, '업체 관리자는 불가');
  assert.equal((await admin('companies', 'termsSettings')).status, 403);
  assert.equal((await sup('companies', 'saveContractTerms', { companyId: myCompanyId, brand: '없는브랜드', terms })).status, 400);

  // 줄눈 계약: 중요 조항 + [줄눈]만 서명 때 보관, 서명 화면에도 이 브랜드 조건 전달
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '조건고객', customerPhone: '010-4545-6767', category: '줄눈' });
  const { token } = await admin.ok('contracts', 'requestSign', c.id);
  const view = await client().ok('esign', 'getByToken', token);
  assert.deepEqual(view.company.contractTerms[base.brand], terms);
  await client().ok('esign', 'sign', token, { signerName: '조건고객', signature: 'data:image/png;base64,QQ==', agreed: true });
  assert.deepEqual((await admin.ok('contracts', 'get', c.id)).esign.terms, [terms[0], terms[1]]);

  // 나노코팅처럼 맞는 구분이 없으면 중요 조항만
  const n = await admin.ok('contracts', 'create', { ...base, customerName: '코팅고객', customerPhone: '010-4545-8989', category: '나노코팅' });
  const t2 = (await admin.ok('contracts', 'requestSign', n.id)).token;
  await client().ok('esign', 'sign', t2, { signerName: '코팅고객', signature: 'data:image/png;base64,QQ==', agreed: true });
  assert.deepEqual((await admin.ok('contracts', 'get', n.id)).esign.terms, [terms[0]]);

  // 비우면 기본 조건으로, 서명한 계약서는 그대로
  await sup.ok('companies', 'saveContractTerms', { companyId: myCompanyId, brand: base.brand, terms: [] });
  const after = await sup.ok('companies', 'termsSettings');
  assert.equal(after.companies.find((x) => x.id === myCompanyId).saved[base.brand], false);
  assert.deepEqual((await admin.ok('contracts', 'get', c.id)).esign.terms, [terms[0], terms[1]]);
});

test('직원 계정 일괄 등록: 실장은 기본 권한, 시공팀은 기사모바일 계정, 중복·형식 오류는 건너뜀', async () => {
  const rows = [
    { name: '가져온실장', loginId: '0638', password: '0709', department: '상담팀', position: '실장' },
    { name: '가져온기사', loginId: 'impeng', password: '5874', department: '시공팀', position: '' },
    { name: '중복', loginId: 'admin', password: '1234', department: '본사', position: '' },
    { name: '짧은비번', loginId: 'shortpw', password: '12', department: '', position: '' },
    { name: '청)이관기사', loginId: 'importeng2', password: '1234', department: '시공팀', position: '', phone: '010-0000-0000' },
  ];
  await admin.ok('users', 'create', { loginId: 'impmgr', password: 'impmgr1234', name: '가져오기확인' });
  const mgr = client();
  await mgr.ok('auth', 'login', 'impmgr', 'impmgr1234');
  assert.equal((await mgr('imports', 'users', rows)).status, 403, '관리자만');
  const r = await admin.ok('imports', 'users', rows);
  assert.equal(r.created, 1);
  assert.equal(r.engineers, 2);
  const moved = (await admin.ok('engineers', 'list', { includeInactive: true })).filter((e) => e.name === '청)이관기사');
  assert.equal(moved.length, 1, "머리글('청)')이 붙은 이름도 같은 기사로 찾아 새로 만들지 않음");
  assert.equal(moved[0].loginId, 'importeng2');
  const s3 = client();
  assert.equal((await s3.ok('auth', 'login', 'importeng2', '1234', '', 'engineer')).user.role, 'ENGINEER');
  assert.equal(r.skipped, 1);
  assert.equal(r.errors.length, 1);
  const u = (await admin.ok('users', 'list')).find((x) => x.loginId === '0638');
  assert.equal(u.role, 'MANAGER');
  assert.equal(u.department, '상담팀');
  assert.ok(u.permissions.includes('contract.view') && !u.permissions.includes('contract.amount'), '기본 권한');
  const s1 = client();
  assert.equal((await s1.ok('auth', 'login', '0638', '0709')).user.name, '가져온실장');
  const s2 = client();
  assert.equal((await s2.ok('auth', 'login', 'impeng', '5874')).user.role, 'ENGINEER');
  // 다시 올려도 중복 안 됨
  const again = await admin.ok('imports', 'users', rows.slice(0, 1));
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 1);
  // 비밀번호만 바꾸기: 실장은 바뀌고, 관리자 계정(admin)은 그대로
  const reset = await admin.ok('imports', 'users', [{ ...rows[0], password: '1234' }, { ...rows[2], password: '1234' }], { resetPassword: true });
  assert.equal(reset.updated, 1);
  assert.equal(reset.skipped, 1);
  assert.equal((await client().ok('auth', 'login', '0638', '1234')).user.name, '가져온실장');
  assert.equal((await client()('auth', 'login', 'admin', '1234')).status, 400, '관리자 비밀번호는 안 바뀜');
});

test('상품 일괄 등록: 붙여넣은 목록을 상품으로, 빈 품목은 짐작, 노출 N 은 비활성, 다시 올려도 중복 없음', async () => {
  const tag = Date.now() % 100000;
  const rows = [
    { name: `가져온패키지${tag}`, kind: '패키지', category: '줄눈', detail: '욕실 2곳 바닥', visible: true },
    { name: `가져온코팅${tag}`, kind: '추가시공품목', category: '', detail: '샤워부스 유리 코팅', visible: false },
    { name: `이상한구분${tag}`, kind: '없는구분', category: '없는품목', detail: '', visible: 'Y' },
  ];
  const mgr = client();
  await mgr.ok('auth', 'login', 'impmgr', 'impmgr1234');
  assert.equal((await mgr('imports', 'products', rows)).status, 403, '관리자만');
  const r = await admin.ok('imports', 'products', rows);
  assert.equal(r.created, 3);
  const list = (await admin.ok('products', 'list', { includeInactive: true })).filter((p) => p.name.endsWith(String(tag)));
  const by = (n) => list.find((p) => p.name.startsWith(n));
  assert.equal(by('가져온패키지').category, '줄눈');
  assert.equal(by('가져온패키지').price, 0);
  assert.equal(by('가져온코팅').category, '나노코팅', '빈 품목은 이름·내용으로 짐작');
  assert.equal(by('가져온코팅').visible, false);
  assert.equal(by('이상한구분').kind, '패키지');
  assert.equal(by('이상한구분').category, '줄눈');
  const visible = await admin.ok('products', 'list');
  assert.ok(!visible.some((p) => p.name === `가져온코팅${tag}`), '노출 N 은 계약서 상품목록에 안 보임');
  const again = await admin.ok('imports', 'products', rows);
  assert.equal(again.created, 0);
  assert.equal(again.skipped, 3);
});

test('아파트 일괄 등록: 새 아파트 등록, 지역 빈 아파트는 지역만 채움, 같은 이름(띄어쓰기 무시)은 건너뜀', async () => {
  const tag = Date.now() % 100000;
  await admin.ok('apartments', 'save', { sido: '', sigungu: '', name: `지역없는단지${tag}` });
  const rows = [
    { sido: '경기도', sigungu: '성남시 수정구', name: `새단지${tag}` },
    { sido: '강원특별자치도', sigungu: '강릉시', name: `지역없는 단지${tag}` },
    { sido: '경기도', sigungu: '성남시 수정구', name: `새 단지${tag}` },
  ];
  const mgr = client();
  await mgr.ok('auth', 'login', 'impmgr', 'impmgr1234');
  assert.equal((await mgr('apartments', 'importMany', rows)).status, 403, '관리자만');
  const r = await admin.ok('apartments', 'importMany', rows);
  assert.deepEqual(r, { created: 1, updated: 1, skipped: 1 });
  const list = (await admin.ok('apartments', 'list')).filter((a) => a.name.endsWith(String(tag)));
  assert.equal(list.length, 2);
  const filled = list.find((a) => a.name.startsWith('지역없는'));
  assert.deepEqual([filled.sido, filled.sigungu], ['강원특별자치도', '강릉시']);
  assert.deepEqual(await admin.ok('apartments', 'importMany', rows), { created: 0, updated: 0, skipped: 3 }, '다시 올려도 중복 없음');
});

test('시연 샘플 계약: 운영자만, 가짜 번호(010-0000)·변경이력 없음·수정로그 없음, 샘플만 지움', async () => {
  const sup = client();
  await sup.ok('auth', 'login', 'super', process.env.INIT_SUPER_PASSWORD);
  const companyId = (await admin.ok('auth', 'me')).company.id;
  assert.equal((await admin('contracts', 'sampleAdd', companyId, 5)).status, 403, '업체 관리자는 불가');
  const mine = await admin.ok('contracts', 'create', { ...base, customerName: '진짜계약', customerPhone: '010-8282-1212' });
  const logsBefore = (await admin.ok('auditLogs', 'list', {})).rows.length;
  const r = await sup.ok('contracts', 'sampleAdd', companyId, 5);
  assert.equal(r.created, 5);
  const list = await admin.ok('contracts', 'list', {});
  const samples = list.filter((c) => /^010-0000-/.test(c.customerPhone));
  assert.ok(samples.length >= 5, '010-0000 번호');
  const one = await admin.ok('contracts', 'get', samples[0].id);
  assert.equal(one.history.length, 0, '변경이력 없음');
  assert.equal((await admin.ok('auditLogs', 'list', {})).rows.length, logsBefore, '수정로그 없음');
  const cleared = await sup.ok('contracts', 'sampleClear', companyId);
  assert.ok(cleared.removed >= 5);
  const after = await admin.ok('contracts', 'list', {});
  assert.ok(!after.some((c) => /^010-0000-/.test(c.customerPhone)), '샘플은 모두 지움');
  assert.ok(after.some((c) => c.id === mine.id), '직접 등록한 계약은 그대로');
});

test('AS관리: 보낸 계약은 AS관리에만, AS 완료해도 AS관리에 남고 재발하면 회차가 쌓임, 변경이력 남김', async () => {
  const c = await admin.ok('contracts', 'create', { ...base, customerName: 'AS고객', customerPhone: '010-5656-7878' });
  assert.equal((await admin('contracts', 'setAs', [c.id], true, { request: '' })).status, 400, 'AS 요청 내용 필수');
  await admin.ok('contracts', 'setAs', [c.id], true, { date: '2026-10-20', request: '욕실 줄눈 들뜸' });
  assert.ok(!(await admin.ok('contracts', 'list', {})).some((x) => x.id === c.id), '계약관리 목록에서 빠짐');
  const info = (await admin.ok('contracts', 'list', { as: true })).find((x) => x.id === c.id).asInfo;
  assert.deepEqual([info.date, info.request], ['2026-10-20', '욕실 줄눈 들뜸'], 'AS 접수 내용');
  assert.ok((await admin.ok('contracts', 'list', { as: true })).some((x) => x.id === c.id), 'AS관리 목록에 있음');
  const got = await admin.ok('contracts', 'get', c.id);
  assert.ok(got.asAt, 'AS 표시');
  assert.equal(got.history.at(-1).action, 'AS관리로 이동');
  // AS 완료: AS관리에 그대로 두고 완료 표시만
  await admin.ok('contracts', 'setAs', [c.id], false);
  assert.ok(!(await admin.ok('contracts', 'list', {})).some((x) => x.id === c.id), 'AS 완료해도 계약관리로 안 돌아감');
  const done = (await admin.ok('contracts', 'list', { as: true })).find((x) => x.id === c.id);
  assert.ok(done, 'AS관리에 그대로');
  assert.equal(done.asInfo, null, '처리 중 회차 없음 = 완료');
  assert.ok(done.asLogs[0].doneAt, '1회차에 완료일');
  // 재발: 다시 AS 접수 → 2회차, 처리 중 추가 접수 → 3회차
  await admin.ok('contracts', 'setAs', [c.id], true, { request: '같은 곳 재발' });
  await admin.ok('contracts', 'setAs', [c.id], true, { request: '현관도 추가' });
  const again = await admin.ok('contracts', 'get', c.id);
  assert.equal(again.asLogs.length, 3, 'AS 회차가 쌓임');
  assert.equal(again.asInfo.request, '현관도 추가');
  assert.deepEqual(again.asLogs.map((l) => !!l.doneAt), [true, false, false]);
});

test('AS 사진: 접수하면서 사진 첨부(한 건·여러 건), 회차별로 보기, 입금을 바꿔도 사진은 그대로', async () => {
  const img = (n) => 'data:image/jpeg;base64,' + Buffer.from(`as-photo-${n}`).toString('base64');
  const one = await admin.ok('contracts', 'create', { ...base, customerName: 'AS사진고객', customerPhone: '010-7171-2323', payments: [{ date: '2026-10-01', kind: '계약금', method: '계좌이체', amount: 10000 }] });
  const two = await admin.ok('contracts', 'create', { ...base, customerName: 'AS사진고객2', customerPhone: '010-7171-2424' });
  assert.equal((await admin('contracts', 'setAs', [one.id], true, { request: '들뜸', photos: [1, 2, 3, 4, 5, 6].map(img) })).status, 400, '최대 5장');
  assert.equal((await admin('contracts', 'setAs', [one.id], true, { request: '들뜸', photos: ['not-an-image'] })).status, 400, '사진만');
  await admin.ok('contracts', 'setAs', [one.id], true, { request: '욕실 들뜸', photos: [img(1), img(2)] });
  await admin.ok('contracts', 'setAs', [one.id], true, { request: '현관 추가' }); // 2회차는 사진 없이
  await admin.ok('contracts', 'setAs', [one.id, two.id], true, { request: '함께 접수', photos: [img(3)] }); // 여러 건 한꺼번에
  const got = await admin.ok('contracts', 'get', one.id);
  assert.deepEqual(got.asLogs.map((l) => l.photoCount || 0), [2, 0, 1], '회차마다 사진 장수');
  assert.deepEqual((await admin.ok('contracts', 'asPhotos', one.id, 0)).map((r) => r.image), [img(1), img(2)], '1회차 사진');
  assert.equal((await admin.ok('contracts', 'asPhotos', one.id, 1)).length, 0);
  assert.deepEqual((await admin.ok('contracts', 'asPhotos', two.id, 0)).map((r) => r.image), [img(3)], '여러 건 접수 → 각 계약에 사진');
  assert.ok(!JSON.stringify(await admin.ok('contracts', 'list', { as: true })).includes(img(1)), '목록에는 사진을 싣지 않음');
  // 입금을 지워도(영수증 정리) AS 사진은 남음
  await admin.ok('contracts', 'removePayment', one.id, got.payments[0].id);
  assert.equal((await admin.ok('contracts', 'asPhotos', one.id)).length, 3, '입금 정리와 무관');
});

test('동명이인: 이름이 같아도 전화번호가 다르면 다른 계약자·다른 계약서, 전화번호 없으면 현장까지 같아야 같은 계약자', async () => {
  const p = { ...base, brand: '더좋은집', category: '줄눈' };
  const a = await admin.ok('contracts', 'create', { ...p, customerName: '동명이', customerPhone: '010-8181-0001', aptName: '가아파트', dong: '1', ho: '1' });
  const b = await admin.ok('contracts', 'create', { ...p, customerName: '동명이', customerPhone: '010-8181-0002', aptName: '나아파트', dong: '2', ho: '2' });
  assert.notEqual(a.customerId, b.customerId, '번호 다른 동명이인 = 다른 계약자');
  // 가족이 같은 번호를 써도 이름이 다르면 다른 계약자
  const fam = await admin.ok('contracts', 'create', { ...p, customerName: '가족이', customerPhone: '010-8181-0001', aptName: '가아파트', dong: '1', ho: '1' });
  assert.notEqual(fam.customerId, a.customerId, '같은 번호·다른 이름 = 다른 계약자');
  // 같은 사람(이름+번호)은 같은 계약자
  const a2 = await admin.ok('contracts', 'create', { ...p, category: '청소', customerName: '동 명이', customerPhone: '01081810001', aptName: '가아파트', dong: '1', ho: '1' });
  assert.equal(a2.customerId, a.customerId, '띄어쓰기·하이픈 차이는 같은 사람');
  assert.deepEqual((await admin.ok('contracts', 'signBundle', a.id)).contracts.map((c) => c.id), [a.id, a2.id], '본인 줄눈·청소는 한 장');
  assert.deepEqual((await admin.ok('contracts', 'signBundle', b.id)).contracts.map((c) => c.id), [b.id], '동명이인 계약은 섞이지 않음');
  const g = await admin.ok('contracts', 'group', a.id);
  assert.equal(g.customer.name, '동명이');
  assert.ok(!g.otherContracts.some((c) => c.id === b.id || c.id === fam.id), '다른 사람 계약이 계약자 탭에 안 나옴');
  // 같은 사람이 나중에 또 계약: 같은 계약자로 쌓이고, 계약서는 그날 계약한 것끼리만 한 장
  const later = await admin.ok('contracts', 'create', { ...p, contractDate: '2026-12-20', customerName: '동명이', customerPhone: '010-8181-0001', aptName: '마아파트', dong: '5', ho: '5' });
  assert.equal(later.customerId, a.customerId, '재계약 = 같은 계약자');
  assert.deepEqual((await admin.ok('contracts', 'signBundle', later.id)).contracts.map((c) => c.id), [later.id], '다른 날 계약은 따로 서명');
  assert.ok((await admin.ok('contracts', 'group', a.id)).otherContracts.some((c) => c.id === later.id), '계약자 탭에 같은 사람의 다른 계약');
});

test('계약자 연결 바로잡기: 예전에 번호만으로 잘못 묶인 계약을 이름+번호로 다시 연결 (한 번만)', async () => {
  const x = await admin.ok('contracts', 'create', { ...base, customerName: '연결갑', customerPhone: '010-9292-0001' });
  const y = await admin.ok('contracts', 'create', { ...base, customerName: '연결을', customerPhone: '010-9292-0001' });
  // 예전 방식으로 잘못 묶인 상태를 만듦 (을의 계약이 갑의 계약자에 연결)
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query(`UPDATE contracts SET data = jsonb_set(data, '{customerId}', to_jsonb($1::bigint)) WHERE id = $2`, [x.customerId, y.id]);
  await c.query(`UPDATE companies SET data = data - 'customerLinksFixed'`);
  await c.end();
  assert.equal((await admin.ok('contracts', 'get', y.id)).customerId, x.customerId);
  const r = await admin.ok('contracts', 'repairCustomerLinks');
  assert.ok(r.fixed >= 1);
  const fixed = await admin.ok('contracts', 'get', y.id);
  assert.notEqual(fixed.customerId, x.customerId, '을의 계약은 을의 계약자로');
  assert.equal((await admin.ok('contracts', 'group', y.id)).customer.name, '연결을');
  assert.equal((await admin.ok('contracts', 'repairCustomerLinks')).fixed, 0, '두 번째는 할 일 없음');
});

test('박람회 일정: 이름·장소, 관리자는 바로·실장은 권한 받아야 등록·전체 보기, 권한 없으면 본인 것만, 기사는 본인 것만, 여러 날, 수정·삭제', async () => {
  const me = (await manager.ok('auth', 'me')).user;
  const adminMe = (await admin.ok('auth', 'me')).user;
  const eng = (await admin.ok('engineers', 'list')).find((e) => e.loginId === 'gong');
  const gong = client(); await gong.ok('auth', 'login', 'gong', 'gong1234', '', 'engineer');
  assert.equal((await admin('fairs', 'save', { date: '2026-12-05', name: '', place: '', staffIds: [me.id] })).status, 400, '이름 필수');
  assert.equal((await admin('fairs', 'save', { date: '2026-12-05', name: '지제역 필해링턴', staffIds: [], engineerIds: [] })).status, 400, '가는 사람 필수');
  assert.equal((await admin('fairs', 'save', { date: '2026-12-05', endDate: '2026-12-01', name: 'x', staffIds: [me.id] })).status, 400, '끝나는 날짜가 앞이면 안 됨');
  // 관리자만 가는 박람회 / 실장+기사가 가는 박람회
  const onlyAdmin = await admin.ok('fairs', 'save', { date: '2026-12-05', name: '관리자 박람회', place: '서울', staffIds: [adminMe.id] });
  const f = await admin.ok('fairs', 'save', { date: '2026-12-05', endDate: '2026-12-07', name: '지제역 필해링턴', place: '수원', staffIds: [me.id, 999999], engineerIds: [eng.id, 999999] });
  assert.equal(f.label, '지제역 필해링턴 (수원)');
  assert.deepEqual(f.staff.map((x) => x.name), [me.name], '없는 사람은 빠짐');
  assert.deepEqual(f.engineers.map((x) => x.name), [eng.name]);
  // 실장: 본인이 포함된 것만 (관리자 박람회는 안 보임), 여러 날 박람회는 기간이 겹치면
  const seen = await manager.ok('fairs', 'list', { from: '2026-12-06', to: '2026-12-06' });
  assert.deepEqual(seen.map((x) => x.id), [f.id], '본인 것만');
  assert.equal((await manager.ok('fairs', 'list', { from: '2026-12-05', to: '2026-12-05' })).some((x) => x.id === onlyAdmin.id), false, '남의 박람회는 안 보임');
  assert.equal((await manager.ok('fairs', 'list', { from: '2026-12-08', to: '2026-12-31' })).some((x) => x.id === f.id), false);
  assert.equal((await admin.ok('fairs', 'list', { from: '2026-12-05', to: '2026-12-05' })).length, 2, '관리자는 전부');
  // 기사: 기사모바일에서 본인이 포함된 것만
  const mineEng = await gong.ok('engineerApp', 'myFairs', { from: '2026-12-01', to: '2026-12-31' });
  assert.deepEqual(mineEng.map((x) => x.label), ['지제역 필해링턴 (수원)']);
  // 실장은 권한이 없으면 등록·수정·삭제 불가 → 관리자가 사용자관리에서 권한 주면 가능
  assert.ok(!(await manager.ok('auth', 'me')).user.permissions.includes('fair.manage'), '실장 기본 권한에는 없음');
  assert.equal((await manager('fairs', 'save', { date: '2026-12-10', name: '실장 등록', staffIds: [me.id] })).status, 403);
  assert.equal((await manager('fairs', 'remove', f.id)).status, 403);
  const u = (await admin.ok('users', 'list')).find((x) => x.id === me.id);
  await admin.ok('users', 'update', u.id, { permissions: [...u.permissions, 'fair.manage'] });
  assert.equal((await manager.ok('fairs', 'list', { from: '2026-12-05', to: '2026-12-05' })).length, 2, '박람회 권한을 받은 실장은 전체 박람회를 봄');
  const mine = await manager.ok('fairs', 'save', { date: '2026-12-10', name: '실장 등록', staffIds: [me.id] });
  await manager.ok('fairs', 'save', { id: mine.id, date: '2026-12-11', name: '실장 등록 (바뀜)', place: '평택', staffIds: [me.id] });
  assert.equal((await manager.ok('fairs', 'list', { from: '2026-12-11', to: '2026-12-11' })).find((x) => x.id === mine.id).label, '실장 등록 (바뀜) (평택)');
  // 예전 화면(장소 한 칸)으로 보내도 이름으로 저장
  const old = await admin.ok('fairs', 'save', { date: '2026-12-20', place: '예전 방식', staffIds: [adminMe.id] });
  assert.equal(old.name, '예전 방식');
  for (const x of [mine.id]) await manager.ok('fairs', 'remove', x);
  for (const x of [f.id, onlyAdmin.id, old.id]) await admin.ok('fairs', 'remove', x);
  assert.equal((await admin.ok('fairs', 'list', { from: '2026-12-01', to: '2026-12-31' })).length, 0, '삭제됨');
  await admin.ok('users', 'update', u.id, { permissions: u.permissions }); // 다른 시험에 영향 없게 되돌림
});

test('상품 줄: 상품명 없이 금액만 있는 줄은 저장을 막고(금액이 사라지지 않게), 완전히 빈 줄은 무시', async () => {
  const bad = await admin('contracts', 'create', { ...base, customerName: '빈줄고객', customerPhone: '010-9191-8282', lineItems: [{ name: '', qty: 1, unitPrice: 300000 }] });
  assert.equal(bad.status, 400);
  assert.match(bad.error.message, /상품명/);
  const ok = await admin.ok('contracts', 'create', { ...base, customerName: '빈줄고객', customerPhone: '010-9191-8282', lineItems: [{ name: '줄눈', qty: 1, unitPrice: 300000 }, { name: '', qty: 1, unitPrice: 0 }] });
  assert.equal(ok.lineItems.length, 1);
  assert.equal(ok.totalAmount, 300000);
});

test('기사모바일 계약 상세: 본인 배정 계약만, 단가·내부 메모·이력은 숨김', async () => {
  const eng = client();
  await eng.ok('auth', 'login', 'gong', 'gong1234');
  const [s] = await eng.ok('engineerApp', 'mySchedules', { from: '2000-01-01', to: '2100-12-31' });
  const full = await admin.ok('contracts', 'get', s.contractId);
  await admin.ok('contracts', 'update', s.contractId, { ...full, memo: '내부 메모', customerNote: '고객 안내', engineerNote: '기사 전달', lineItems: [{ name: '욕실', qty: 2, unitPrice: 300000 }] });
  const g = await eng.ok('engineerApp', 'contract', s.contractId);
  assert.equal(g.selectedId, s.contractId);
  const d = g.contracts.find((x) => x.id === s.contractId);
  assert.ok(g.contracts.every((x) => x.schedules.some((y) => y.mine)), '같은 현장이라도 내 배정 계약만');
  assert.equal(typeof d.amounts.balance, 'number', '잔금 요약만');
  assert.equal(d.customerNote, '고객 안내');
  assert.equal(d.engineerNote, '기사 전달');
  assert.deepEqual(d.lineItems, [{ name: '욕실', detail: '', qty: 2 }], '단가 없음');
  assert.equal(d.memo, undefined);
  assert.equal(d.history, undefined);
  assert.equal(d.payments, undefined);
  assert.ok(d.schedules.some((x) => x.mine && x.stepIndex === s.stepIndex));

  const other = await admin.ok('contracts', 'create', { ...base, customerName: '남의계약', customerPhone: '010-2323-4545' });
  assert.equal((await eng('engineerApp', 'contract', other.id)).status, 403, '배정 안 된 계약은 차단');
});

test('통계 시공기사별: 시공일 기준 기사마다 배정·완료·구분별 완료, 취소 제외', async () => {
  const engs = await admin.ok('engineers', 'list');
  const en = engs[0];
  const sch = (date, extra = {}) => ({ date, ampm: 'AM', assignType: 'engineer', engineerId: String(en.id), ...extra });
  const mk = (category, schedules, extra = {}) =>
    admin.ok('contracts', 'create', { ...base, customerName: `기사통계${category}`, customerPhone: '010-8181-0000', category, schedules, ...extra });
  const from = '2031-03-01', to = '2031-03-31';
  const a = await mk('줄눈', [sch('2031-03-05'), sch('2031-03-20')], { totalAmount: 1000000, discount: 100000, payments: [{ date: '2031-02-01', kind: '계약금', method: '계좌이체', amount: 200000 }] }); // 같은 기사 1·2차
  await mk('청소', [sch('2031-03-06')]);
  const x = await mk('줄눈', [sch('2031-03-07')]);
  await admin.ok('contracts', 'update', a.id, { ...(await admin.ok('contracts', 'get', a.id)), status: '시공완료', completedDate: '2031-03-05' });
  await admin.ok('contracts', 'update', x.id, { ...(await admin.ok('contracts', 'get', x.id)), status: '취소', canceledDate: '2031-03-01', cancelReason: '고객 취소' });

  const rows = await admin.ok('reports', 'engineers', { from, to });
  const r = rows.find((y) => y.name === en.name);
  assert.equal(r.assigned, 3, '기간 안 회차만, 취소 제외');
  assert.equal(r.done, 2);
  assert.deepEqual(r.byCategory, { 줄눈: 2 });
  assert.equal(r.jobs.length, 3);
  assert.deepEqual(r.doneAmounts, { total: 1000000, discount: 100000, deposit: 200000, paid: 200000, balance: 700000 }, '같은 계약 두 회차여도 금액은 한 번');
  assert.equal(r.jobs.filter((j) => j.money).length, 2, '두 번째 회차는 금액 없음');
  const boss = client();
  await boss.ok('auth', 'login', 'admin', 'admin1234');
  await boss.ok('users', 'create', { role: 'MANAGER', loginId: 'engstatmgr', password: 'engstat1234', name: '통계실장', permissions: ['contract.view', 'contract.amount', 'stats.view'], dataScope: 'all' });
  const mgr = client();
  await mgr.ok('auth', 'login', 'engstatmgr', 'engstat1234');
  const m = (await mgr.ok('reports', 'engineers', { from, to })).find((y) => y.name === en.name);
  assert.equal(m.done, 2);
  assert.ok(m.amounts === undefined && m.jobs.every((j) => j.money === undefined), '매출 합계 권한 없는 실장은 금액 없음');
  const eng = client();
  await eng.ok('auth', 'login', 'gong', 'gong1234');
  assert.equal((await eng('reports', 'engineers', { from, to })).status, 403, '기사 계정은 통계 불가');
});

test('통계 시공기사별: 1차·2차 담당이 다른 계약은 금액을 공동 줄에 한 번만 (기사 합 + 공동 = 전체)', async () => {
  const [e1, e2] = await admin.ok('engineers', 'list');
  const sch = (date, en) => ({ date, ampm: 'AM', assignType: 'engineer', engineerId: String(en.id) });
  const from = '2032-05-01', to = '2032-05-31';
  const mk = (schedules, totalAmount) => admin.ok('contracts', 'create', { ...base, customerName: '공동시공', customerPhone: '010-9191-0000', category: '줄눈', schedules, totalAmount });
  await mk([sch('2032-05-03', e1)], 500000); // e1 단독
  const both = await mk([sch('2032-05-04', e1), sch('2032-05-10', e2)], 900000); // e1·e2 공동

  const rows = await admin.ok('reports', 'engineers', { from, to });
  const r1 = rows.find((r) => r.name === e1.name);
  const r2 = rows.find((r) => r.name === e2.name);
  const shared = rows.find((r) => r.shared);
  assert.equal(r1.assigned, 2, '건수는 각 기사에 그대로');
  assert.equal(r2.assigned, 1);
  assert.equal(r1.amounts.total, 500000, 'e1 은 단독 계약 금액만');
  assert.equal(r2.amounts.total, 0);
  assert.equal(shared.amounts.total, 900000, '공동 계약은 공동 줄에 한 번');
  assert.deepEqual(shared.jobs.map((j) => j.contractId), [both.id]);
  assert.deepEqual(shared.jobs[0].engineers.sort(), [e1.name, e2.name].sort());
  const sum = rows.reduce((t, r) => t + r.amounts.total, 0);
  assert.equal(sum, 1400000, '기사별 + 공동 = 전체 (중복 없음)');
  assert.ok(r1.jobs.find((j) => j.contractId === both.id).sharedWith, '기사 목록에는 공동 표시');
});

test('알림톡 발송 기록: 비즈고 연결 전에는 기록만(MOCK), 템플릿 빈칸만 저장', async () => {
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '알림고객', customerPhone: '010-5656-7878' });
  const log = await admin.ok('notifications', 'send', {
    contractId: c.id, template: '서명요청', templateKey: '서명요청',
    variables: { 고객명: '알림고객', ecode: 'abc', 엉뚱한값: 'x' }, buttons: [{ name: '계약서 확인·서명', url: 'https://veritybase.vercel.app/e/?q=abc' }],
    target: '고객', brand: '더좋은집', receiverName: '알림고객', receiverPhone: '010-5656-7878', message: '알림고객님, 계약 내용을 확인하시고 서명해 주세요.',
  });
  assert.deepEqual(Object.keys(log.variables), ['고객명', 'ecode'], '템플릿에 있는 빈칸만');
  const { token: ct } = await admin.ok('contracts', 'customerLink', c.id);
  assert.equal(log.variables.ecode, ct, '이 계약 것이 아닌 링크 값(abc)은 서버가 진짜 값으로 바꿈 (서명 요청 전이면 고객확인페이지 값)');
  assert.equal(log.result, 'MOCK', '키 없으면 기록만');
});

test('고객모바일: 이름+휴대폰 로그인, 알림톡 링크로 바로 로그인, 내 계약만·내부 정보 숨김, 직원 로그인과 따로', async () => {
  const site = { ...base, customerName: '모바일 고객', customerPhone: '010-4242-1111', customerPhone2: '010-4242-2222', memo: '내부 메모', customerNote: '고객 안내' };
  const a = await admin.ok('contracts', 'create', { ...site, category: '줄눈', totalAmount: 800000, payments: [{ date: '2026-09-27', kind: '계약금', method: '계좌이체', amount: 100000 }] });
  await admin.ok('contracts', 'create', { ...site, category: '청소', totalAmount: 300000 });
  await admin.ok('contracts', 'create', { ...site, customerName: '다른 고객', category: '줄눈' }); // 같은 번호·다른 이름 → 제외

  const cust = client();
  assert.equal((await cust('customerApp', 'me')).status, 401, '로그인 전');
  assert.notEqual((await cust('customerApp', 'login', 'thegood', '모바일 고객', '010-0000-0000')).status, 200, '번호 틀리면 실패');
  const me = await cust.ok('customerApp', 'login', 'THEGOOD', '모바일고객', '01042422222'); // 띄어쓰기·하이픈·연락처② 무관
  assert.deepEqual(me.contracts.map((c) => c.category).sort(), ['줄눈', '청소']);
  const j = me.contracts.find((c) => c.category === '줄눈');
  assert.equal(j.amounts.balance, 700000);
  assert.equal(j.amounts.deposit, 100000);
  assert.equal(j.customerNote, '고객 안내');
  assert.equal(j.memo, undefined, '내부 메모 없음');
  assert.equal(j.payments, undefined, '입금 상세 없음');

  // 직원: 알림톡용 링크 → 다른 기기에서 누르면 바로 로그인
  const { token, url } = await admin.ok('contracts', 'customerLink', a.id);
  assert.match(url, /\/thegood\/c\/[\w-]+$/);
  assert.equal((await admin.ok('contracts', 'customerLink', a.id)).token, token, '같은 링크 유지');
  const phone = client();
  const viaLink = await phone.ok('customerApp', 'linkLogin', token);
  assert.equal(viaLink.contracts.length, 2);
  assert.notEqual((await client()('customerApp', 'linkLogin', 'wrong-token')).status, 200);

  // 직원이 같은 브라우저에서 고객 링크를 열어도 직원 로그인 유지
  await admin.ok('customerApp', 'linkLogin', token);
  assert.equal((await admin.ok('auth', 'me')).user.loginId, 'admin');
  await admin.ok('customerApp', 'logout');
  assert.equal((await admin.ok('auth', 'me')).user.loginId, 'admin', '고객 로그아웃해도 직원은 그대로');
  assert.equal((await phone('auth', 'me')).status, 401, '고객 로그인으로 직원 화면 불가');
  assert.equal((await phone.ok('customerApp', 'me')).contracts.length, 2, '직원 확인 실패 후에도 고객 로그인 유지');
});

test('비즈고 알림톡: 키는 Authorization 헤더로, 템플릿 자동 치환 형식, 발신프로필 자동 조회·직접 입력, 운영자만', async () => {
  const http = await import('node:http');
  const seen = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('content-type', 'application/json');
      if (req.headers.authorization !== 'test-key') return res.end(JSON.stringify({ common: { authCode: 'A101', authResult: 'invalid key' } }));
      if (req.url.startsWith('/api/comm/v1/account/kakao/sender/profiles')) {
        return res.end(JSON.stringify({ common: { authCode: 'A000' }, data: { code: 'A000', data: { channels: [{ senderKey: 'SK123', channelName: '더 좋은집', channelId: '@thegood7777', status: 'A' }] } } }));
      }
      if (req.url.startsWith('/api/comm/v1/report/inquiry/')) {
        return res.end(JSON.stringify({ common: { authCode: 'A000' }, data: { code: 'A000', data: { report: [{ msgKey: 'MK1', serviceType: 'ALIMTALK', reportCode: '30007', reportText: 'invalid sender key', reportTime: '2026-10-12T13:30:05+09:00' }] } } }));
      }
      res.end(JSON.stringify({ common: { authCode: 'A000' }, data: { code: 'A000', data: { msgKeys: ['MK1'] } } }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  process.env.BIZGO_BASE_URL = `http://127.0.0.1:${mock.address().port}`;
  const sup = client();
  await sup.ok('auth', 'login', 'super', 'super-test-1234');
  const myCompanyId = (await admin.ok('auth', 'me')).user.companyId;
  try {
    delete process.env.BIZGO_API_KEY;
    assert.equal((await sup.ok('notifications', 'gatewayStatus')).configured, false, '키 없음');

    process.env.BIZGO_API_KEY = 'test-key';
    const st = await sup.ok('notifications', 'gatewayStatus');
    assert.ok(st.companies.some((c) => c.id === myCompanyId), '업체 목록 포함');
    assert.equal(st.configured, true);
    assert.deepEqual(st.senders.map((s) => s.channelId), ['@thegood7777']);
    assert.equal(st.senders[0].senderKey, 'SK123');

    const r = await sup.ok('notifications', 'testSend', { to: '010-2222-3333', templateCode: 'togisa_start01', replaceWords: { 시공일: '2026-10-20' }, channel: '@thegood7777' });
    assert.equal(r.msgKey, 'MK1');
    const sent = seen.find((x) => x.url === '/api/comm/v1/send/omni');
    assert.equal(sent.auth, 'test-key', '접두어 없이 키만');
    assert.deepEqual(sent.body.destinations, [{ to: '01022223333', replaceWords: { 시공일: '2026-10-20' } }]);
    assert.deepEqual(sent.body.messageFlow, [{ alimtalk: { senderKey: 'SK123', templateCode: 'togisa_start01', sendType: 'template' } }]);

    process.env.BIZGO_API_KEY = 'wrong';
    const bad = await sup('notifications', 'testSend', { to: '01022223333', templateCode: 'x' });
    assert.notEqual(bad.status, 200);
    assert.match(bad.error.message, /A101/);

    // 계약 화면 알림톡: 브랜드별 템플릿 코드가 있어야 실제 발송
    process.env.BIZGO_API_KEY = 'test-key';
    const c = await admin.ok('contracts', 'create', { ...base, customerName: '실발송', customerPhone: '010-7777-1212' });
    const msg = { contractId: c.id, template: '계약완료', templateKey: '계약완료', variables: { 고객명: '실발송', ecode: 'CT' }, target: '고객', brand: '더좋은집', receiverName: '실발송', receiverPhone: '010-7777-1212', message: 'x' };
    const noCode = await admin('notifications', 'send', msg);
    assert.equal(noCode.status, 400);
    assert.match(noCode.error.message, /템플릿 코드가 없습니다/);
    await sup.ok('notifications', 'saveAlimtalkSettings', { companyId: myCompanyId, brands: { 더좋은집: { channel: '@thegood7777', codes: { 계약완료: 'contract_good10' } } } });
    const sentLog = await admin.ok('notifications', 'send', msg);
    assert.equal(sentLog.result, 'SENT');
    assert.equal(sentLog.templateCode, 'contract_good10');
    const last = seen.filter((x) => x.url === '/api/comm/v1/send/omni').at(-1);
    assert.deepEqual(last.body.messageFlow[0].alimtalk, { senderKey: 'SK123', templateCode: 'contract_good10', sendType: 'template' });
    const { token: realCt } = await admin.ok('contracts', 'customerLink', c.id);
    assert.deepEqual(last.body.destinations[0].replaceWords, { 고객명: '실발송', ecode: realCt }, '링크 값은 서버가 이 계약의 진짜 값으로');
    assert.equal((await sup.ok('notifications', 'gatewayStatus')).companies.find((x) => x.id === myCompanyId).brands.더좋은집.codes.계약완료, 'contract_good10');

    // 발신프로필 키를 직접 넣으면 목록 조회 없이 그 키로
    const before = seen.length;
    const direct = 'a'.repeat(20) + '0123456789abcdef0123';
    await sup.ok('notifications', 'testSend', { to: '01022223333', templateCode: 't1', replaceWords: {}, senderKey: direct });
    assert.equal(seen.slice(before).filter((x) => x.url.includes('sender/profiles')).length, 0);
    assert.equal(seen.at(-1).body.messageFlow[0].alimtalk.senderKey, direct);

    // 템플릿 코드를 발신프로필 키 칸에 잘못 넣으면 보내기 전에 거절
    const sentCount = seen.length;
    const wrongKey = await sup('notifications', 'testSend', { to: '01022223333', templateCode: 'togisa_start01', replaceWords: {}, senderKey: 'togisa_start01' });
    assert.equal(wrongKey.status, 400);
    assert.match(wrongKey.error.message, /발신프로필 키 형식/);
    assert.equal(seen.length, sentCount, '비즈고에 보내지 않음');
    assert.equal((await sup('notifications', 'saveAlimtalkSettings', { companyId: myCompanyId, brands: { 더좋은집: { senderKey: 'togisa_start01' } } })).status, 400);

    // 도착 결과 조회: 리포트 코드 10000 아니면 실패
    const rep = await sup.ok('notifications', 'testResult', 'MK1');
    assert.equal(rep[0].reportCode, '30007');
    assert.equal(rep[0].ok, false);
    assert.equal(seen.at(-1).url, '/api/comm/v1/report/inquiry/MK1');
    assert.equal((await admin('notifications', 'testResult', 'MK1')).status, 403);

    assert.equal((await admin('notifications', 'gatewayStatus')).status, 403, '업체 관리자는 불가');
    assert.equal((await admin('notifications', 'testSend', { to: '01022223333', templateCode: 'x' })).status, 403);
    assert.equal((await admin('notifications', 'saveAlimtalkSettings', { companyId: myCompanyId, brands: {} })).status, 403);

    const mgr = client();
    await mgr.ok('auth', 'login', 'engstatmgr', 'engstat1234');
    assert.equal((await mgr('notifications', 'gatewayStatus')).status, 403, '실장은 불가');
    assert.equal((await mgr('notifications', 'saveAlimtalkSettings', { companyId: myCompanyId, brands: {} })).status, 403);
  } finally {
    delete process.env.BIZGO_API_KEY;
    delete process.env.BIZGO_BASE_URL;
    mock.close();
  }
});

test('알림톡: 따로 권한 없이 계약을 볼 수 있는 직원이면 모든 알림톡 발송, 기사는 불가', async () => {
  await admin.ok('users', 'create', { loginId: 'talkmgr', password: 'talkmgr1234', name: '알림톡실장', permissions: ['contract.view'], dataScope: 'all' });
  const mgr = client();
  await mgr.ok('auth', 'login', 'talkmgr', 'talkmgr1234');
  const [c] = await admin.ok('contracts', 'list', {});
  const msg = { contractId: c.id, brand: '더좋은집', receiverName: '고객', receiverPhone: '010-1234-5678', message: '안내', target: '고객' };
  assert.equal((await mgr.ok('notifications', 'send', { ...msg, template: '서명요청', templateKey: '서명요청' })).templateKey, '서명요청');
  assert.equal((await mgr.ok('notifications', 'send', { ...msg, template: '계약완료', templateKey: '계약완료' })).templateKey, '계약완료');
  assert.equal((await mgr.ok('notifications', 'send', { ...msg, template: '기사배정', templateKey: '기사배정_고객' })).templateKey, '기사배정_고객');
  assert.ok((await mgr.ok('notifications', 'history', c.id)).length >= 3);
  await admin.ok('engineers', 'save', { name: '알림톡기사', phone: '010-5252-6363', loginId: 'talkeng', password: 'talkeng1234' });
  const eng = client();
  await eng.ok('auth', 'login', 'talkeng', 'talkeng1234');
  assert.equal((await eng('notifications', 'send', { ...msg, template: '계약완료', templateKey: '계약완료' })).status, 403, '기사는 불가');
});

test('현장 서명: 계약 등록 권한만 있어도 서명 요청(등록 직후 그 자리에서), 묶음 계약 번호를 돌려줌', async () => {
  await admin.ok('users', 'create', { loginId: 'onsitemgr', password: 'onsite1234', name: '현장서명실장', permissions: ['contract.view', 'contract.create'], dataScope: 'all' });
  const mgr = client();
  await mgr.ok('auth', 'login', 'onsitemgr', 'onsite1234');
  const base = { brand: '더좋은집', customerName: '현장서명고객', customerPhone: '010-8282-9393', aptName: '현장서명아파트', dong: '1', ho: '101', contractDate: '2026-11-03', workType: '시공', receptionType: '박람회' };
  const a = await mgr.ok('contracts', 'create', { ...base, category: '줄눈' });
  const b = await mgr.ok('contracts', 'create', { ...base, category: '청소' });
  const r = await mgr.ok('contracts', 'requestSign', a.id);
  assert.deepEqual([...r.ids].sort((x, y) => x - y), [a.id, b.id].sort((x, y) => x - y), '줄눈·청소는 한 장으로');
  await admin.ok('users', 'create', { loginId: 'viewonlymgr', password: 'viewonly1234', name: '조회만실장', permissions: ['contract.view'], dataScope: 'all' });
  const v = client();
  await v.ok('auth', 'login', 'viewonlymgr', 'viewonly1234');
  assert.equal((await v('contracts', 'requestSign', a.id)).status, 403, '조회만 가능하면 서명 요청 불가');
});

test('계약 등록 → 계약자관리 자동 등록 (이름·연락처①②·주소=현장), 같은 번호면 기존 계약자에 연결하고 빈 칸만 채움', async () => {
  const base = { brand: '더좋은집', contractDate: '2026-11-03', workType: '시공', receptionType: '박람회', category: '줄눈' };
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '자동계약자', customerPhone: '010-6161-7272', customerPhone2: '010-6161-8383', aptName: '자동힐스', dong: '101', ho: '1203' });
  let [cust] = await admin.ok('customers', 'list', '010-6161-7272');
  assert.equal(cust.id, c.customerId);
  assert.equal(cust.name, '자동계약자');
  assert.equal(cust.phone2, '010-6161-8383');
  assert.equal(cust.address1, '자동힐스 101동 1203호');
  assert.equal(cust.contractCount, 1);
  await admin.ok('contracts', 'create', { ...base, category: '청소', customerName: '자동계약자', customerPhone: '010-6161-7272', aptName: '자동힐스', dong: '101', ho: '1203' });
  const all = await admin.ok('customers', 'list', '010-6161-7272');
  assert.equal(all.length, 1, '같은 번호는 계약자 하나');
  assert.equal(all[0].contractCount, 2);
});

test('수정로그 제외: 고객 서명, 상품 등록·수정·삭제, 아파트 가져오기', async () => {
  const tag = `${Date.now() % 1000000}`; // 시험 DB 에 남은 예전 기록과 섞이지 않게
  const logs = async (q) => (await admin.ok('auditLogs', 'list', { q })).rows;
  const p = await admin.ok('products', 'save', { name: `로그제외상품${tag}`, kind: '패키지', category: '줄눈', price: 100000 });
  await admin.ok('products', 'save', { ...p, price: 120000 });
  await admin.ok('products', 'remove', p.id);
  assert.equal((await logs(`로그제외상품${tag}`)).length, 0, '상품은 안 남음');
  await admin.ok('apartments', 'importMany', [{ name: `로그제외아파트${tag}`, sido: '서울특별시', sigungu: '강남구' }]);
  assert.equal((await logs(`로그제외아파트${tag}`)).length, 0, '아파트 가져오기는 안 남음');
  const who = `로그서명${tag}`;
  const c = await admin.ok('contracts', 'create', { brand: '더좋은집', customerName: who, customerPhone: '010-4747-5858', aptName: '로그아파트', contractDate: '2026-11-03', workType: '시공', receptionType: '박람회', category: '줄눈' });
  const { token } = await admin.ok('contracts', 'requestSign', c.id);
  await client().ok('esign', 'sign', token, { signerName: who, signature: `data:image/png;base64,${'A'.repeat(200)}`, agreed: true });
  const rows = await logs(who);
  assert.ok(rows.some((r) => r.call === 'contracts.create'), '계약 등록은 남음');
  assert.ok(!rows.some((r) => r.call === 'esign.sign'), '고객 서명은 안 남음');
});

test('수정로그: 예전에 남은 고객 서명·상품·아파트 가져오기 기록도 목록에서 숨김', async () => {
  const { getPool } = await import('../server/pg.js');
  const companyId = (await admin.ok('auth', 'me')).user.companyId;
  const tag = `예전기록${Date.now() % 1000000}`;
  for (const call of ['esign.sign', 'products.save', 'products.remove', 'imports.products', 'apartments.importMany', 'contracts.update']) {
    await getPool().query(`INSERT INTO audit_logs (company_id, data) VALUES ($1, $2::jsonb)`, [companyId, JSON.stringify({ action: `${tag} ${call}`, call, actor: { name: '시험' }, items: [] })]);
  }
  const { rows } = await admin.ok('auditLogs', 'list', { q: tag });
  assert.deepEqual(rows.map((r) => r.call), ['contracts.update'], '계약 수정만 보임');
});

test('기사 시공 기록: 시공완료 때 범위(완료·미시공)·자재 → 누가·언제와 함께 저장, 사무실 수정에도 유지, 다른 상태면 지움', async () => {
  const eng = client();
  await eng.ok('auth', 'login', 'gong', 'gong1234');
  const engId = (await eng.ok('auth', 'me')).user.engineerId;
  const c = await admin.ok('contracts', 'create', {
    ...base,
    customerName: '범위고객',
    customerPhone: '010-3434-5656',
    category: '줄눈',
    lineItems: [{ name: '진아리채2', detail: '진아리채2 : 욕실2곳 바닥(빅라이언)+현관s.v(폴리) + 욕조벽ㄷ자(폴리)', qty: 1, unitPrice: 500000 }],
    items: '베란다 줄눈',
    schedules: [{ date: '2026-12-15', time: '10:00', assignType: 'engineer', engineerId: engId }],
  });
  const mine = (await eng.ok('engineerApp', 'mySchedules', { from: '2026-12-15', to: '2026-12-15' })).find((x) => x.contractId === c.id);
  assert.deepEqual(mine.scope, [
    { group: '진아리채2', parts: ['욕실2곳 바닥(빅라이언)', '현관s.v(폴리)', '욕조벽ㄷ자(폴리)'] },
    { group: '추가 시공내용', parts: ['베란다 줄눈'] },
  ], "상세품목을 '+'로 나누고 '상품명 :' 머리는 뺌");
  await eng.ok('engineerApp', 'report', {
    contractId: c.id,
    stepIndex: 0,
    mobileStatus: '시공완료',
    memo: '',
    items: [
      { text: '욕실2곳 바닥(빅라이언)', done: true, material: '빅라이언 화이트', worker: '' },
      { text: '현관s.v(폴리)', done: true, material: '크린파파 위너스', color: '101', worker: '김민수 팀장' },
      { text: '욕조벽ㄷ자(폴리)', done: false },
      { text: '베란다 줄눈', done: true },
    ],
    material: '빅라이언 화이트',
    helpers: '김민수 팀장',
    note: '욕조벽은 절반만, 나머지 다음 방문',
  });
  let got = await admin.ok('contracts', 'get', c.id);
  const rec = got.schedules[0].workRecord;
  assert.deepEqual(rec.undone, ['욕조벽ㄷ자(폴리)']);
  assert.equal(rec.material, '빅라이언 화이트');
  assert.equal(rec.note, '욕조벽은 절반만, 나머지 다음 방문', '직접 적은 시공 내용');
  assert.equal(rec.helpers, '김민수 팀장', '함께한 사람');
  assert.deepEqual(rec.items[1], { text: '현관s.v(폴리)', done: true, material: '크린파파 위너스', color: '101', worker: '김민수 팀장' }, '항목별 자재·번호·작업자');
  assert.ok(got.history.some((h) => h.changes?.some((x) => x.label === '완료' && x.to.includes('크린파파 위너스 101번'))), '변경이력: 자재 101번');
  assert.deepEqual(rec.done, ['욕실2곳 바닥(빅라이언)', '현관s.v(폴리)', '베란다 줄눈']);
  assert.ok(rec.by && rec.at, '누가·언제');
  assert.ok(got.history.some((h) => h.changes?.some((x) => x.label === '미시공')), '변경이력에도 남음');
  await admin.ok('contracts', 'update', c.id, { ...got, memo: '사무실 수정' });
  got = await admin.ok('contracts', 'get', c.id);
  assert.equal(got.schedules[0].workRecord?.material, '빅라이언 화이트', '사무실이 계약을 고쳐도 유지');
  await eng.ok('engineerApp', 'report', { contractId: c.id, stepIndex: 0, mobileStatus: '시공연기요청', memo: '' });
  got = await admin.ok('contracts', 'get', c.id);
  assert.equal(got.schedules[0].workRecord, undefined, '시공완료가 아니면 지움');
});

test('일정관리설정: 시공 자재 목록 저장 (빈 줄·중복 제거), 기사 화면에서도 보임', async () => {
  const cur = await admin.ok('scheduleSettings', 'get');
  assert.ok(Array.isArray(cur.materials) && cur.materials.length > 0, '기본 자재 목록');
  const saved = await admin.ok('scheduleSettings', 'save', { ...cur, materials: ['크린파파 위너스', '', '빅라이언', '빅라이언 ', '케라폭시'] });
  assert.deepEqual(saved.materials, ['크린파파 위너스', '빅라이언', '케라폭시']);
  const eng = client();
  await eng.ok('auth', 'login', 'gong', 'gong1234');
  assert.deepEqual((await eng.ok('auth', 'me')).company.scheduleSettings.materials, ['크린파파 위너스', '빅라이언', '케라폭시']);
  await admin.ok('scheduleSettings', 'save', cur);
});

test('로그인 주소별 첫 화면 이름 (링크 미리보기·홈 화면): /업체, /t, /m, /c', async () => {
  const { pageMeta, injectMeta, manifestFor, validCode } = await import('../server/page.js');
  const html = '<html><head><title>VerityBase - 계약관리</title><link rel="manifest" href="/manifest.webmanifest" /><meta name="apple-mobile-web-app-title" content="VerityBase" /></head><body></body></html>';
  const m = pageMeta('thegood', 'm', '더좋은집');
  assert.equal(m.title, '기사모바일 · 더좋은집 VerityBase');
  assert.equal(m.short, '더좋은집 기사');
  assert.equal(pageMeta('thegood', 't', '더좋은집').short, '더좋은집 상담');
  assert.equal(pageMeta('thegood', '', '더좋은집').title, '일반화면 · 더좋은집 VerityBase');
  assert.equal(pageMeta('thegood', 'c', '더좋은집').title, '내 계약 확인 · 더좋은집');
  const out = injectMeta(html, m);
  assert.match(out, /<title>기사모바일 · 더좋은집 VerityBase<\/title>/);
  assert.match(out, /apple-mobile-web-app-title" content="더좋은집 기사"/);
  assert.match(out, /og:title" content="기사모바일 · 더좋은집 VerityBase"/);
  assert.match(out, /rel="manifest" href="\/api\/page\?manifest=1&amp;code=thegood&amp;kind=m"/);
  assert.deepEqual([manifestFor(m).short_name, manifestFor(m).start_url], ['더좋은집 기사', '/thegood/m']);
  // 앱 설치: 기본은 앱처럼(standalone), ?web=1 은 브라우저처럼 — 서로 다른 앱(id)
  assert.equal(manifestFor(m).display, 'standalone');
  assert.match(out, /apple-mobile-web-app-capable" content="yes"/);
  const w = pageMeta('thegood', 'm', '더좋은집', true);
  assert.deepEqual([manifestFor(w).display, manifestFor(w).start_url, manifestFor(w).id], ['browser', '/thegood/m?web=1', '/thegood/m?web=1']);
  assert.match(injectMeta(html, w), /kind=m&amp;web=1"/);
  assert.ok(!injectMeta(html, w).includes('apple-mobile-web-app-capable'), '브라우저처럼 주소는 아이폰도 브라우저로');
  assert.ok(manifestFor(m).icons.some((i) => i.sizes === '192x192') && manifestFor(m).icons.some((i) => i.sizes === '512x512'), 'PC 설치에 필요한 아이콘 크기');
  assert.equal(pageMeta('contracts', '', '아무개'), null, '화면 이름은 업체 주소가 아님');
  assert.equal(validCode('admin'), false);
  assert.equal(injectMeta(html, null), html, '업체를 못 찾으면 원래 화면 그대로');
  assert.ok(!injectMeta(html, pageMeta('thegood', '', '<b>"x"')).includes('<b>"x"'), '이름 속 특수문자 처리');
  // 서버 함수: 실제 업체 이름을 DB에서 찾아 넣음
  const { default: page } = await import('../api/page.js');
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { this.body = b; return this; } };
  await page({ query: { code: 'thegood', kind: 'm', manifest: '1' }, headers: { host: 'test.local' } }, res);
  assert.equal(JSON.parse(res.body).short_name, '더좋은집 기사');
});

test('계약 가져오기: 시공일자 ①② (시간·오전/오후), 기사 ①② 배정, 시공완료일까지 — 기사 이름 앞 표시가 달라도 같은 기사로', async () => {
  const { parseLegacyHtml, mapLegacyRow } = await import('../frontend/src/utils/legacyImport.js');
  await admin.ok('imports', 'engineers', [{ name: '박영노' }, { name: '줄)김준영2' }]);
  const tr = (no, d1, w1, d2, w2, status) => `<tr>
    <td>${no}</td><td>더좋은집</td><td>줄눈</td><td>박람</td><td>시공</td><td>${status}</td><td>2026-05-02</td>
    <td>일정확인고객${no}(승인)</td><td>010-7272-${String(no).slice(-4)}</td><td>일정아파트101-${no}</td><td>84A</td>
    <td>1,000,000</td><td>할인금액 : 0</td><td>상품권 : 0</td><td>1,000,000</td><td>0</td><td>1,000,000</td>
    <td>① : ${d1}</td><td>② : ${d2}</td><td>${status}</td><td>① : ${w1}</td><td>② : ${w2}</td><td></td><td></td><td></td><td></td></tr>`;
  const html = `<table><thead><tr><td>번호</td></tr></thead><tbody>
    ${tr(9101, '2026-06-03(10:30)', '청)박영노', '2026-06-04(오후)', '김준영2', '시공완료')}
    ${tr(9102, '2026-06-05(오전)', '', '', '', '미정')}
  </tbody></table>`;
  const rows = parseLegacyHtml(html).map(mapLegacyRow);
  assert.deepEqual(rows[0].schedules.map((s) => [s.date, s.time, s.ampm || '', s.engineerName]), [
    ['2026-06-03', '10:30', '', '청)박영노'],
    ['2026-06-04', '', 'PM', '김준영2'],
  ]);
  const r = await admin.ok('imports', 'contracts', rows);
  assert.equal(r.created, 2, JSON.stringify(r.errors));
  assert.deepEqual(r.newEngineers, [], "'청)박영노'·'김준영2'는 이미 있는 '박영노'·'줄)김준영2'와 같은 기사 (새로 안 만듦)");
  const engs = await admin.ok('engineers', 'list');
  const idOf = (n) => engs.find((e) => e.name === n).id;
  const list = await admin.ok('contracts', 'list', {});
  const full = await admin.ok('contracts', 'get', list.find((x) => x.customerName === '일정확인고객9101').id);
  assert.deepEqual(full.schedules.slice(0, 2).map((s) => [s.date, s.time, s.ampm, s.engineerId]), [
    ['2026-06-03', '10:30', '', idOf('박영노')],
    ['2026-06-04', '', 'PM', idOf('줄)김준영2')],
  ]);
  assert.equal(full.status, '시공완료');
  assert.equal(full.completedDate, '2026-06-04', '완료일 = 마지막 시공일');
  const day = await admin.ok('schedules', 'list', { from: '2026-06-03', to: '2026-06-05' });
  assert.ok(day.some((x) => x.contract?.customerName === '일정확인고객9102' && !x.engineerId), '기사 없는 일정도 달력에 (미정)');
});

test('계약 가져오기 [파일대로 맞추기]: 이미 가져온 계약의 시공일·기사·시공상태만 갱신, 비어 있는 회차·입금은 그대로', async () => {
  await admin.ok('imports', 'engineers', [{ name: '맞춤기사' }]);
  const base = { legacyNo: '9301', brand: '더좋은집', category: '줄눈', receptionType: '박람회', workType: '시공', contractDate: '2026-07-01', customerName: '맞춤고객', customerPhone: '010-9393-1010', aptName: '맞춤아파트', dong: '1', ho: '101', totalAmount: 500000, discount: 0, voucher: 0, payments: [{ date: '2026-07-01', kind: '계약금', method: '계좌이체', amount: 100000 }] };
  await admin.ok('imports', 'contracts', [{ ...base, status: '미정', schedules: [{ date: '', time: '', engineerName: '' }] }]);
  const list = await admin.ok('contracts', 'list', {});
  const id = list.find((x) => x.customerName === '맞춤고객').id;
  // 우리 쪽에서 ②회차를 직접 입력해 둠
  const before = await admin.ok('contracts', 'get', id);
  await admin.ok('contracts', 'update', id, { ...before, schedules: [before.schedules[0], { date: '2026-07-20', time: '14:00', assignType: 'engineer' }] });
  const fileRow = { ...base, status: '시공완료', completedDate: '2026-07-10', schedules: [{ date: '2026-07-10', time: '09:00', engineerName: '청)맞춤기사' }, { date: '', time: '', engineerName: '' }] };
  const skip = await admin.ok('imports', 'contracts', [fileRow]);
  assert.deepEqual([skip.created, skip.skipped, skip.updated], [0, 1, 0], '맞추기 없이는 건너뜀');
  const r = await admin.ok('imports', 'contracts', [fileRow], { sync: true });
  assert.deepEqual([r.created, r.updated], [0, 1]);
  const after = await admin.ok('contracts', 'get', id);
  const engId = (await admin.ok('engineers', 'list')).find((e) => e.name === '맞춤기사').id;
  assert.deepEqual([after.schedules[0].date, after.schedules[0].time, after.schedules[0].engineerId], ['2026-07-10', '09:00', engId], '①회차는 파일대로 (앞 표시 달라도 같은 기사)');
  assert.equal(after.schedules[1].date, '2026-07-20', '파일에 없는 ②회차는 우리 입력 유지');
  assert.deepEqual([after.status, after.completedDate], ['시공완료', '2026-07-10']);
  assert.equal(after.payments.length, 1, '입금 그대로');
  assert.ok(after.history.some((h) => /파일 일정 반영/.test(h.action)), '변경이력');
  const again = await admin.ok('imports', 'contracts', [fileRow], { sync: true });
  assert.deepEqual([again.updated, again.skipped], [0, 1], '바뀐 게 없으면 건너뜀');
});

test('계약 가져오기: 예전 번호가 당겨져도(예전 프로그램에서 계약 삭제) 계약일·구분·연락처·고객·현장으로 같은 계약을 찾고, 잘못 맞춰진 계약은 바로잡음', async () => {
  await admin.ok('imports', 'engineers', [{ name: '청)번호기사' }, { name: '코)번호코팅' }]);
  const common = { brand: '더좋은집', receptionType: '박람회', workType: '시공', contractDate: '2026-08-01', totalAmount: 300000, discount: 0, voucher: 0, payments: [] };
  const clean = { ...common, legacyNo: '8801', category: '청소', customerName: '번호고객갑', customerPhone: '010-4848-1111', aptName: '번호아파트', dong: '107', ho: '404' };
  const coat = { ...common, legacyNo: '8799', category: '나노코팅', customerName: '번호고객을', customerPhone: '010-4848-2222', aptName: '번호아파트', dong: '211', ho: '502' };
  const none = [{ date: '', time: '', engineerName: '' }];
  await admin.ok('imports', 'contracts', [{ ...clean, status: '미정', schedules: none }, { ...coat, status: '미정', schedules: none }]);
  // 예전 프로그램에서 계약 2건이 지워져 번호가 당겨짐: 청소 8801 → 8799, 코팅 8799 → 8797
  const file = [
    { ...clean, legacyNo: '8799', status: '미정', schedules: [{ date: '2026-08-18', time: '', engineerName: '청)번호기사' }] },
    { ...coat, legacyNo: '8797', status: '미정', schedules: [{ date: '2026-08-10', time: '14:00', engineerName: '코)번호코팅' }] },
  ];
  const r = await admin.ok('imports', 'contracts', file, { sync: true });
  assert.deepEqual([r.created, r.updated], [0, 2], '번호가 달라도 새로 만들지 않고 각자 맞춤');
  const list = await admin.ok('contracts', 'list', {});
  const get = async (name) => admin.ok('contracts', 'get', list.find((x) => x.customerName === name).id);
  const engs = await admin.ok('engineers', 'list');
  const idOf = (n) => engs.find((e) => e.name === n).id;
  let a = await get('번호고객갑');
  assert.deepEqual([a.category, a.schedules[0].date, a.schedules[0].engineerId], ['청소', '2026-08-18', idOf('청)번호기사')], '청소 계약에는 청소 일정');
  const b = await get('번호고객을');
  assert.deepEqual([b.category, b.schedules[0].date, b.schedules[0].engineerId], ['나노코팅', '2026-08-10', idOf('코)번호코팅')], '코팅 계약에는 코팅 일정');
  // 예전(번호로 찾던 때)에 잘못 들어간 일정·상태 흉내 → 같은 파일을 다시 올리면 파일대로 바로잡음
  await admin.ok('contracts', 'update', a.id, { ...a, status: '취소', cancelReason: '잘못 맞춤', canceledDate: '2026-08-02', schedules: [{ ...a.schedules[0], engineerId: idOf('코)번호코팅'), date: '2026-08-10', time: '14:00' }, { date: '2026-08-10', time: '14:00', assignType: 'engineer', engineerId: idOf('코)번호코팅') }] });
  // 예전 코드가 남긴 '파일로 일정 맞춤' 기록 (번호로 찾던 때) → 바로잡기 대상
  const { getPool } = await import('../server/pg.js');
  await getPool().query(`UPDATE contracts SET data = jsonb_set(data, '{history}', COALESCE(data->'history', '[]'::jsonb) || $2::jsonb) WHERE id = $1`, [a.id, JSON.stringify([{ at: new Date().toISOString(), action: '기존 프로그램 파일로 일정 맞춤 (예전 번호 8801)', changes: [] }])]);
  const again = await admin.ok('imports', 'contracts', file, { sync: true });
  assert.equal(again.created, 0);
  a = await get('번호고객갑');
  assert.deepEqual([a.status, a.schedules[0].date, a.schedules[0].time, a.schedules[0].engineerId], ['미정', '2026-08-18', '', idOf('청)번호기사')], '①회차·상태를 파일대로 바로잡음');
  assert.deepEqual([a.schedules[1]?.date || '', a.schedules[1]?.engineerId || null], ['', null], '파일에 없는 ②회차의 잘못 들어간 일정은 비움');
  assert.ok(a.history.some((h) => /일정 바로잡음/.test(h.action)), '변경이력');
  // 바로잡은 뒤에는 다시 일반 맞추기 (바뀐 것 없으면 건너뜀)
  const third = await admin.ok('imports', 'contracts', file, { sync: true });
  assert.deepEqual([third.created, third.updated], [0, 0]);
});

test('계약 가져오기 중복 정리: 같은 계약이 파일보다 많으면 가져오기로만 생긴 나중 계약을 휴지통으로', async () => {
  const { legacyKeys } = await import('../frontend/src/utils/legacyImport.js');
  const { getPool } = await import('../server/pg.js');
  const row = { legacyNo: '8901', brand: '더좋은집', category: '줄눈', receptionType: '박람회', workType: '시공', status: '미정', contractDate: '2026-08-05', customerName: '중복고객', customerPhone: '010-5959-1212', aptName: '중복아파트', dong: '1', ho: '1', totalAmount: 100000, discount: 0, voucher: 0, payments: [], schedules: [{ date: '', time: '', engineerName: '' }] };
  await admin.ok('imports', 'contracts', [row]);
  const orig = (await admin.ok('contracts', 'list', {})).find((x) => x.customerName === '중복고객');
  // 예전에 번호로 찾다가 같은 계약이 한 번 더 들어간 상황 흉내 (DB 에 복사본)
  await getPool().query(`INSERT INTO contracts (id, company_id, data) SELECT 990001, company_id, jsonb_set(data, '{id}', '990001') FROM contracts WHERE id = $1`, [orig.id]);
  assert.equal((await admin.ok('contracts', 'list', {})).filter((x) => x.customerName === '중복고객').length, 2);
  const r = await admin.ok('imports', 'contractDuplicates', { [legacyKeys(row)[0]]: 1 });
  assert.equal(r.trashed, 1);
  const left = (await admin.ok('contracts', 'list', {})).filter((x) => x.customerName === '중복고객');
  assert.deepEqual(left.map((x) => x.id), [orig.id], '먼저 있던 계약은 남고 나중 복사본만 휴지통');
  assert.equal((await admin.ok('imports', 'contractDuplicates', { [legacyKeys(row)[0]]: 1 })).trashed, 0, '다시 해도 그대로');
});

test('시공 시간 [무관]: 계약에 저장·표시, 예전 파일의 (무관)도 무관으로', async () => {
  const { timeLabel, timeFieldsOf } = await import('../frontend/src/utils/contract.js');
  const { parseLegacyHtml, mapLegacyRow } = await import('../frontend/src/utils/legacyImport.js');
  assert.deepEqual(timeFieldsOf('ANY'), { time: '', ampm: 'ANY' });
  assert.equal(timeLabel({ time: '', ampm: 'ANY' }), '무관');
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '무관고객', customerPhone: '010-6363-7474', category: '줄눈', schedules: [{ date: '2026-12-20', time: '', ampm: 'ANY', assignType: 'engineer' }] });
  assert.equal((await admin.ok('contracts', 'get', c.id)).schedules[0].ampm, 'ANY');
  // 예전 파일의 (무관)은 예전처럼 시간 없음, 직접 고른 무관은 파일대로 맞추기에도 그대로
  const html = `<table><tbody><tr><td>9501</td><td>더좋은집</td><td>줄눈</td><td>박람</td><td>시공</td><td>미정</td><td>2026-05-01</td><td>무관파일(승인)</td><td>010-6363-8585</td><td>무관아파트101-101</td><td>84</td><td>0</td><td>할인금액 : 0</td><td>상품권 : 0</td><td>0</td><td>0</td><td>0</td><td>① : 2026-11-18(무관)</td><td>② : </td><td>미정</td><td>① : </td><td>② : </td><td></td><td></td><td></td><td></td></tr></tbody></table>`;
  const [row] = parseLegacyHtml(html).map(mapLegacyRow);
  assert.deepEqual([row.schedules[0].date, row.schedules[0].ampm || ''], ['2026-11-18', '']);
  await admin.ok('imports', 'contracts', [row]);
  const id = (await admin.ok('contracts', 'list', {})).find((x) => x.customerName === '무관파일').id;
  const got = await admin.ok('contracts', 'get', id);
  await admin.ok('contracts', 'update', id, { ...got, schedules: [{ ...got.schedules[0], ampm: 'ANY', time: '' }] });
  await admin.ok('imports', 'contracts', [{ ...row, schedules: [{ ...row.schedules[0], date: '2026-11-19' }] }], { sync: true });
  const after = await admin.ok('contracts', 'get', id);
  assert.deepEqual([after.schedules[0].date, after.schedules[0].ampm], ['2026-11-19', 'ANY'], '날짜만 바뀌고 직접 고른 무관은 그대로');
});

test('시공 구분: 운영자가 업체마다 목록·순서를 정함, 계약 등록은 그 목록만, 뺀 구분의 예전 계약은 그대로', async () => {
  const sup = client();
  await sup.ok('auth', 'login', 'super', 'super-test-1234');
  const good = (await sup.ok('companies', 'list')).find((c) => c.code === 'thegood');
  const old = await admin.ok('contracts', 'create', { ...base, category: '탄성', customerName: '구분시험', customerPhone: '010-7777-1212', totalAmount: 100000, payments: [] });
  // 순서 바꾸고 새 구분 추가, 탄성 빼기 (공백·중복·대괄호 정리)
  const saved = await sup.ok('companies', 'update', good.id, { categories: [' 청소 ', '줄눈', '방충망', '줄눈', '[기타]'] });
  assert.deepEqual(saved.categories, ['청소', '줄눈', '방충망', '기타']);
  assert.deepEqual((await admin.ok('auth', 'me')).company.categories, ['청소', '줄눈', '방충망', '기타'], '업체 화면에 그 순서로');
  const added = await admin.ok('contracts', 'create', { ...base, category: '방충망', customerName: '구분시험2', customerPhone: '010-7777-1313', totalAmount: 100000, payments: [] });
  assert.equal((await admin.ok('contracts', 'get', added.id)).category, '방충망', '새 구분으로 등록');
  const wrong = await admin.ok('contracts', 'create', { ...base, category: '탄성', customerName: '구분시험3', customerPhone: '010-7777-1414', totalAmount: 100000, payments: [] });
  assert.equal((await admin.ok('contracts', 'get', wrong.id)).category, '청소', '목록에 없는 구분은 첫 구분으로');
  const g = await admin.ok('contracts', 'get', old.id);
  await admin.ok('contracts', 'update', old.id, { ...g, memo: g.memo || '' });
  assert.equal((await admin.ok('contracts', 'get', old.id)).category, '탄성', '뺀 구분의 예전 계약은 고쳐도 그대로');
  assert.equal((await admin('companies', 'update', good.id, { categories: ['x'] })).status, 403, '업체 관리자는 못 바꿈');
  // 비우면 기본 목록
  await sup.ok('companies', 'update', good.id, { categories: [] });
  assert.deepEqual((await admin.ok('auth', 'me')).company.categories, []);
});

test('업체 기능 스위치: 운영자만 켜고 끔, 끈 기능은 서버에서 막힘, 다시 켜면 그대로', async () => {
  const sup = client();
  await sup.ok('auth', 'login', 'super', 'super-test-1234');
  const good = (await sup.ok('companies', 'list')).find((c) => c.code === 'thegood');
  assert.equal((await admin('companies', 'update', good.id, { features: { fair: false } })).status, 403, '업체 관리자는 못 바꿈');
  const saved = await sup.ok('companies', 'update', good.id, { features: { fair: false, as: false, alimtalk: false, manager: false, customer: false, 없는기능: false, workRecord: 'x' } });
  assert.deepEqual(saved.features, { fair: false, as: false, alimtalk: false, manager: false, customer: false }, '아는 기능의 켜기/끄기만 저장');
  const me = await admin.ok('auth', 'me');
  assert.equal(me.company.features.fair, false, '화면에서 스위치를 알 수 있음');
  assert.equal((await admin('fairs', 'save', { date: '2026-12-05', name: '꺼진 박람회', staffIds: [me.user.id] })).status, 403, '박람회 등록 막힘');
  assert.deepEqual(await admin.ok('fairs', 'list', {}), [], '박람회 목록은 비어 보임');
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '스위치고객', customerPhone: '010-5151-6262', totalAmount: 100000, payments: [] });
  assert.equal((await admin('contracts', 'setAs', [c.id], true, { request: '들뜸' })).status, 403, 'AS 접수 막힘');
  assert.equal((await admin('notifications', 'send', { contractId: c.id, template: '계약완료', templateKey: '계약완료', variables: {}, buttons: [], target: '고객', brand: '더좋은집', receiverName: '스위치고객', receiverPhone: '010-5151-6262', message: 'x' })).status, 403, '알림톡 막힘');
  assert.equal((await client()('auth', 'login', 'manager', 'manager1234', 'thegood', 'manager')).status, 403, '상담실장(/t) 로그인 막힘');
  assert.equal((await client().ok('auth', 'login', 'manager', 'manager1234', 'thegood')).user.loginId, 'manager', '일반 화면 로그인은 그대로');
  assert.equal((await client()('customerApp', 'login', 'thegood', '스위치고객', '01051516262')).status, 403, '고객확인페이지 막힘');
  // 다시 켜면 그대로
  await sup.ok('companies', 'update', good.id, { features: {} });
  await admin.ok('contracts', 'setAs', [c.id], true, { request: '들뜸' });
  assert.equal((await client().ok('customerApp', 'login', 'thegood', '스위치고객', '01051516262')).contracts.length, 1, '켜면 고객확인페이지 열림');
});

test('수정로그 되돌리기: 관리자만, 수정·삭제·등록을 이전으로, 나중에 또 바뀌었으면 막음, 되돌린 것도 다시 되돌림, 알림톡은 불가', async () => {
  const who = `되돌림${Date.now() % 100000}`;
  const c = await admin.ok('contracts', 'create', { ...base, customerName: who, customerPhone: '010-3131-4141', totalAmount: 100000, payments: [] });
  const g = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...g, contractDate: '2026-10-01', totalAmount: 200000 });
  const find = async (action) => (await admin.ok('auditLogs', 'list', { q: who })).rows.find((r) => r.action === action && !r.undoneAt);
  const edit = await find('계약 수정');
  assert.equal(edit.canUndo, true);
  assert.equal(edit.undo, undefined, '목록에는 이전·이후 자료를 보내지 않음');
  const mgr = client();
  await mgr.ok('auth', 'login', 'manager', 'manager1234');
  assert.equal((await mgr('auditLogs', 'undo', edit.id)).status, 403, '실장은 불가');

  await admin.ok('auditLogs', 'undo', edit.id);
  const back = await admin.ok('contracts', 'get', c.id);
  assert.equal(back.contractDate, base.contractDate, '계약일이 이전으로');
  assert.equal(back.totalAmount, 100000);
  assert.ok(back.history.some((h) => h.action.includes('되돌리기')), '변경이력에 되돌리기');
  assert.equal((await admin('auditLogs', 'undo', edit.id)).status, 400, '두 번 되돌리기 불가');
  const listed = (await admin.ok('auditLogs', 'list', { q: who })).rows.find((r) => r.id === edit.id);
  assert.ok(listed.undoneAt && !listed.canUndo, '되돌림 표시');
  // 되돌린 것을 다시 되돌리기 (다시 적용)
  const redo = (await admin.ok('auditLogs', 'list', {})).rows.find((r) => r.undoOf === edit.id);
  await admin.ok('auditLogs', 'undo', redo.id);
  assert.equal((await admin.ok('contracts', 'get', c.id)).contractDate, '2026-10-01');

  // 나중에 또 바뀐 자료는 막음
  const g2 = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...g2, contractDate: '2026-10-02' });
  const g3 = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...g3, contractDate: '2026-10-03' });
  const rows = (await admin.ok('auditLogs', 'list', { q: who })).rows.filter((r) => r.action === '계약 수정' && !r.undoneAt && !r.undoOf);
  const older = rows[1]; // 최신순
  assert.equal((await admin('auditLogs', 'undo', older.id)).status, 400, '나중 수정을 덮어쓰지 않음');
  await admin.ok('auditLogs', 'undo', rows[0].id);
  await admin.ok('auditLogs', 'undo', older.id);
  assert.equal((await admin.ok('contracts', 'get', c.id)).contractDate, '2026-10-01', '나중 것부터 차례로');

  // 휴지통 이동 되돌리기, 등록 되돌리기(계약 없어짐)
  await admin.ok('contracts', 'moveToTrash', [c.id]);
  await admin.ok('auditLogs', 'undo', (await find('휴지통으로 이동')).id);
  assert.ok(!(await admin.ok('contracts', 'get', c.id)).deletedAt, '휴지통에서 돌아옴');

  // 사진(평소에 읽지 않는 표)도 되돌림
  const img = 'data:image/jpeg;base64,' + Buffer.from('undo-photo').toString('base64');
  await admin.ok('contracts', 'setPaperPhotos', c.id, { add: [img] });
  assert.equal((await admin.ok('contracts', 'paperPhotos', c.id)).length, 1);
  await admin.ok('auditLogs', 'undo', (await find('실물 계약서 사진')).id);
  assert.equal((await admin.ok('contracts', 'paperPhotos', c.id)).length, 0, '추가한 사진이 없어짐');

  // 알림톡 발송은 되돌릴 수 없음
  await admin.ok('notifications', 'send', { contractId: c.id, template: '계약완료', templateKey: '계약완료', variables: {}, buttons: [], target: '고객', brand: '더좋은집', receiverName: who, receiverPhone: '010-3131-4141', message: 'x' });
  const talk = (await admin.ok('auditLogs', 'list', {})).rows.find((r) => r.action === '알림톡 발송');
  if (talk) {
    assert.equal(talk.canUndo, false);
    assert.equal((await admin('auditLogs', 'undo', talk.id)).status, 400);
  }

  // 기능 스위치를 끄면 막힘
  const sup = client();
  await sup.ok('auth', 'login', 'super', 'super-test-1234');
  const good = (await sup.ok('companies', 'list')).find((x) => x.code === 'thegood');
  await sup.ok('companies', 'update', good.id, { features: { auditUndo: false } });
  const g4 = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...g4, contractDate: '2026-10-05' });
  const latest = (await admin.ok('auditLogs', 'list', { q: who }));
  assert.equal(latest.canUndo, false);
  assert.equal((await admin('auditLogs', 'undo', latest.rows[0].id)).status, 403);
  await sup.ok('companies', 'update', good.id, { features: {} });
});

test('빠른 불러오기: 가볍게 읽은 계약을 고치면 알아챔(전체로 다시 처리), 스위치를 끄면 예전처럼 전체 읽기', async () => {
  const { touchedSlim, fingerprint } = await import('../server/pg.js');
  const db = { contracts: [{ id: 1, a: 1 }, { id: 2, a: 2 }] };
  const fp = fingerprint(db);
  assert.equal(touchedSlim(fp, { contracts: [{ id: 1, a: 1 }, { id: 2, a: 2 }, { id: 3 }] }, new Set([2])), false, '새 계약 추가만은 괜찮음');
  assert.equal(touchedSlim(fp, { contracts: [{ id: 1, a: 9 }, { id: 2, a: 2 }] }, new Set([2])), false, '전체로 읽은 계약은 고쳐도 됨');
  assert.equal(touchedSlim(fp, { contracts: [{ id: 1, a: 1 }, { id: 2, a: 3 }] }, new Set([2])), true, '가볍게 읽은 계약을 고침');
  assert.equal(touchedSlim(fp, { contracts: [{ id: 1, a: 1 }] }, new Set([2])), true, '가볍게 읽은 계약을 지움');

  const sup = client();
  await sup.ok('auth', 'login', 'super', 'super-test-1234');
  const good = (await sup.ok('companies', 'list')).find((x) => x.code === 'thegood');
  await sup.ok('companies', 'update', good.id, { features: { fastLoad: false } });
  const c = await admin.ok('contracts', 'create', { ...base, customerName: '빠른끔', customerPhone: '010-6161-7272', memo: '메모 유지' });
  const g = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'update', c.id, { ...g, contractDate: '2026-10-09' });
  assert.equal((await admin.ok('contracts', 'get', c.id)).memo, '메모 유지', '스위치 꺼도 정상');
  await sup.ok('companies', 'update', good.id, { features: {} });
  const other = await admin.ok('contracts', 'get', c.id);
  await admin.ok('contracts', 'addNote', c.id, '상담 메모');
  assert.equal((await admin.ok('contracts', 'get', c.id)).memo, '메모 유지', '다른 요청 뒤에도 긴 글 그대로');
  assert.ok(other.history.length > 0);
});

test('사진 전용 저장소: 새 사진은 저장소에 올리고 DB 에는 경로만, 보낼 때 서명 주소, 실패·스위치 끔이면 DB 에 저장, 되돌리기도 됨', async () => {
  const http = await import('node:http');
  const objects = new Map();
  let failUpload = false;
  const srv = http.createServer(async (req, res) => {
    let raw = Buffer.alloc(0);
    for await (const ch of req) raw = Buffer.concat([raw, ch]);
    assert.equal(req.headers.apikey, process.env.SUPABASE_SERVICE_ROLE_KEY, '비밀 키로 요청');
    assert.equal(req.headers.authorization, process.env.SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_') ? undefined : `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, '새 비밀 키는 Authorization 없이');
    if (req.url === '/storage/v1/bucket') return res.writeHead(409).end('{}');
    if (req.url.startsWith('/storage/v1/object/sign/photos')) {
      const { paths } = JSON.parse(raw.toString());
      return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(paths.map((p) => ({ path: p, signedURL: `/object/sign/photos/${p}?token=t1` }))));
    }
    if (req.url.startsWith('/storage/v1/object/photos/')) {
      if (failUpload) return res.writeHead(500).end('boom');
      objects.set(req.url.slice('/storage/v1/object/photos/'.length), raw);
      return res.writeHead(200).end('{}');
    }
    res.writeHead(404).end();
  });
  await new Promise((ok) => srv.listen(0, ok));
  const port = srv.address().port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const { getPool } = await import('../server/pg.js');
  try {
    const img = 'data:image/jpeg;base64,' + Buffer.from('store-photo-1').toString('base64');
    const c = await admin.ok('contracts', 'create', { ...base, customerName: '저장소고객', customerPhone: '010-5252-6363' });
    await admin.ok('contracts', 'setPaperPhotos', c.id, { add: [img] });
    assert.equal(objects.size, 1, '저장소에 올라감');
    assert.equal([...objects.values()][0].toString(), 'store-photo-1', '사진 내용 그대로');
    const { rows } = await getPool().query(`SELECT data->>'image' AS image FROM payment_receipts WHERE data->>'contractId' = $1`, [String(c.id)]);
    assert.ok(rows[0].image.startsWith('vbstore:'), 'DB 에는 경로만');
    const list = await admin.ok('contracts', 'paperPhotos', c.id);
    assert.ok(list[0].image.startsWith(`http://127.0.0.1:${port}/storage/v1/object/sign/photos/`) && list[0].image.endsWith('?token=t1'), '보낼 때 서명 주소');
    const logs = (await admin.ok('auditLogs', 'list', { q: '저장소고객' })).rows;
    assert.ok(!JSON.stringify(logs).includes('store-photo'), '수정로그에 사진 내용 없음');
    // 되돌리기 (사진 추가 취소)
    await admin.ok('auditLogs', 'undo', logs.find((r) => r.action === '실물 계약서 사진').id);
    assert.equal((await admin.ok('contracts', 'paperPhotos', c.id)).length, 0);
    // 올리기 실패 → DB 에 저장 (사진이 사라지지 않음)
    failUpload = true;
    await admin.ok('contracts', 'setPaperPhotos', c.id, { add: [img] });
    assert.equal((await admin.ok('contracts', 'paperPhotos', c.id))[0].image, img, '실패하면 DB 에');
    failUpload = false;
    // 새 방식 비밀 키(sb_secret_...)
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
    const n0 = objects.size;
    await admin.ok('contracts', 'setPaperPhotos', c.id, { add: [img] });
    assert.equal(objects.size, n0 + 1, '새 비밀 키로도 올라감');
    // 스위치 끄면 DB 에
    const sup = client();
    await sup.ok('auth', 'login', 'super', 'super-test-1234');
    const good = (await sup.ok('companies', 'list')).find((x) => x.code === 'thegood');
    await sup.ok('companies', 'update', good.id, { features: { photoStorage: false } });
    const before = objects.size;
    await admin.ok('contracts', 'setPaperPhotos', c.id, { add: [img] });
    assert.equal(objects.size, before, '스위치 끄면 올리지 않음');
    await sup.ok('companies', 'update', good.id, { features: {} });
  } finally {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    srv.close();
  }
});
