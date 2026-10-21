// ============================================================
// 서비스 계층 (업무 로직 + 권한 검사)
//
// 이 코드는 두 곳에서 똑같이 실행됩니다.
//   - 데모 모드: 브라우저에서 직접 실행 (저장소 = localStorage)
//   - 서버 모드: 서버(/api/rpc)에서 실행 (저장소 = PostgreSQL), 화면은 api/index.js 를 통해 요청만 보냄
// 권한 검사는 여기서 하므로, 서버 모드에서는 화면을 우회해도 차단됩니다.
//
//   core.js      세션/권한 공통
//   contracts.js 계약·전자서명·알림톡·통계
//   schedule.js  일정·기사 휴무·기사모바일·일정관리설정
// ============================================================

import {
  loadDb,
  saveDb,
  nextId,
  hashPassword,
  verifyPassword,
  setSession,
  clearSession,
  resetDemoData,
} from './runtime.js';
import { ROLES, DATA_SCOPES, permissionsOf, isOwnScopeOnly, ALL_PERMISSION_KEYS } from '../auth/permissions.js';
import { digitsOnly, formatPhone } from '../utils/format.js';
import { CATEGORIES, DEPARTMENTS, brandTerms, termsSource } from '../constants.js';
import { AUDIT_KEEP_DAYS, auditText } from './audit.js';
import {
  ApiError,
  authorize,
  clone,
  companyAccessError,
  engineerAsUser,
  isLoginIdTaken,
  nowIso,
  publicUser,
  session,
  validatePassword,
  visibleContracts,
} from './core.js';

export { ApiError } from './core.js';
export { contracts, esign, notifications, reports, imports, customerApp } from './contracts.js';
export { schedules, engineerOffs, engineerApp, scheduleSettings } from './schedule.js';

