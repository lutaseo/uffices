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

test('실장 권한: 본인 작성 건만, 금액 숨김, 삭제 불가, 승인대기로 등록', async () => {
  const all = await admin.ok('contracts', 'list', {});
  const mine = await manager.ok('contracts', 'list', {});
  assert.ok(mine.length > 0 && mine.length < all.length);
  assert.ok(mine.every((c) => c.totalAmount === null));
  const other = all.find((c) => !mine.some((m) => m.id === c.id));
  assert.equal((await manager('contracts', 'get', other.id)).status, 404);
  assert.equal((await manager('contracts', 'moveToTrash', [mine[0].id])).status, 403);
  const created = await manager.ok('contracts', 'create', { ...base, customerName: '실장고객' });
  assert.equal(created.approval, '승인대기');
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

test('로그인 5회 실패 시 잠금, 로그아웃 후 차단', async () => {
  const bad = client();
  for (let i = 0; i < 5; i++) assert.equal((await bad('auth', 'login', 'manager', 'wrong')).status, 400);
  const r = await bad('auth', 'login', 'manager', 'manager1234');
  assert.match(r.error.message, /잠겼습니다/);

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

  assert.equal((await manager('contracts', 'addPayment', a.id, { amount: 1000 })).status, 403, '수정 권한 없는 실장은 입금 등록 불가');

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
  assert.deepEqual(await anon.ok('companies', 'publicInfo', 'thegood'), { code: 'thegood', name: '더좋은집' });
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

test('고객 참고사항: 저장·이력, 서명 링크(고객)에는 보이고 내부 메모는 숨김, 서명 후 바뀌면 재서명', async () => {
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
  const u = await admin.ok('contracts', 'update', c.id, { ...full, customerNote: '바뀐 안내' });
  assert.notEqual(u.esign.status, '서명완료', '고객 참고사항이 바뀌면 다시 서명 필요');
  assert.ok(u.history.at(-1).changes.some((ch) => ch.label === '고객 참고사항'));
  const row = (await admin.ok('contracts', 'list', {})).find((x) => x.id === c.id);
  assert.equal(row.customerNote, undefined, '목록에는 안 보냄');
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
});

test('줄눈·청소 한 장 계약서: 한 링크로 묶어 한 번에 서명, 다른 현장·이미 서명한 건은 제외', async () => {
  const site = { ...base, customerName: '한장고객', customerPhone: '010-6060-1212', aptName: '한장아파트', dong: '102', ho: '303' };
  const a = await admin.ok('contracts', 'create', { ...site, category: '줄눈', totalAmount: 500000, customerNote: '줄눈 안내' });
  const b = await admin.ok('contracts', 'create', { ...site, category: '청소', totalAmount: 300000, customerNote: '청소 안내' });
  const other = await admin.ok('contracts', 'create', { ...site, ho: '404', category: '탄성' }); // 다른 호수

  const before = await admin.ok('contracts', 'signBundle', b.id);
  assert.deepEqual(before.contracts.map((c) => c.id), [a.id, b.id], '서명 전: 같은 현장의 줄눈·청소 함께');
  assert.equal(before.token, null, '아직 링크 없음');

  const { token, count } = await admin.ok('contracts', 'requestSign', a.id);
  assert.equal(count, 2);
  const anon = client();
  const view = await anon.ok('esign', 'getByToken', token);
  assert.deepEqual(view.contracts.map((c) => c.category), ['줄눈', '청소']);
  assert.deepEqual(view.contracts.map((c) => c.customerNote), ['줄눈 안내', '청소 안내']);
  assert.ok(view.contracts.every((c) => c.memo === undefined && c.history === undefined));
  assert.equal((await admin.ok('contracts', 'signBundle', b.id)).token, token, '청소 쪽에서 봐도 같은 링크');

  const img = 'data:image/png;base64,QUJD';
  await anon.ok('esign', 'sign', token, { signerName: '한장고객', signature: img, agreed: true });
  for (const id of [a.id, b.id]) {
    const c = await admin.ok('contracts', 'get', id);
    assert.equal(c.esign.status, '서명완료');
    assert.equal(c.esign.signature, img, '두 계약 모두 서명 이미지 저장');
  }
  assert.equal((await admin.ok('contracts', 'get', other.id)).esign.status, '미발송', '다른 현장은 그대로');
  const again = await anon.ok('esign', 'getByToken', token);
  assert.ok(again.contracts.every((c) => c.esign.status === '서명완료' && c.esign.signature === img), '서명 후 다시 열면 둘 다 서명 표시');
  const r = await anon('esign', 'sign', token, { signerName: '한장고객', signature: img, agreed: true });
  assert.notEqual(r.status, 200, '두 번 서명 불가');

  // 서명 후 청소를 하나 더 추가 → 새 요청에는 서명 안 된 것만
  const c3 = await admin.ok('contracts', 'create', { ...site, category: '탄성' });
  const later = await admin.ok('contracts', 'signBundle', c3.id);
  assert.deepEqual(later.contracts.map((c) => c.id), [c3.id], '이미 서명한 줄눈·청소는 다시 서명하지 않음');
  const signedView = await admin.ok('contracts', 'signBundle', a.id);
  assert.deepEqual(signedView.contracts.map((c) => c.id), [a.id, b.id], '서명한 계약서는 함께 서명한 묶음으로 보임');
  assert.ok(signedView.contracts.every((c) => c.esign.signature === img));
});
