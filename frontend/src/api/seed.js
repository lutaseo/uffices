// ============================================================
// 데이터 초기화 · 마이그레이션 · 샘플 데이터 (브라우저/서버 공용)
//
// 테이블: companies / users / engineers / engineer_offs / teams / products /
//         apartments / customers / contracts / notifications
// 브라우저 데모 모드와 서버(PostgreSQL) 모두 같은 형태의 데이터를 사용합니다.
// ============================================================

import { ROLES, DATA_SCOPES, DEFAULT_MANAGER_PERMISSIONS } from '../auth/permissions.js';
import { addDays, today } from '../utils/date.js';
import { DEFAULT_SCHEDULE_SETTINGS } from '../constants.js';

export const SCHEMA_VERSION = 2;

// 데이터 테이블 목록 (서버 DB 테이블과 1:1)
export const TABLES = [
  'companies',
  'users',
  'engineers',
  'engineerOffs',
  'teams',
  'products',
  'apartments',
  'customers',
  'contracts',
  'notifications',
  'paymentReceipts', // 입금 영수증 사진 (계약과 분리 저장)
];

export function emptyDb() {
  const db = { version: 1, seq: {} };
  TABLES.forEach((t) => {
    db[t] = [];
  });
  return db;
}

export function nextId(db, table) {
  db.seq[table] = (db.seq[table] || 0) + 1;
  return db.seq[table];
}

// 이전 버전 데이터에 새 테이블/필드 추가 (백엔드에서는 DB 마이그레이션 파일이 이 역할)
// 샘플 데이터도 생성 후 이 함수를 거쳐 최신 형태로 맞춥니다.
export function migrate(db) {
  let changed = false;
  if (!db.teams) {
    db.teams = [];
    db.products = [];
    db.apartments = [];
    db.companies.forEach((c) => seedMasterData(db, c.id));
    changed = true;
  }
  db.engineers.forEach((e) => {
    if (e.loginId === undefined) {
      Object.assign(e, { loginId: '', email: '', address: '', memo: '' });
      changed = true;
    }
  });
  // 업체 주소 코드 (예전 데모 데이터: 첫 업체를 thegood 으로)
  db.companies.forEach((c, i) => {
    if (c.code === undefined && i === 0 && !db.companies.some((x) => x.code === 'thegood')) {
      c.code = 'thegood';
      changed = true;
    }
  });
  if (!db.paymentReceipts) {
    db.paymentReceipts = [];
    changed = true;
  }
  db.users.forEach((u) => {
    if (u.teamId === undefined) {
      Object.assign(u, { teamId: null, position: '' });
      changed = true;
    }
  });

  // v2: 계약서 작성 화면 개편 (시공종류/승인/입주예정일/팀배정/모바일웹 보고/상품내역/변경이력), 기사 휴무
  if ((db.version || 1) < 2) {
    const CATEGORY_MAP = { 코팅: '나노코팅' };
    const RECEPTION_MAP = { 음성: '음성계약', 온라인: '사전계약', 소개: '사전계약', 기타: '사전계약' };
    const STATUS_MAP = { 확정: '배정', 시공중: '배정' };
    db.engineerOffs = db.engineerOffs || [];
    db.companies.forEach((c) => {
      c.scheduleSettings = c.scheduleSettings || { ...DEFAULT_SCHEDULE_SETTINGS };
      if (!db.teams.some((t) => t.companyId === c.id && t.kind === '시공팀')) {
        ['스마일팀', '더 클래스'].forEach((name) => {
          db.teams.push({ id: nextId(db, 'teams'), companyId: c.id, name, description: '시공 협력팀', kind: '시공팀', createdAt: new Date().toISOString() });
        });
      }
    });
    db.teams.forEach((t) => {
      t.kind = t.kind || '부서';
    });
    db.engineers.forEach((e) => {
      e.category = CATEGORY_MAP[e.category] || e.category;
      if (e.teamId === undefined) e.teamId = null;
      if (e.passwordHash === undefined) e.passwordHash = null;
    });
    db.products.forEach((p) => {
      p.category = CATEGORY_MAP[p.category] || p.category;
    });
    db.contracts.forEach((c) => {
      c.category = CATEGORY_MAP[c.category] || c.category;
      c.receptionType = RECEPTION_MAP[c.receptionType] || c.receptionType;
      c.status = STATUS_MAP[c.status] || c.status;
      c.workType = c.workType || '시공';
      c.approval = c.approval || '승인';
      c.customerPhone2 = c.customerPhone2 || '';
      c.moveInDate = c.moveInDate || '';
      c.area = c.area || '';
      c.cancelReason = c.cancelReason || '';
      c.happyCallMemo = c.happyCallMemo || '';
      c.lineItems = c.lineItems || [];
      c.history = c.history || [];
      c.schedules = (c.schedules || []).map((s) => ({
        assignType: 'engineer',
        teamId: null,
        mobileStatus: '',
        mobileMemo: '',
        reportedAt: null,
        ...s,
      }));
      c.payments = (c.payments || []).map((p, i) => ({ kind: i === 0 ? '계약금' : '잔금', memo: '', ...p }));
    });
    db.version = 2;
    changed = true;
  }
  return changed;
}