// ============================================================
// 수정 로그 (설정 > 수정로그, 업체 관리자) — 최근 2주, 서버가 저장할 때 자동 기록
//   데모 모드(브라우저)에서는 기록하지 않음
// ============================================================
export const auditLogs = {
  async list({ from = '', to = '', actor = '', q = '' } = {}) {
    const { db, user } = await session();
    if (user.role !== ROLES.ADMIN) throw new ApiError('업체 관리자만 볼 수 있습니다.', 'FORBIDDEN');
    const since = new Date(Date.now() - AUDIT_KEEP_DAYS * 86400000).toISOString();
    const text = String(q || '').trim();
    const rows = (db.auditLogs || []).filter((r) => {
      if (r.at < since) return false;
      const day = new Date(Date.parse(r.at) + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (actor && `${r.actor?.kind}:${r.actor?.id}` !== actor) return false;
      if (text && !`${r.actor?.name} ${r.action} ${auditText(r)}`.includes(text)) return false;
      return true;
    });
    return { keepDays: AUDIT_KEEP_DAYS, demo: !db.auditLogs, rows: clone(rows.slice(0, 1000)) };
  },
};

// ============================================================
// 인증   POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
// ============================================================

// 로그인 연속 실패 시 잠금 (무차별 대입 방지)
const MAX_LOGIN_FAIL = 5;
const LOCK_MINUTES = 10;
const LOGIN_FAIL_MSG = '아이디 또는 비밀번호가 올바르지 않습니다.';

function assertNotLocked(rec) {
  if (rec?.lockedUntil && rec.lockedUntil > nowIso()) {
    const until = new Date(rec.lockedUntil).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    throw new ApiError(`비밀번호를 ${MAX_LOGIN_FAIL}회 잘못 입력해 ${until}까지 로그인이 잠겼습니다.`);
  }
}

async function checkPassword(db, rec, password) {
  assertNotLocked(rec);
  if (await verifyPassword(password, rec.passwordHash)) {
    rec.loginFailCount = 0;
    rec.lockedUntil = null;
    return;
  }
  rec.loginFailCount = (rec.loginFailCount || 0) + 1;
  if (rec.loginFailCount >= MAX_LOGIN_FAIL) {
    rec.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    rec.loginFailCount = 0;
  }
  saveDb(db); // 실패 횟수는 로그인 실패여도 저장
  throw new ApiError(LOGIN_FAIL_MSG);
}

export const auth = {
  // companyCode: 업체 주소(veritybase.vercel.app/thegood)에서 로그인하면 그 업체 계정만 허용
  // kind: 'engineer' = 기사모바일(/업체주소/m) 로그인 → 기사 계정만
  //       그 외(일반 화면 /업체주소) → 직원 계정, 그 아이디의 직원이 없으면 기사 계정 (예전처럼 일반 화면에서 들어온 기사)
  async login(loginId, password, companyCode, kind) {
    const db = await loadDb();
    const id = String(loginId || '').trim();
    const code = String(companyCode || '').trim().toLowerCase();
    const company = code ? db.companies.find((c) => c.code === code) : null;
    if (code && !company) throw new ApiError('존재하지 않는 업체 주소입니다. 주소를 확인해 주세요.');
    const sameCompany = (rec) => !company || rec.companyId === company.id;
    const user = kind === 'engineer' ? null : db.users.find((u) => u.loginId === id && sameCompany(u));
    if (user) {
      await checkPassword(db, user, password);
      if (!user.active) throw new ApiError('사용이 중지된 계정입니다. 관리자에게 문의해 주세요.');
      const err = companyAccessError(db, user);
      if (err) throw new ApiError(err);
      user.lastLoginAt = nowIso();
      saveDb(db);
      await setSession({ userId: user.id });
      return auth.me();
    }
    // 기사 계정 (기사모바일)
    const engineer = db.engineers.find((e) => e.loginId === id && e.passwordHash && sameCompany(e));
    if (!engineer) throw new ApiError(LOGIN_FAIL_MSG);
    await checkPassword(db, engineer, password);
    if (!engineer.active) throw new ApiError('사용이 중지된 기사 계정입니다. 사무실에 문의해 주세요.');
    const err = companyAccessError(db, engineerAsUser(engineer));
    if (err) throw new ApiError(err);
    engineer.lastLoginAt = nowIso();
    saveDb(db);
    await setSession({ engineerId: engineer.id });
    return auth.me();
  },

  async logout() {
    await clearSession();
  },

  async me() {
    const { db, user } = await session();
    const company = db.companies.find((c) => c.id === user.companyId) || null;
    return { user: publicUser(user), company: company && clone(company) };
  },

  async changePassword(currentPassword, newPassword) {
    const { db, user } = await session();
    const record = user.role === ROLES.ENGINEER ? db.engineers.find((e) => e.id === user.engineerId) : user;
    if (!(await verifyPassword(currentPassword, record.passwordHash))) throw new ApiError('현재 비밀번호가 올바르지 않습니다.');
    validatePassword(newPassword);
    record.passwordHash = await hashPassword(newPassword);
    saveDb(db);
  },

  resetDemoData,
};

// ============================================================
// 업체 (운영자 전용)   GET/POST/PATCH /api/companies
// ============================================================

// 업체 주소 코드: veritybase.vercel.app/{코드}  (영문 소문자로 시작, 영문 소문자·숫자·-, 2~20자)
export const RESERVED_CODES = ['admin', 'api', 'sign', 'contracts', 'customers', 'schedule', 'progress', 'stats', 'settings', 'me', 'engineer', 'assets', 'login', 'uffice', 'www', 'c', 'e', 'm'];
function normalizeCode(db, code, exceptId) {
  const v = String(code || '').trim().toLowerCase();
  if (!/^[a-z][a-z0-9-]{1,19}$/.test(v)) throw new ApiError('업체 주소 코드는 영문 소문자로 시작하는 영문·숫자·- 2~20자로 입력해 주세요. (예: thegood)');
  if (RESERVED_CODES.includes(v)) throw new ApiError('사용할 수 없는 주소 코드입니다. 다른 코드를 입력해 주세요.');
  if (db.companies.some((c) => c.code === v && c.id !== exceptId)) throw new ApiError('이미 다른 업체가 쓰고 있는 주소 코드입니다.');
  return v;
}

export const companies = {
  // 로그인 화면용 (로그인 전): 주소 코드로 업체 이름만 조회
  async publicInfo(code) {
    const db = await loadDb();
    const c = db.companies.find((x) => x.code && x.code === String(code || '').toLowerCase());
    return c ? { code: c.code, name: c.name } : null;
  },

  async list() {
    const { db, user } = await session();
    if (user.role !== ROLES.SUPER) throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
    return db.companies.map((c) => ({
      ...clone(c),
      admins: db.users.filter((u) => u.companyId === c.id && u.role === ROLES.ADMIN).map(publicUser),
      managerCount: db.users.filter((u) => u.companyId === c.id && u.role === ROLES.MANAGER).length,
      contractCount: db.contracts.filter((x) => x.companyId === c.id && !x.deletedAt).length,
    }));
  },

  // 업체 + 최초 관리자 계정을 함께 발급
  async create({ company, admin }) {
    const { db, user } = await session();
    if (user.role !== ROLES.SUPER) throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
    if (!company.name?.trim()) throw new ApiError('업체명을 입력해 주세요.');
    if (!company.periodStart || !company.periodEnd || company.periodStart > company.periodEnd) {
      throw new ApiError('이용기간을 올바르게 입력해 주세요.');
    }
    const code = normalizeCode(db, company.code);
    const newCompany = {
      id: nextId(db, 'companies'),
      code,
      name: company.name.trim(),
      ceo: company.ceo || '',
      bizNo: company.bizNo || '',
      address: company.address || '',
      brands: company.brands?.length ? company.brands : [company.name.trim()],
      periodStart: company.periodStart,
      periodEnd: company.periodEnd,
      active: true,
      contractSeq: 0,
      createdAt: nowIso(),
    };
    const adminUser = await buildUser(db, { ...admin, role: ROLES.ADMIN, companyId: newCompany.id, createdBy: user.id });
    db.companies.push(newCompany);
    db.users.push(adminUser);
    saveDb(db);
    return clone(newCompany);
  },

  async update(id, patch) {
    const { db, user } = await session();
    if (user.role !== ROLES.SUPER) throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
    const c = db.companies.find((x) => x.id === id);
    if (!c) throw new ApiError('업체를 찾을 수 없습니다.', 'NOT_FOUND');
    if ('code' in patch) patch = { ...patch, code: normalizeCode(db, patch.code, c.id) };
    const allowed = ['code', 'name', 'ceo', 'bizNo', 'address', 'brands', 'periodStart', 'periodEnd', 'active'];
    allowed.forEach((k) => {
      if (k in patch) c[k] = patch[k];
    });
    if (c.periodStart > c.periodEnd) throw new ApiError('이용기간을 올바르게 입력해 주세요.');
    saveDb(db);
    return clone(c);
  },

  // ---------------- 계약조건 (운영자 전용) ----------------
  // 업체별 · 브랜드별 지금 계약서에 쓰이는 조건 (입력 안 했으면 예전 고정 조건 또는 기본 조건)
  async termsSettings() {
    const { db, user } = await session();
    if (user.role !== ROLES.SUPER) throw new ApiError('운영자만 볼 수 있습니다.', 'FORBIDDEN');
    return {
      categories: [...CATEGORIES],
      companies: db.companies.map((c) => {
        const brands = c.brands?.length ? c.brands : Object.keys(c.contractTerms || {});
        return {
          id: c.id,
          name: c.name,
          code: c.code,
          brands: [...brands],
          terms: Object.fromEntries(brands.map((b) => [b, clone(brandTerms(c, b))])),
          saved: Object.fromEntries(brands.map((b) => [b, termsSource(c, b) === 'saved'])),
          source: Object.fromEntries(brands.map((b) => [b, termsSource(c, b)])),
        };
      }),
    };
  },

  // 브랜드 계약조건 저장. terms = 묶음 목록 ('[구분]' 첫 줄 + 항목들 / 구분 없는 묶음 = 중요 조항). 빈 목록이면 기본 조건으로
  async saveContractTerms({ companyId, brand, terms } = {}) {
    const { db, user } = await session();
    if (user.role !== ROLES.SUPER) throw new ApiError('운영자만 바꿀 수 있습니다.', 'FORBIDDEN');
    const c = db.companies.find((x) => x.id === Number(companyId));
    if (!c) throw new ApiError('업체를 선택해 주세요.');
    const b = String(brand || '').trim();
    if (!b || (c.brands?.length && !c.brands.includes(b))) throw new ApiError('이 업체의 브랜드가 아닙니다.');
    if (!Array.isArray(terms)) throw new ApiError('계약 조건 형식이 올바르지 않습니다.');
    const clean = terms.map((t) => String(t ?? '').replace(/\r\n?/g, '\n').trim()).filter(Boolean);
    if (clean.length > 30) throw new ApiError('조건 묶음은 30개까지 넣을 수 있습니다.');
    if (clean.some((t) => t.length > 5000)) throw new ApiError('한 묶음은 5,000자까지 넣을 수 있습니다.');
    c.contractTerms = { ...(c.contractTerms || {}), [b]: clean };
    if (!clean.length) delete c.contractTerms[b];
    saveDb(db);
    return clone(brandTerms(c, b));
  },
};

// ============================================================
// 계정 (운영자: 업체 관리자 / 관리자: 실장)   GET/POST/PATCH /api/users
// ============================================================

async function buildUser(db, data) {
  const loginId = (data.loginId || '').trim();
  if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(loginId)) throw new ApiError('아이디는 영문/숫자 3~20자로 입력해 주세요.');
  if (isLoginIdTaken(db, loginId, { kind: 'user' })) throw new ApiError('이미 사용 중인 아이디입니다.');
  if (!data.name?.trim()) throw new ApiError('이름을 입력해 주세요.');
  validatePassword(data.password);
  return {
    id: nextId(db, 'users'),
    loginId,
    passwordHash: await hashPassword(data.password),
    name: data.name.trim(),
    phone: data.phone ? formatPhone(data.phone) : '',
    role: data.role,
    companyId: data.companyId,
    permissions: data.role === ROLES.MANAGER ? data.permissions || [] : [],
    dataScope: data.dataScope || DATA_SCOPES.ALL,
    teamId: data.teamId ? Number(data.teamId) : null,
    department: DEPARTMENTS.includes(data.department) ? data.department : '',
    position: data.position || '',
    active: true,
    createdBy: data.createdBy,
    createdAt: nowIso(),
    lastLoginAt: null,
  };
}

