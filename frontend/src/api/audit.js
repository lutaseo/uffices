// ============================================================
// 수정 로그 — 누가 언제 무엇을 바꿨는지 (설정 > 수정로그, 업체 관리자)
//   서버가 저장할 때 바뀐 행(이전/이후)을 넘겨주면 사람이 읽을 수 있는 기록 한 줄로 만듦
//   최근 AUDIT_KEEP_DAYS 일만 보관
// ============================================================

export const AUDIT_KEEP_DAYS = 14;

// 요청 이름 → 작업 이름 (없으면 '저장')
const ACTIONS = {
  'contracts.create': '계약 등록',
  'contracts.update': '계약 수정',
  'contracts.moveToTrash': '휴지통으로 이동',
  'contracts.restore': '휴지통에서 복구',
  'contracts.purge': '계약 완전 삭제',
  'contracts.addPayment': '입금 등록',
  'contracts.updatePayment': '입금 수정',
  'contracts.removePayment': '입금 삭제',
  'contracts.paymentPhotos': '영수증 사진',
  'contracts.setPaperPhotos': '실물 계약서 사진',
  'contracts.setDiscount': '할인 적용',
  'contracts.setApproval': '계약 승인',
  'contracts.requestSign': '서명 요청',
  'contracts.addNote': '상담내역 등록',
  'contracts.updateSchedule': '시공일정·기사 배정',
  'esign.sign': '고객 전자서명',
  'engineerOffs.set': '휴무 등록',
  'engineerOffs.remove': '휴무 삭제',
  'engineerApp.report': '시공 완료 보고',
  'engineerApp.setMyOff': '기사 휴무 등록',
  'engineerApp.cancelMyOff': '기사 휴무 취소',
  'users.create': '사용자 등록',
  'users.update': '사용자 수정',
  'auth.changePassword': '비밀번호 변경',
  'customers.save': '계약자 저장',
  'customers.remove': '계약자 삭제',
  'companies.create': '업체 등록',
  'companies.update': '업체 수정',
  'companies.saveContractTerms': '계약조건 저장',
  'notifications.saveAlimtalkSettings': '알림톡 설정 저장',
  'engineers.save': '기사 저장',
  'engineers.remove': '기사 삭제',
  'teams.save': '팀 저장',
  'teams.remove': '팀 삭제',
  'products.save': '상품 저장',
  'products.remove': '상품 삭제',
  'apartments.save': '아파트 저장',
  'apartments.remove': '아파트 삭제',
  'scheduleSettings.save': '일정관리설정 저장',
  'imports.engineers': '기사 가져오기',
  'imports.contracts': '계약 가져오기',
  'imports.users': '직원 계정 가져오기',
  'notifications.send': '알림톡 발송',
};

// 표별 대상 이름
const TABLES = {
  contracts: (r) => `계약 ${r.customerName || ''}${r.category ? ` (${r.category})` : ''}`,
  customers: (r) => `계약자 ${r.name || r.customerName || ''}`,
  users: (r) => `사용자 ${r.name || ''}${r.loginId ? `(${r.loginId})` : ''}`,
  engineers: (r) => `기사 ${r.name || ''}`,
  engineerOffs: (r, ref) => `휴무 ${ref.engineer(r.engineerId)} ${r.date || ''}`.replace(/\s+/g, ' '),
  teams: (r) => `팀 ${r.name || ''}`,
  products: (r) => `상품 ${r.name || ''}`,
  apartments: (r) => `아파트 ${r.name || ''}`,
  companies: (r) => `업체 설정 ${r.name || ''}`,
  notifications: (r) => `알림톡 ${r.template || ''} → ${r.receiverName || ''}`,
  paymentReceipts: (r) => (r.kind === 'contractPaper' ? '실물 계약서 사진' : '입금 영수증 사진'),
};