// 업체 기초코드 샘플 (팀/상품/아파트)
export function seedMasterData(db, companyId) {
  const now = new Date().toISOString();
  [
    ['상담팀', '전화/온라인 상담 및 계약'],
    ['박람회팀', '박람회 현장 계약'],
    ['시공팀', '시공 일정 및 기사 관리'],
  ].forEach(([name, description]) => {
    db.teams.push({ id: nextId(db, 'teams'), companyId, name, description, createdAt: now });
  });
  [
    ['메디알레6 줄눈 (욕실 1곳)', '패키지', '줄눈', '메디알레6 줄눈 : 욕실1곳 바닥(폴리) + 현관 sv(폴리) + 욕조벽 ㄷ자(폴리)', 450000],
    ['힐스 등촌2 줄눈', '패키지', '줄눈', '욕실2곳 바닥(빅라이언)+현관(폴리) + 욕조벽ㄷ자(폴리) + 샤워벽 ㄷ자(폴리)', 890000],
    ['탄성코트(고급형)', '패키지', '탄성', '시공범위 : 세탁실 + 베란다 + 실외기실(대피실)', 1100000],
    ['욕실패키지 코팅(화장실2개소)', '패키지', '나노코팅', '샤워부스 유리 양면코팅(1) - 수납장 거울(2) - 세면대(2) - 양변기(2)', 600000],
    ['샤워부스 안쪽 벽 3면 타일코팅[s.v]', '추가시공품목', '나노코팅', '샤워부스 안쪽 벽 3면 타일코팅[s.v]', 150000],
    ['입주청소 기본', '패키지', '청소', '전체 입주청소 (외창 제외)', 440000],
    ['현관 실리콘 오염방지', '무료시공', '줄눈', '(s.v)주방&욕실 실리콘 오염방지', 0],
  ].forEach(([name, kind, category, detail, price]) => {
    db.products.push({ id: nextId(db, 'products'), companyId, name, kind, category, detail, price, visible: true, createdAt: now });
  });
  [
    ['서울특별시', '강서구', '힐스테이트 등촌역'],
    ['서울특별시', '은평구', '힐스테이트 메디알레'],
    ['서울특별시', '서초구', '디에이치 방배'],
    ['서울특별시', '동작구', '힐스테이트 장승배기'],
    ['경기도', '하남시', '미사 하우스디 더레이크'],
    ['강원도', '강릉시', '강릉 오션시티 아이파크'],
    ['서울특별시', '서초구', '래미안 원베일리'],
  ].forEach(([sido, sigungu, name]) => {
    db.apartments.push({ id: nextId(db, 'apartments'), companyId, sido, sigungu, name, createdAt: now });
  });
}


// ------------------------------------------------------------
// 샘플 데이터
// ------------------------------------------------------------