// 요청자가 대상 계정을 관리할 수 있는지
function assertCanManage(actor, target) {
  if (actor.role === ROLES.SUPER && target.role === ROLES.ADMIN) return;
  if (actor.role === ROLES.ADMIN && target.role === ROLES.MANAGER && target.companyId === actor.companyId) return;
  throw new ApiError('해당 계정을 관리할 권한이 없습니다.', 'FORBIDDEN');
}

// 관리자는 본인이 가진 권한 범위 안에서만 위임 가능
function sanitizePermissions(actor, permissions = []) {
  const own = permissionsOf(actor);
  return permissions.filter((p) => ALL_PERMISSION_KEYS.includes(p) && own.includes(p));
}

export const users = {
  async list() {
    const { db, user } = await session();
    if (user.role === ROLES.SUPER) return db.users.filter((u) => u.role === ROLES.ADMIN).map(publicUser);
    if (user.role === ROLES.ADMIN) {
      return db.users.filter((u) => u.companyId === user.companyId && u.role === ROLES.MANAGER).map(publicUser);
    }
    throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
  },

  // 운영자 → 기존 업체에 관리자 추가 / 관리자 → 실장 생성
  async create(data) {
    const { db, user } = await session();
    let newUser;
    if (user.role === ROLES.SUPER) {
      if (!db.companies.some((c) => c.id === Number(data.companyId))) throw new ApiError('업체를 선택해 주세요.');
      newUser = await buildUser(db, { ...data, companyId: Number(data.companyId), role: ROLES.ADMIN, createdBy: user.id });
    } else if (user.role === ROLES.ADMIN) {
      newUser = await buildUser(db, {
        ...data,
        role: ROLES.MANAGER,
        companyId: user.companyId,
        permissions: sanitizePermissions(user, data.permissions),
        dataScope: data.dataScope === DATA_SCOPES.OWN ? DATA_SCOPES.OWN : DATA_SCOPES.ALL,
        createdBy: user.id,
      });
    } else {
      throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
    }
    db.users.push(newUser);
    saveDb(db);
    return publicUser(newUser);
  },

  async update(id, patch) {
    const { db, user } = await session();
    const target = db.users.find((u) => u.id === id);
    if (!target) throw new ApiError('계정을 찾을 수 없습니다.', 'NOT_FOUND');
    assertCanManage(user, target);
    if ('name' in patch) {
      if (!patch.name.trim()) throw new ApiError('이름을 입력해 주세요.');
      target.name = patch.name.trim();
    }
    if ('phone' in patch) target.phone = formatPhone(patch.phone);
    if ('active' in patch) target.active = !!patch.active;
    if ('teamId' in patch) target.teamId = patch.teamId ? Number(patch.teamId) : null;
    if ('position' in patch) target.position = patch.position || '';
    if ('department' in patch) target.department = DEPARTMENTS.includes(patch.department) ? patch.department : '';
    if (target.role === ROLES.MANAGER) {
      if ('permissions' in patch) target.permissions = sanitizePermissions(user, patch.permissions);
      if ('dataScope' in patch) target.dataScope = patch.dataScope === DATA_SCOPES.OWN ? DATA_SCOPES.OWN : DATA_SCOPES.ALL;
    }
    if (patch.password) {
      validatePassword(patch.password);
      target.passwordHash = await hashPassword(patch.password);
    }
    saveDb(db);
    return publicUser(target);
  },

  // 담당자(작성자) 선택 목록용 — 같은 업체의 관리자/실장 이름
  async staffOptions() {
    const { db, user } = await session();
    return db.users
      .filter((u) => u.companyId === user.companyId && u.role !== ROLES.SUPER)
      .map((u) => ({ id: u.id, name: u.name, role: u.role }));
  },
};