// 항목 이름 (없는 항목은 영문 이름 그대로)
const FIELDS = {
  customerName: '고객명',
  customerPhone: '연락처①',
  customerPhone2: '연락처②',
  brand: '브랜드',
  category: '구분',
  workType: '시공종류',
  aptName: '아파트',
  dong: '동',
  ho: '호',
  aptType: '타입',
  address: '주소',
  contractDate: '계약일',
  moveInDate: '입주예정일',
  ownerId: '계약담당',
  status: '시공상태',
  approval: '계약승인',
  schedules: '시공일정·배정',
  payments: '입금',
  discount: '할인',
  discountReason: '할인사유',
  lineItems: '시공 품목',
  items: '시공내용',
  amount: '금액',
  memo: '메모',
  notes: '상담내역',
  customerNote: '고객 참고사항',
  happyCallMemo: '해피콜',
  engineerNote: '기사 메모',
  esign: '전자서명',
  deletedAt: '삭제(휴지통)',
  taxInvoice: '세금계산서',
  cashReceipt: '현금영수증',
  receptionType: '접수형태',
  name: '이름',
  phone: '연락처',
  loginId: '아이디',
  passwordHash: '비밀번호',
  role: '역할',
  permissions: '권한',
  dataScope: '볼 수 있는 범위',
  department: '부서',
  position: '직급',
  teamId: '팀',
  active: '사용 여부',
  categories: '담당시공',
  date: '날짜',
  period: '휴무 시간',
  reason: '사유',
  price: '가격',
  brands: '브랜드 목록',
  contractTerms: '계약조건',
  alimtalk: '알림톡 설정',
  periodStart: '이용 시작일',
  periodEnd: '이용 종료일',
};

// 기록하지 않는 항목 (자동으로 바뀌는 값)
const SKIP = new Set(['updatedAt', 'createdAt', 'lastLoginAt', 'loginFailCount', 'lockedUntil', 'history', 'contractSeq', 'customerToken', 'version', 'customerId']);
// 값은 숨기고 '변경'만 — 비밀번호·서명 등, 그리고 고객 개인정보(연락처·주소)·자유 메모는 기록에 다시 남기지 않음
const HIDE_VALUE = new Set([
  'passwordHash',
  'signature',
  'photos',
  'image',
  'esign',
  'alimtalk',
  'customerPhone',
  'customerPhone2',
  'phone',
  'email',
  'address',
  'addressDetail',
  'zipcode',
  'dong',
  'ho',
  'memo',
  'notes',
  'customerNote',
  'happyCallMemo',
  'engineerNote',
]);

const short = (v) => {
  if (v === undefined || v === null || v === '') return '(없음)';
  if (typeof v === 'boolean') return v ? '예' : '아니오';
  const s = String(v);
  return s.length > 30 ? `${s.slice(0, 30)}…` : s;
};
const isPlain = (v) => v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v);

// 바뀐 항목들: [{ field, label, from?, to? }]
function diffFields(before, after) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  const out = [];
  keys.forEach((k) => {
    if (SKIP.has(k)) return;
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    const label = FIELDS[k] || k;
    if (!HIDE_VALUE.has(k) && isPlain(a) && isPlain(b)) out.push({ label, from: short(a), to: short(b) });
    else out.push({ label });
  });
  return out;
}

// changes: [{ table, before(이전 행 또는 JSON 문자열 | null), after(행 | null) }]
// actor: { id, name, role } — 반환: 기록 한 줄 또는 null(남길 게 없음)
// db: 이름 찾기용 (기사 이름 등, 없어도 됨)
export function buildAuditEntry({ action, actor, changes, db }) {
  const ref = { engineer: (id) => db?.engineers?.find((e) => e.id === id)?.name || '' };
  const items = [];
  for (const ch of changes || []) {
    const describe = TABLES[ch.table];
    if (!describe) continue;
    const before = typeof ch.before === 'string' ? JSON.parse(ch.before) : ch.before;
    const after = ch.after;
    const row = after || before || {};
    if (!before) {
      items.push({ type: '추가', target: describe(row, ref) });
      continue;
    }
    if (!after) {
      items.push({ type: '삭제', target: describe(row, ref) });
      continue;
    }
    const fields = diffFields(before, after);
    if (fields.length) items.push({ type: '수정', target: describe(row, ref), fields: fields.slice(0, 20) });
  }
  if (!items.length) return null;
  return { action: ACTIONS[action] || '저장', call: action, actor, items: items.slice(0, 50) };
}

// 기록 한 줄 → 화면용 글 (검색에도 사용)
export function auditText(entry) {
  return (entry.items || [])
    .map((it) => {
      const f = (it.fields || []).map((x) => (x.from !== undefined ? `${x.label}: ${x.from} → ${x.to}` : `${x.label} 변경`)).join(', ');
      return `[${it.type}] ${it.target}${f ? ` — ${f}` : ''}`;
    })
    .join('\n');
}