// 매번 같은 샘플이 나오도록 고정 시드 난수 사용
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const APTS = [
  { name: '디에이치 방배', type: '84A타입' },
  { name: '힐스테이트 메디알레', type: '84타입' },
  { name: '힐스테이트 장승배기', type: '84타입' },
  { name: '강릉 오션시티 아이파크', type: '84B타입' },
  { name: '미사 하우스디 더레이크', type: '59타입' },
  { name: '래미안 원베일리', type: '112타입' },
];
const LAST = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임'];
const FIRST = ['혜준', '성호', '기순', '승일', '동호', '정하', '은하', '지희', '동훈', '주원', '형진', '다움'];
const ITEMS = {
  청소: '플러스 청소 외창 / (현관, 바닥)',
  줄눈: '욕실2개(빅라이언) + 현관 / (s.v)주방&욕실 실리콘 오염방지',
  나노코팅: '욕실 나노코팅 2개 + 주방상판',
  탄성: '베란다 탄성코트 3곳',
  코팅: '바닥 코팅 전체',
  기타: '',
};

export async function buildSeed(hashPassword) {
  const db = emptyDb();
  const now = new Date().toISOString();
  const t = today();

  const company = {
    id: nextId(db, 'companies'),
    code: 'thegood', // 업체 주소: /thegood
    name: '더좋은집',
    ceo: '장경국',
    bizNo: '888-51-01056',
    address: '경기도 하남시 조정대로 35, 10층 에프 1013호',
    brands: ['더좋은집', '더스타트'],
    periodStart: addDays(t, -100),
    periodEnd: addDays(t, 20),
    active: true,
    contractSeq: 0,
    createdAt: now,
  };
  db.companies.push(company);

  const mk = async (u) => ({
    id: nextId(db, 'users'),
    active: true,
    createdAt: now,
    lastLoginAt: null,
    phone: '',
    permissions: [],
    dataScope: DATA_SCOPES.ALL,
    ...u,
    passwordHash: await hashPassword(u.password),
    password: undefined,
  });

  db.users.push(await mk({ loginId: 'super', password: 'super1234', name: '유피스 운영자', role: ROLES.SUPER, companyId: null }));
  const admin = await mk({ loginId: 'admin', password: 'admin1234', name: '장경국', role: ROLES.ADMIN, companyId: company.id, phone: '010-1000-2000' });
  db.users.push(admin);
  const manager = await mk({
    loginId: 'manager',
    password: 'manager1234',
    name: '이실장',
    role: ROLES.MANAGER,
    companyId: company.id,
    phone: '010-5555-6666',
    createdBy: admin.id,
    permissions: [...DEFAULT_MANAGER_PERMISSIONS],
    dataScope: DATA_SCOPES.OWN,
  });
  db.users.push(manager);

  [
    ['공두환', '010-2001-1001', '줄눈'],
    ['김준영', '010-2001-1002', '줄눈'],
    ['문종만', '010-2001-1003', '줄눈'],
    ['양정훈', '010-2001-1004', '청소'],
    ['박영노', '010-2001-1005', '청소'],
    ['김필', '010-2001-1006', '코팅'],
    ['박태종', '010-2001-1007', '코팅'],
    ['김주하', '010-2001-1008', '탄성'],
  ].forEach(([name, phone, category]) => {
    db.engineers.push({
      id: nextId(db, 'engineers'),
      companyId: company.id,
      name,
      phone,
      category,
      loginId: '',
      email: '',
      address: '',
      memo: '',
      active: true,
    });
  });
  seedMasterData(db, company.id);
  const counselTeam = db.teams.find((t) => t.companyId === company.id && t.name === '상담팀');
  db.users.forEach((u) => {
    u.teamId = u.role === ROLES.MANAGER ? counselTeam.id : null;
    u.position = u.role === ROLES.ADMIN ? '대표' : u.role === ROLES.MANAGER ? '실장' : '';
  });

  const r = rng(20260927);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  for (let i = 0; i < 48; i++) {
    const name = pick(LAST) + pick(FIRST);
    const phone = `010-${String(2000 + Math.floor(r() * 7999))}-${String(1000 + Math.floor(r() * 8999))}`;
    let customer = db.customers.find((c) => c.phone1 === phone);
    if (!customer) {
      customer = {
        id: nextId(db, 'customers'),
        companyId: company.id,
        userType: '개인',
        name,
        phone1: phone,
        phone2: '',
        email: '',
        zipcode: '',
        address1: '',
        address2: '',
        createdAt: now,
      };
      db.customers.push(customer);
    }
    const apt = pick(APTS);
    const category = pick(['청소', '줄눈', '줄눈', '나노코팅', '탄성']);
    const contractDate = addDays(t, -Math.floor(r() * 75));
    const schedDate = addDays(contractDate, 5 + Math.floor(r() * 40));
    const eng = db.engineers.filter((e) => e.category === category || category === '나노코팅');
    const engineer = eng.length ? pick(eng) : null;
    const total = (5 + Math.floor(r() * 20)) * 100000;
    const discount = r() < 0.2 ? 50000 : 0;
    const deposit = pick([0, 30000, 50000, 100000]);
    let status = schedDate < t ? '시공완료' : pick(['미정', '미정', '확정']);
    if (r() < 0.08) status = '취소';
    const payments = [];
    if (deposit) payments.push({ id: 1, date: contractDate, method: pick(['카드', '계좌이체', '현금']), amount: deposit });
    if (status === '시공완료') payments.push({ id: 2, date: schedDate, method: pick(['카드', '계좌이체']), amount: total - discount - deposit });

    company.contractSeq += 1;
    db.contracts.push({
      id: nextId(db, 'contracts'),
      companyId: company.id,
      no: company.contractSeq,
      brand: r() < 0.8 ? '더좋은집' : '더스타트',
      category,
      receptionType: pick(['음성', '음성', '박람회', '온라인']),
      status,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone1,
      aptName: apt.name,
      dong: String(100 + Math.floor(r() * 20)),
      ho: String((1 + Math.floor(r() * 25)) * 100 + 1 + Math.floor(r() * 4)),
      aptType: apt.type,
      items: ITEMS[category],
      contractDate,
      schedules: [
        {
          date: schedDate,
          time: pick(['09:00', '10:00', '13:00', '14:00']),
          ampm: '',
          engineerId: engineer?.id || null,
          memo: '',
        },
      ],
      completedDate: status === '시공완료' ? schedDate : '',
      canceledDate: status === '취소' ? addDays(contractDate, 2) : '',
      totalAmount: total,
      discount,
      voucher: 0,
      payments,
      memo: '',
      esign: status === '미정' && r() < 0.5
        ? { status: '미발송', token: null }
        : { status: '서명완료', token: null, signedAt: `${contractDate}T12:00:00.000Z`, signerName: customer.name, signature: null },
      ownerId: i % 4 === 0 ? manager.id : admin.id,
      createdAt: `${contractDate}T09:00:00.000Z`,
      updatedAt: now,
      deletedAt: null,
    });
  }

  migrate(db);

  // 기사모바일 데모 계정 (공두환 기사) + 스마일팀 소속
  const smile = db.teams.find((x) => x.name === '스마일팀');
  const gong = db.engineers.find((e) => e.name === '공두환');
  gong.loginId = 'gong';
  gong.passwordHash = await hashPassword('gong1234');
  gong.teamId = smile.id;
  db.engineers.find((e) => e.name === '김준영').teamId = smile.id;

  // 휴무 샘플 (배정된 일정과 겹치지 않는 날만)
  [
    ['박영노', 1, 'DAY', '개인 사정'],
    ['김준영', 2, 'AM', '병원'],
    ['양정훈', 2, 'PM', '가족 행사'],
    ['문종만', 4, 'DAY', '휴가'],
    ['공두환', 6, 'AM', '자재 수령'],
  ].forEach(([name, plus, period, reason]) => {
    const e = db.engineers.find((x) => x.name === name);
    const date = addDays(t, plus);
    const busy = db.contracts.some((c) => c.schedules.some((sc) => sc.engineerId === e.id && sc.date === date));
    if (busy) return;
    db.engineerOffs.push({
      id: nextId(db, 'engineerOffs'),
      companyId: company.id,
      engineerId: e.id,
      date,
      period,
      reason,
      createdBy: admin.id,
      createdAt: now,
    });
  });
  return db;
}