// ============================================================
// 기초코드 (설정 메뉴): 시공기사 / 팀 / 상품 / 아파트
//   GET/POST/PATCH/DELETE /api/{engineers|teams|products|apartments}
//   조회는 업체 내 모든 계정 가능(계약 등록 화면에서 사용), 변경은 settings.manage 권한
// ============================================================

function masterTable(table, { normalize, sort, beforeRemove, present = (r) => r }) {
  return {
    async list({ includeInactive = false } = {}) {
      const { db, user } = await session();
      return clone(
        db[table]
          .filter((r) => r.companyId === user.companyId)
          .filter((r) => includeInactive || (r.active !== false && r.visible !== false))
          .sort(sort || ((a, b) => a.id - b.id)) // 번호순 (등록 순서)
          .map(present),
      );
    },

    async save(data) {
      const { db, user } = await authorize('settings.manage');
      const fields = await normalize(data, db, user);
      let row;
      if (data.id) {
        row = db[table].find((r) => r.id === data.id && r.companyId === user.companyId);
        if (!row) throw new ApiError('항목을 찾을 수 없습니다.', 'NOT_FOUND');
        Object.assign(row, fields, { updatedAt: nowIso() });
      } else {
        row = { id: nextId(db, table), companyId: user.companyId, createdAt: nowIso(), ...fields };
        db[table].push(row);
      }
      saveDb(db);
      return clone(present(row));
    },

    async remove(id) {
      const { db, user } = await authorize('settings.manage');
      const row = db[table].find((r) => r.id === id && r.companyId === user.companyId);
      if (!row) return;
      if (beforeRemove && beforeRemove(db, row) === false) {
        saveDb(db);
        return;
      }
      db[table] = db[table].filter((r) => r !== row);
      saveDb(db);
    },
  };
}

