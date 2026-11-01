// ============================================================
// 권한 모델
//
//  SUPER   (플랫폼 운영자 = 우리)   : 업체(회사)와 업체 관리자 계정을 발급/연장/정지
//  ADMIN   (업체 관리자, 예: 더좋은집) : 자기 업체의 모든 기능 + 실장 계정 발급 및 권한 위임
//  MANAGER (실장)                  : 관리자가 체크해 준 권한만 사용
//
//  - 모든 업무 데이터는 companyId 로 분리됩니다 (멀티테넌트).
//  - 실장은 dataScope 로 "업체 전체 계약" / "본인이 작성한 계약만" 볼 수 있게 제한됩니다.
//  - 관리자는 자기가 가진 권한 이상을 실장에게 줄 수 없습니다.
//
//  새 기능을 추가할 때는 PERMISSIONS 에 키 하나만 추가하면
//  권한설정 화면/메뉴 노출/서비스 검사에 모두 반영됩니다.
// ============================================================

export const ROLES = {
  SUPER: 'SUPER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  ENGINEER: 'ENGINEER', // 시공기사 (기사모바일 전용, 업무 메뉴 권한 없음)
};

export const ROLE_LABELS = {
  SUPER: '운영자',
  ADMIN: '관리자',
  MANAGER: '실장',
  ENGINEER: '기사',
};

// label: 권한 설정 창에 보이는 설명 / short: 사용자 목록에 보이는 짧은 이름
export const PERMISSIONS = [
  { key: 'contract.view', group: '계약관리', label: '계약 조회', short: '계약조회' },
  { key: 'contract.create', group: '계약관리', label: '계약 등록', short: '계약등록' },
  { key: 'contract.edit', group: '계약관리', label: '계약 수정', short: '계약수정' },
  { key: 'contract.delete', group: '계약관리', label: '계약 삭제/휴지통', short: '계약삭제' },
  { key: 'contract.amount', group: '계약관리', label: '금액·입금 정보 보기', short: '금액보기' },
  { key: 'sales.total', group: '계약관리', label: '회사 매출 합계 보기 (목록 상단 합계·통계 금액·엑셀 금액)', short: '매출합계' },
  { key: 'contract.approve', group: '계약관리', label: '계약 승인/미승인 처리', short: '계약승인' },
  { key: 'esign.send', group: '전자계약', label: '전자계약 서명요청', short: '서명요청' },
  { key: 'customer.view', group: '계약자관리', label: '계약자 조회', short: '계약자조회' },
  { key: 'customer.edit', group: '계약자관리', label: '계약자 등록/수정/삭제', short: '계약자수정' },
  { key: 'schedule.view', group: '일정관리', label: '일정 조회', short: '일정조회' },
  { key: 'schedule.edit', group: '일정관리', label: '일정/기사배정 수정', short: '일정수정' },
  { key: 'excel.export', group: '기타', label: '엑셀 다운로드', short: '엑셀' },
  { key: 'stats.view', group: '기타', label: '진행상황/통계 조회', short: '통계' },
  { key: 'settings.manage', group: '설정', label: '기사/팀/상품/아파트 관리', short: '기초설정' },
];

export const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// 실장 계정 생성 시 기본으로 체크될 권한
export const DEFAULT_MANAGER_PERMISSIONS = [
  'contract.view',
  'contract.create',
  'contract.edit',
  'customer.view',
  'customer.edit',
  'schedule.view',
];

export const DATA_SCOPES = {
  ALL: 'all',
  OWN: 'own',
};

export function permissionsOf(user) {
  if (!user) return [];
  if (user.role === ROLES.ADMIN) return ALL_PERMISSION_KEYS;
  if (user.role === ROLES.MANAGER) return user.permissions || [];
  return []; // SUPER 는 업무 데이터가 아닌 업체/계정 관리만 수행
}

export function can(user, permission) {
  return permissionsOf(user).includes(permission);
}

export const canManageUsers = (user) => user?.role === ROLES.SUPER || user?.role === ROLES.ADMIN;

// 실장이 본인 작성 건만 볼 수 있는지
export const isOwnScopeOnly = (user) =>
  user?.role === ROLES.MANAGER && user.dataScope === DATA_SCOPES.OWN;
