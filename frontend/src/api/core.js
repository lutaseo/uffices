// ============================================================
// 서비스 계층 공통: 세션, 권한 검사, 공통 유틸
// (백엔드에서는 인증 미들웨어 + 권한 가드에 해당)
// ============================================================

import { getSession, loadDb } from './runtime.js';
import { ROLES, can, isOwnScopeOnly } from '../auth/permissions.js';
import { today } from '../utils/date.js';

export class ApiError extends Error {
  constructor(message, code = 'BAD_REQUEST') {
    super(message);
    this.code = code;
  }
}

export const clone = (v) => JSON.parse(JSON.stringify(v));
export const nowIso = () => new Date().toISOString();

export function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return clone(rest);
}

export function validatePassword(pw) {
  if (!pw || pw.length < 4) throw new ApiError('비밀번호는 4자 이상이어야 합니다.');
}

// 로그인 아이디는 같은 종류 안에서만 유일하면 됨 — 로그인 주소로 나눔
//   kind 'user'  : 직원(관리자·실장) 계정끼리   → /업체주소 에서 로그인
//   kind 'engineer': 기사 계정끼리              → /업체주소/m (기사모바일) 에서 로그인
export function isLoginIdTaken(db, loginId, { kind, exceptUserId, exceptEngineerId } = {}) {
  if (kind === 'engineer') return db.engineers.some((e) => e.loginId === loginId && e.id !== exceptEngineerId);
  return db.users.some((u) => u.loginId === loginId && u.id !== exceptUserId);
}

export function companyAccessError(db, user) {
  if (user.role === ROLES.SUPER) return null;
  const company = db.companies.find((c) => c.id === user.companyId);
  if (!company || !company.active) return '사용이 정지된 업체입니다. 운영자에게 문의해 주세요.';
  const t = today();
  if (company.periodStart && t < company.periodStart) return `이용기간 시작 전입니다. (${company.periodStart} 부터)`;
  if (company.periodEnd && t > company.periodEnd) return `이용기간이 만료되었습니다. (${company.periodEnd} 까지)`;
  return null;
}

// 기사 계정을 직원 계정과 같은 모양의 "세션 사용자"로 변환
export function engineerAsUser(e) {
  return {
    id: e.id,
    engineerId: e.id,
    role: ROLES.ENGINEER,
    companyId: e.companyId,
    name: e.name,
    loginId: e.loginId,
    phone: e.phone,
    category: e.category,
    teamId: e.teamId,
    active: e.active,
    permissions: [],
  };
}

export async function session() {
  const db = await loadDb();
  const raw = await getSession();
  let user = null;
  if (raw?.userId) user = db.users.find((u) => u.id === raw.userId);
  if (raw?.engineerId) {
    const e = db.engineers.find((x) => x.id === raw.engineerId);
    user = e && e.passwordHash ? engineerAsUser(e) : null;
  }
  if (!user || !user.active) throw new ApiError('로그인이 필요합니다.', 'UNAUTHORIZED');
  const err = companyAccessError(db, user);
  if (err) throw new ApiError(err, 'UNAUTHORIZED');
  return { db, user };
}

export async function authorize(permission) {
  const ctx = await session();
  if (permission && !can(ctx.user, permission)) throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
  return ctx;
}

// 여러 권한 중 하나라도 있으면 통과
export async function authorizeAny(permissions) {
  const ctx = await session();
  if (!permissions.some((p) => can(ctx.user, p))) throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
  return ctx;
}

export async function authorizeEngineer() {
  const ctx = await session();
  if (ctx.user.role !== ROLES.ENGINEER) throw new ApiError('기사 계정으로 로그인해 주세요.', 'FORBIDDEN');
  return ctx;
}

// 실장 dataScope 까지 반영한 "내가 볼 수 있는 계약"
export function visibleContracts(db, user) {
  return db.contracts.filter(
    (c) => c.companyId === user.companyId && (!isOwnScopeOnly(user) || c.ownerId === user.id),
  );
}

export function findContract(db, user, id) {
  const c = visibleContracts(db, user).find((x) => x.id === Number(id));
  if (!c) throw new ApiError('계약을 찾을 수 없습니다.', 'NOT_FOUND');
  return c;
}

export function companyOf(db, user) {
  return db.companies.find((c) => c.id === user.companyId);
}