// 예전 기사 데이터는 담당시공이 하나(category)뿐이라, 없으면 그것으로 채움
const categoriesOf = (e) => (Array.isArray(e.categories) ? e.categories : CATEGORIES.filter((c) => c === e.category));

const required = (v, msg) => {
  if (!String(v ?? '').trim()) throw new ApiError(msg);
  return String(v).trim();
};

export const engineers = masterTable('engineers', {
  // 비밀번호 해시는 내려주지 않음
  present: ({ passwordHash, ...rest }) => ({ ...rest, categories: categoriesOf(rest), hasPassword: !!passwordHash }),
  normalize: async (d, db, user) => {
    const loginId = (d.loginId || '').trim();
    const existing = d.id ? db.engineers.find((e) => e.id === d.id) : null;
    if (existing?.loginId && loginId !== existing.loginId && user.role !== ROLES.ADMIN) {
      throw new ApiError('기사 아이디는 업체 관리자만 바꿀 수 있습니다.', 'FORBIDDEN');
    }
    if (loginId) {
      if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(loginId)) throw new ApiError('기사 아이디는 영문/숫자 3~20자로 입력해 주세요.');
      if (isLoginIdTaken(db, loginId, { kind: 'engineer', exceptEngineerId: d.id })) throw new ApiError('이미 사용 중인 기사 아이디입니다.');
    }
    let passwordHash = existing?.passwordHash || null;
    if (d.password) {
      validatePassword(d.password);
      passwordHash = await hashPassword(d.password);
    }
    if (!loginId) passwordHash = null; // 아이디가 없으면 기사모바일 로그인 불가
    const teamId = db.teams.some((t) => t.id === Number(d.teamId) && t.companyId === user.companyId && t.kind === '시공팀')
      ? Number(d.teamId)
      : null;
    const categories = Array.isArray(d.categories)
      ? CATEGORIES.filter((c) => d.categories.includes(c))
      : categoriesOf({ category: d.category });
    return {
      name: required(d.name, '기사 이름을 입력해 주세요.'),
      // 담당시공 여러 개 가능. category 는 목록·선택창 표시용 (예: "줄눈·청소")
      categories,
      category: categories.join('·') || '기타',
      phone: required(formatPhone(d.phone), '연락처를 입력해 주세요.'),
      loginId, // '기사모바일' 로그인용
      passwordHash,
      teamId,
      email: d.email || '',
      // 주소: 기사와 시공 현장 사이 거리 확인용 (우편번호 검색으로 입력)
      zipcode: String(d.zipcode || '').trim(),
      address: String(d.address || '').trim(),
      addressDetail: String(d.addressDetail || '').trim(),
      memo: d.memo || '',
      active: d.active !== false,
    };
  },
  // 계약에 배정된 적 있는 기사는 기록 보존을 위해 삭제 대신 비활성화
  beforeRemove: (db, row) => {
    const used = db.contracts.some((c) => c.schedules.some((s) => s.engineerId === row.id));
    if (used) {
      row.active = false;
      return false;
    }
    return true;
  },
});

export const teams = masterTable('teams', {
  normalize: (d) => ({
    name: required(d.name, '팀 이름을 입력해 주세요.'),
    kind: d.kind === '시공팀' ? '시공팀' : '부서', // 시공팀은 계약서 '팀배정'에 사용
    description: d.description || '',
  }),
  beforeRemove: (db, row) => {
    const used = db.contracts.some((c) => c.schedules.some((s) => s.assignType === 'team' && s.teamId === row.id));
    if (used) throw new ApiError('계약에 배정된 적이 있는 시공팀은 삭제할 수 없습니다.');
    db.users.forEach((u) => {
      if (u.teamId === row.id) u.teamId = null;
    });
    db.engineers.forEach((e) => {
      if (e.teamId === row.id) e.teamId = null;
    });
    return true;
  },
});

export const products = masterTable('products', {
  normalize: (d) => ({
    name: required(d.name, '상품명을 입력해 주세요.'),
    kind: d.kind || '패키지',
    category: d.category || '기타',
    detail: d.detail || '',
    freeDetail: d.freeDetail || '', // 무료시공내역
    price: Math.max(0, Number(d.price) || 0),
    visible: d.visible !== false,
  }),
});

const apartmentsBase = masterTable('apartments', {
  normalize: (d, db, user) => {
    const row = { sido: String(d.sido || '').trim(), sigungu: String(d.sigungu || '').trim(), name: required(d.name, '아파트명을 입력해 주세요.') };
    const dup = db.apartments.find(
      (a) => a.companyId === user.companyId && a.id !== d.id && a.name.trim() === row.name && (a.sido || '') === row.sido && (a.sigungu || '') === row.sigungu,
    );
    if (dup) throw new ApiError('같은 지역에 같은 이름의 아파트가 이미 등록되어 있습니다.');
    return row;
  },
});

export const apartments = {
  ...apartmentsBase,
  // 계약에 적힌 현장 이름 중 아파트관리에 없는 것을 한 번에 등록 (지역은 나중에 지정)
  async fromContracts() {
    const { db, user } = await authorize('settings.manage');
    const have = new Set(db.apartments.filter((a) => a.companyId === user.companyId).map((a) => a.name.replace(/\s+/g, '')));
    const names = [...new Set(db.contracts.filter((c) => c.companyId === user.companyId && !c.deletedAt).map((c) => String(c.aptName || '').trim()))]
      .filter((n) => n && !n.startsWith('(') && !have.has(n.replace(/\s+/g, '')))
      .sort((a, b) => a.localeCompare(b, 'ko'));
    names.forEach((name) => {
      db.apartments.push({ id: nextId(db, 'apartments'), companyId: user.companyId, sido: '', sigungu: '', name, createdAt: nowIso() });
    });
    saveDb(db);
    return { created: names.length };
  },
};

// ============================================================
// 계약자(고객)   GET/POST/PATCH/DELETE /api/customers
// ============================================================

export const customers = {
  async list(query = '') {
    const { db, user } = await authorize('customer.view');
    const q = query.trim();
    const qDigits = digitsOnly(q);
    const visibleIds = new Set(visibleContracts(db, user).map((c) => c.customerId));
    return db.customers
      .filter((c) => c.companyId === user.companyId)
      // 본인 건만 보는 실장은 본인 계약에 연결된 계약자만
      .filter((c) => !isOwnScopeOnly(user) || visibleIds.has(c.id) || c.createdBy === user.id)
      .filter(
        (c) =>
          !q ||
          c.name.includes(q) ||
          (qDigits && (digitsOnly(c.phone1).includes(qDigits) || digitsOnly(c.phone2).includes(qDigits))),
      )
      .sort((a, b) => b.id - a.id)
      .map((c) => ({
        ...clone(c),
        contractCount: db.contracts.filter((x) => x.customerId === c.id && !x.deletedAt).length,
      }));
  },

  async findByPhone(phone) {
    const { db, user } = await authorize('customer.view');
    const d = digitsOnly(phone);
    if (d.length < 10) return [];
    return clone(
      db.customers.filter(
        (c) => c.companyId === user.companyId && (digitsOnly(c.phone1) === d || digitsOnly(c.phone2) === d),
      ),
    );
  },

  async save(data) {
    const { db, user } = await authorize('customer.edit');
    if (!data.name?.trim()) throw new ApiError('이름을 입력해 주세요.');
    if (digitsOnly(data.phone1).length < 10) throw new ApiError('연락처①을 올바르게 입력해 주세요.');
    const fields = {
      userType: data.userType || '개인',
      name: data.name.trim(),
      phone1: formatPhone(data.phone1),
      phone2: data.phone2 ? formatPhone(data.phone2) : '',
      email: data.email || '',
      zipcode: data.zipcode || '',
      address1: data.address1 || '',
      address2: data.address2 || '',
    };
    let target;
    if (data.id) {
      target = db.customers.find((c) => c.id === data.id && c.companyId === user.companyId);
      if (!target) throw new ApiError('계약자를 찾을 수 없습니다.', 'NOT_FOUND');
      Object.assign(target, fields);
      // 계약서에 복사된 이름/연락처도 함께 갱신
      db.contracts
        .filter((c) => c.customerId === target.id)
        .forEach((c) => {
          c.customerName = target.name;
          c.customerPhone = target.phone1;
        });
    } else {
      target = { id: nextId(db, 'customers'), companyId: user.companyId, createdBy: user.id, createdAt: nowIso(), ...fields };
      db.customers.push(target);
    }
    saveDb(db);
    return clone(target);
  },

  async remove(id) {
    const { db, user } = await authorize('customer.edit');
    const linked = db.contracts.filter((c) => c.customerId === id && !c.deletedAt).length;
    if (linked) throw new ApiError(`이 계약자로 등록된 계약이 ${linked}건 있어 삭제할 수 없습니다.`);
    db.customers = db.customers.filter((c) => !(c.id === id && c.companyId === user.companyId));
    saveDb(db);
  },
};

