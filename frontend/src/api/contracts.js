// ============================================================
// 계약 / 전자서명 / 알림톡 / 통계
//   GET/POST/PATCH/DELETE /api/contracts ...
// ============================================================

import { loadDb, saveDb, nextId, publicBaseUrl, clientInfo } from './runtime.js';
import { ApiError, authorize, clone, findContract, isLoginIdTaken, nowIso, visibleContracts } from './core.js';
import { addHistory, assigneeOf, contractListView, contractView, hideAmounts } from './views.js';
import { assertAssignable } from './schedule.js';
import { invalidateNumbers, numberOf } from './numbering.js';
import { can } from '../auth/permissions.js';
import {
  APPROVAL_STATUS,
  ASSIGN_TYPES,
  CATEGORIES,
  ESIGN_STATUS,
  MAX_SCHEDULE_STEPS,
  ISSUE_STATUS,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  RECEIPT_TYPES,
  RECEPTION_TYPES,
  WORK_STATUS,
  WORK_TYPES,
  contractTermsFor,
  SIGN_TOGETHER,
} from '../constants.js';
import { inRange, isDateKey, isoToDateKey, today } from '../utils/date.js';
import { digitsOnly, formatAddress, formatPhone, won } from '../utils/format.js';
import { calcAmounts, firstScheduleDate } from '../utils/contract.js';
import { categoriesFromName } from '../utils/legacyImport.js';

// ------------------------------------------------------------
// 검색
// ------------------------------------------------------------

const contractDateOf = (c, dateType) => {
  switch (dateType) {
    case 'contractDate':
      return [c.contractDate];
    case 'scheduleDate':
      return (c.schedules || []).map((s) => s.date);
    case 'completedDate':
      return [c.completedDate];
    case 'canceledDate':
      return [c.canceledDate];
    case 'moveInDate':
      return [c.moveInDate];
    case 'createdAt':
      return [isoToDateKey(c.createdAt)];
    default:
      return [];
  }
};

export function matchesFilter(c, f) {
  if (f.startDate || f.endDate) {
    const dates = contractDateOf(c, f.dateType || 'contractDate');
    if (!dates.some((d) => inRange(d, f.startDate, f.endDate))) return false;
  }
  if (f.aptName && !c.aptName.includes(f.aptName.trim())) return false;
  if (f.dong && c.dong !== f.dong.trim()) return false;
  if (f.ho && c.ho !== f.ho.trim()) return false;
  if (f.customerName && !c.customerName.includes(f.customerName.trim())) return false;
  if (f.phone) {
    const d = digitsOnly(f.phone);
    if (!digitsOnly(c.customerPhone).includes(d) && !digitsOnly(c.customerPhone2).includes(d)) return false;
  }
  if (f.brand && c.brand !== f.brand) return false;
  if (f.category && c.category !== f.category) return false;
  if (f.workType && c.workType !== f.workType) return false;
  if (f.receptionType && c.receptionType !== f.receptionType) return false;
  if (f.status && c.status !== f.status) return false;
  if (f.approval && c.approval !== f.approval) return false;
  if (f.esignStatus && c.esign?.status !== f.esignStatus) return false;
  if (f.ownerId && c.ownerId !== Number(f.ownerId)) return false;
  if (f.engineerId && !(c.schedules || []).some((s) => s.engineerId === Number(f.engineerId))) return false;
  return true;
}

// 정렬 (번호가 붙은 화면용 데이터 기준). 번호 = 계약일 순서
const byNo = (a, b) => (a.no ?? 0) - (b.no ?? 0) || a.id - b.id;
const SORTERS = {
  no_desc: (a, b) => byNo(b, a),
  no_asc: byNo,
  contractDate_desc: (a, b) => byNo(b, a), // 이전 버전 저장값 호환
  contractDate_asc: byNo,
  scheduleDate_asc: (a, b) =>
    (firstScheduleDate(a) || '9999').localeCompare(firstScheduleDate(b) || '9999') || byNo(b, a),
};

// 짧은 문자열 지문 (변경 확인용, 보안용 아님)
function shortHash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ------------------------------------------------------------
// 입력 정규화 + 검증 (서버 검증에 해당)
// ------------------------------------------------------------

const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

function normalizeSchedules(db, user, input = [], prev = []) {
  const companyId = user.companyId;
  const engineerIds = new Set(db.engineers.filter((e) => e.companyId === companyId).map((e) => e.id));
  const teamIds = new Set(db.teams.filter((t) => t.companyId === companyId && t.kind === '시공팀').map((t) => t.id));
  const out = input.slice(0, MAX_SCHEDULE_STEPS).map((s, i) => {
    const assignType = s.assignType === ASSIGN_TYPES.TEAM ? ASSIGN_TYPES.TEAM : ASSIGN_TYPES.ENGINEER;
    const old = prev[i] || {};
    return {
      date: isDateKey(s.date) ? s.date : '',
      time: /^\d{2}:\d{2}$/.test(s.time || '') ? s.time : '',
      ampm: s.time ? '' : oneOf(s.ampm, ['AM', 'PM'], ''),
      assignType,
      engineerId: assignType === ASSIGN_TYPES.ENGINEER && engineerIds.has(Number(s.engineerId)) ? Number(s.engineerId) : null,
      teamId: assignType === ASSIGN_TYPES.TEAM && teamIds.has(Number(s.teamId)) ? Number(s.teamId) : null,
      memo: s.memo || '',
      // 모바일웹 보고값은 기사만 변경 (화면 입력값 무시)
      mobileStatus: old.mobileStatus || '',
      mobileMemo: old.mobileMemo || '',
      reportedAt: old.reportedAt || null,
      reportedBy: old.reportedBy || '',
    };
  });
  if (!out.length) out.push(normalizeSchedules(db, user, [{}])[0]);
  return out;
}

const scheduleKey = (s) => [s?.date, s?.time, s?.ampm, s?.assignType, s?.engineerId, s?.teamId].join('|');

function assertSchedulesAssignable(db, user, schedules, prev = [], contractId) {
  schedules.forEach((s, i) => {
    if (scheduleKey(s) === scheduleKey(prev[i])) return; // 바뀐 회차만 검사
    assertAssignable(db, user.companyId, s, { contractId, stepIndex: i });
  });
}

function normalizeContractInput(db, user, data, existing) {
  const company = db.companies.find((c) => c.id === user.companyId);
  const brands = company.brands?.length ? company.brands : [company.name];

  // 계약자명은 등록 후 수정 불가
  const customerName = existing ? existing.customerName : String(data.customerName || '').trim();
  if (!customerName) throw new ApiError('고객명을 입력해 주세요.');
  if (digitsOnly(data.customerPhone).length < 10) throw new ApiError('고객 연락처①을 올바르게 입력해 주세요.');
  if (data.customerPhone2 && digitsOnly(data.customerPhone2).length < 10) throw new ApiError('고객 연락처②를 올바르게 입력해 주세요.');
  if (!String(data.aptName || '').trim()) throw new ApiError('현장(아파트명)을 입력해 주세요.');
  if (!isDateKey(data.contractDate)) throw new ApiError('계약일을 선택해 주세요.');
  if (!brands.includes(data.brand)) throw new ApiError('브랜드를 선택해 주세요.');

  // 계약담당: 관리자는 직원 중 선택, 실장은 본인(수정 시 기존 담당 유지)
  let ownerId = existing ? existing.ownerId : user.id;
  if (user.role === 'ADMIN' && data.ownerId) {
    const staff = db.users.find((u) => u.id === Number(data.ownerId) && u.companyId === user.companyId);
    if (!staff) throw new ApiError('계약담당자를 선택해 주세요.');
    ownerId = staff.id;
  }

  const approval = can(user, 'contract.approve')
    ? oneOf(data.approval, APPROVAL_STATUS, '승인')
    : existing?.approval || '승인대기';

  const status = oneOf(data.status, WORK_STATUS, '미정');
  const out = {
    brand: data.brand,
    category: oneOf(data.category, CATEGORIES, CATEGORIES[0]),
    workType: oneOf(data.workType, WORK_TYPES, WORK_TYPES[0]),
    receptionType: oneOf(data.receptionType, RECEPTION_TYPES, RECEPTION_TYPES[0]),
    customerName,
    customerPhone: formatPhone(data.customerPhone),
    customerPhone2: data.customerPhone2 ? formatPhone(data.customerPhone2) : '',
    ownerId,
    aptName: data.aptName.trim(),
    dong: String(data.dong || '').trim(),
    ho: String(data.ho || '').trim(),
    aptType: String(data.aptType || '').trim(),
    area: String(data.area || '').trim(),
    contractDate: data.contractDate,
    moveInDate: isDateKey(data.moveInDate) ? data.moveInDate : '',
    approval,
    schedules: normalizeSchedules(db, user, data.schedules, existing?.schedules),
    status,
    completedDate: status === '시공완료' ? (isDateKey(data.completedDate) ? data.completedDate : today()) : '',
    canceledDate: status === '취소' ? (isDateKey(data.canceledDate) ? data.canceledDate : today()) : '',
    cancelReason: status === '취소' ? String(data.cancelReason || '').trim() : '',
    items: data.items || '',
    engineerNote: data.engineerNote || '', // 기사전달사항 (기사모바일에 표시)
    taxInvoice: oneOf(data.taxInvoice, ISSUE_STATUS, ''),
    cashReceipt: oneOf(data.cashReceipt, ISSUE_STATUS, ''),
    happyCallMemo: data.happyCallMemo || '',
    memo: data.memo || '',
    customerNote: String(data.customerNote || '').slice(0, 1000), // 고객 참고사항 (계약서·서명 화면에 고객에게 표시)
  };
  if (status === '취소' && !out.cancelReason) throw new ApiError('취소 사유를 입력해 주세요.');

  if (can(user, 'contract.amount')) {
    out.lineItems = (data.lineItems || [])
      .filter((l) => String(l.name || '').trim())
      .map((l) => ({
        productId: l.productId ? Number(l.productId) : null,
        name: String(l.name).trim(),
        detail: l.detail || '',
        qty: Math.max(1, Math.floor(Number(l.qty) || 1)),
        unitPrice: Math.max(0, Number(l.unitPrice) || 0),
      }));
    // 상품내역이 있으면 시공총액은 상품 합계로 자동 계산
    out.totalAmount = out.lineItems.length
      ? out.lineItems.reduce((s, l) => s + l.qty * l.unitPrice, 0)
      : Math.max(0, Number(data.totalAmount) || 0);
    out.discount = Math.max(0, Number(data.discount) || 0);
    out.voucher = Math.max(0, Number(data.voucher) || 0);
    out.discountReason = String(data.discountReason || '').trim().slice(0, 100);
    if (out.discount + out.voucher > out.totalAmount) throw new ApiError('할인/상품권 금액이 시공총액보다 큽니다.');
    const input = (data.payments || []).filter((p) => Number(p.amount));
    let nextPid = Math.max(0, ...input.map((p) => Number(p.id) || 0));
    const seen = new Set();
    out.payments = input.map((p) => {
      let id = Number(p.id) || 0;
      if (!id || seen.has(id)) id = ++nextPid;
      seen.add(id);
      return normalizePayment(p, id);
    });
  }
  return out;
}

// 입금 1건 정규화. 카드번호는 뒤 4자리만 저장 (전체 카드번호 저장 금지)
function normalizePayment(p, id) {
  const amount = Math.round(Number(p.amount) || 0);
  if (amount <= 0) throw new ApiError('입금액을 입력해 주세요.');
  return {
    id,
    date: isDateKey(p.date) ? p.date : today(),
    kind: oneOf(p.kind, PAYMENT_KINDS, PAYMENT_KINDS[0]),
    method: oneOf(p.method, PAYMENT_METHODS, PAYMENT_METHODS[0]),
    amount,
    payerName: String(p.payerName || '').trim().slice(0, 30),
    approvalNo: String(p.approvalNo || '').trim().slice(0, 30),
    bankOrCard: String(p.bankOrCard || '').trim().slice(0, 30),
    cardLast4: String(p.cardLast4 || '').replace(/\D/g, '').slice(-4),
    receipt: oneOf(p.receipt, RECEIPT_TYPES, RECEIPT_TYPES[0]),
    memo: String(p.memo || '').slice(0, 200),
    hasReceipt: !!p.hasReceipt, // 영수증 사진 첨부 여부 (사진은 paymentReceipts 에 따로 저장)
    receiptCount: Math.max(0, Math.floor(Number(p.receiptCount) || 0)) || (p.hasReceipt ? 1 : 0), // 첨부 사진 수
    createdAt: p.createdAt || nowIso(),
  };
}


// ------------------------------------------------------------
// 입금 영수증 사진 (카드 영수증 등) — 계약 데이터와 따로 저장
// ------------------------------------------------------------
const RECEIPT_MAX = 3 * 1024 * 1024; // 사진 1장 최대 약 3MB (화면에서 줄여서 올림)

function checkReceiptImage(img) {
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(img))) throw new ApiError('영수증은 사진 파일(jpg, png)만 첨부할 수 있습니다.');
  if (img.length > RECEIPT_MAX) throw new ApiError('영수증 사진이 너무 큽니다. 다시 찍거나 작은 사진으로 올려 주세요.');
}

const RECEIPTS_PER_PAYMENT = 5; // 입금 1건당 사진 최대 장수

const receiptsOf = (db, c, payment) => (db.paymentReceipts || []).filter((r) => r.contractId === c.id && r.paymentId === payment.id);

// 입금의 사진 바꾸기
//   add: 새로 붙일 사진들(data URL), remove: 지울 사진 번호들
//   image(예전 방식): 문자열이면 전부 이 사진 1장으로 교체, null 이면 전부 삭제
function changeReceipts(db, user, c, payment, { add = [], remove = [], image } = {}) {
  db.paymentReceipts = db.paymentReceipts || [];
  const mine = (r) => r.contractId === c.id && r.paymentId === payment.id;
  if (image !== undefined) {
    db.paymentReceipts = db.paymentReceipts.filter((r) => !mine(r));
    if (image) add = [image, ...add];
  }
  const removeIds = new Set((remove || []).map(Number));
  if (removeIds.size) db.paymentReceipts = db.paymentReceipts.filter((r) => !(mine(r) && removeIds.has(r.id)));
  const list = (add || []).filter(Boolean);
  if (receiptsOf(db, c, payment).length + list.length > RECEIPTS_PER_PAYMENT) {
    throw new ApiError(`영수증 사진은 입금 1건당 ${RECEIPTS_PER_PAYMENT}장까지 첨부할 수 있습니다.`);
  }
  list.forEach((img) => {
    checkReceiptImage(img);
    db.paymentReceipts.push({ id: nextId(db, 'paymentReceipts'), companyId: user.companyId, contractId: c.id, paymentId: payment.id, image: img, createdAt: nowIso() });
  });
  payment.receiptCount = receiptsOf(db, c, payment).length;
  payment.hasReceipt = payment.receiptCount > 0;
}

// 화면에서 보낸 입금 정보 → 사진 변경 내용
const receiptChangesOf = (payment) => ({
  add: Array.isArray(payment.receiptImages) ? payment.receiptImages : [],
  remove: Array.isArray(payment.removeReceiptIds) ? payment.removeReceiptIds : [],
  image: payment.receiptImage,
});

// 저장된 사진 수로 입금의 사진 표시를 맞춤 (계약 수정 시 화면 값 대신 실제 값 사용)
function syncReceiptCounts(db, c) {
  (c.payments || []).forEach((p) => {
    p.receiptCount = receiptsOf(db, c, p).length;
    p.hasReceipt = p.receiptCount > 0;
  });
}

// 계약의 입금 내역에서 사라진 입금의 사진 정리
function cleanReceipts(db, c) {
  if (!db.paymentReceipts) return;
  const ids = new Set((c.payments || []).map((p) => p.id));
  db.paymentReceipts = db.paymentReceipts.filter((r) => r.contractId !== c.id || ids.has(r.paymentId));
}

// 같은 계약 묶음: 같은 계약자 + 같은 현장(아파트/동/호)의 시공들
const groupKey = (c) => [c.customerId, c.aptName, c.dong, c.ho].join('|');

// 고객에게 한 장으로 보내는 계약서 묶음
//   - 같은 고객(이름+전화번호) · 같은 회사(브랜드)의 줄눈·청소(SIGN_TOGETHER) 계약끼리
//   - 나노코팅 등 다른 구분, 다른 브랜드는 따로 한 장
//   - 서명 전: 그중 아직 서명 안 된 계약 전부 / 서명 후: 그때 함께 서명한 계약들 (같은 서명 링크)
const signKey = (c) => [String(c.customerName || '').replace(/\s+/g, ''), digitsOnly(c.customerPhone), c.brand].join('|');

function signBundle(db, user, base) {
  if (base.deletedAt || !SIGN_TOGETHER.includes(base.category)) return [base];
  const key = signKey(base);
  const same = visibleContracts(db, user).filter((c) => !c.deletedAt && SIGN_TOGETHER.includes(c.category) && signKey(c) === key);
  const signed = base.esign?.status === ESIGN_STATUS.SIGNED;
  const list = signed
    ? same.filter((c) => c === base || (base.esign.token && c.esign?.token === base.esign.token))
    : same.filter((c) => c.esign?.status !== ESIGN_STATUS.SIGNED);
  if (!list.includes(base)) list.push(base);
  return list.sort((a, b) => a.id - b.id);
}

// 변경이력용 비교
function diffContract(db, before, after) {
  const changes = [];
  const push = (label, from, to) => {
    const f = String(from ?? '');
    const t = String(to ?? '');
    if (f !== t) changes.push({ label, from: f.slice(0, 80) || '-', to: t.slice(0, 80) || '-' });
  };
  const staffName = (id) => db.users.find((u) => u.id === id)?.name || '';
  push('브랜드', before.brand, after.brand);
  push('구분', before.category, after.category);
  push('시공종류', before.workType, after.workType);
  push('접수형태', before.receptionType, after.receptionType);
  push('계약승인', before.approval, after.approval);
  push('시공상태', before.status, after.status);
  push('취소사유', before.cancelReason, after.cancelReason);
  push('연락처①', before.customerPhone, after.customerPhone);
  push('연락처②', before.customerPhone2, after.customerPhone2);
  push('계약담당', staffName(before.ownerId), staffName(after.ownerId));
  push('현장', formatAddress(before), formatAddress(after));
  push('평수', before.area, after.area);
  push('계약일', before.contractDate, after.contractDate);
  push('입주예정일', before.moveInDate, after.moveInDate);
  const sched = (s) => {
    if (!s || (!s.date && !s.engineerId && !s.teamId)) return '';
    const when = s.time || (s.ampm === 'AM' ? '오전' : s.ampm === 'PM' ? '오후' : '');
    return `${s.date || '날짜미정'} ${when} ${assigneeOf(db, s).assigneeName || '미배정'}`.replace(/\s+/g, ' ').trim();
  };
  for (let i = 0; i < MAX_SCHEDULE_STEPS; i++) push(`시공일정${i + 1}`, sched(before.schedules?.[i]), sched(after.schedules?.[i]));
  if ('totalAmount' in after) {
    const a = calcAmounts(before);
    const b = calcAmounts(after);
    push('시공총액', won(a.total), won(b.total));
    push('할인', won(a.discount), won(b.discount));
    push('상품권', won(a.voucher), won(b.voucher));
    push('할인사유', before.discountReason, after.discountReason);
    push('입금합계', won(a.paid), won(b.paid));
    push('환불합계', won(a.refund), won(b.refund));
  }
  if ((before.items || '') !== (after.items || '')) changes.push({ label: '시공내용', from: '(변경)', to: '(변경)' });
  if ((before.happyCallMemo || '') !== (after.happyCallMemo || '')) changes.push({ label: '해피콜 메모', from: '(변경)', to: '(변경)' });
  if ((before.memo || '') !== (after.memo || '')) changes.push({ label: '기타사항', from: '(변경)', to: '(변경)' });
  if ((before.customerNote || '') !== (after.customerNote || '')) changes.push({ label: '고객 참고사항', from: before.customerNote || '-', to: after.customerNote || '-' });
  return changes;
}

// 전화번호로 계약자를 찾고 없으면 자동 등록
function upsertCustomerForContract(db, user, name, phone, phone2) {
  const d = digitsOnly(phone);
  let cust = db.customers.find((c) => c.companyId === user.companyId && digitsOnly(c.phone1) === d);
  if (!cust) {
    cust = {
      id: nextId(db, 'customers'),
      companyId: user.companyId,
      userType: '개인',
      name,
      phone1: phone,
      phone2: phone2 || '',
      email: '',
      zipcode: '',
      address1: '',
      address2: '',
      createdBy: user.id,
      createdAt: nowIso(),
    };
    db.customers.push(cust);
  }
  return cust;
}

// ============================================================
// 계약
// ============================================================

export const contracts = {
  // filters: { trash, dateType, startDate, endDate, aptName, dong, ho, customerName, phone, brand, category,
  //            workType, receptionType, status, approval, esignStatus, ownerId, engineerId, sort }
  async list(filters = {}) {
    const { db, user } = await authorize('contract.view');
    return visibleContracts(db, user)
      .filter((c) => (filters.trash ? !!c.deletedAt : !c.deletedAt))
      .filter((c) => matchesFilter(c, filters))
      .map((c) => contractListView(c, user, db))
      .sort(SORTERS[filters.sort] || SORTERS.no_desc);
  },

  // 목록 + 변경 확인표(version). 화면이 가진 목록과 같으면 목록 없이 "그대로"만 보냄 → 다시 받는 수 MB 절약
  //   version: 볼 수 있는 계약 수·최근 수정시각·번호합 + 기사/직원 이름 + 내 권한 — 하나라도 바뀌면 달라짐
  async listCached(filters = {}, knownVersion = '') {
    const { db, user } = await authorize('contract.view');
    const all = visibleContracts(db, user);
    let maxUpd = '';
    let idSum = 0;
    all.forEach((c) => {
      if ((c.updatedAt || '') > maxUpd) maxUpd = c.updatedAt || '';
      idSum += c.id;
    });
    const names = (list) => list.map((x) => `${x.id}:${x.name}`).join(',');
    const version = [
      all.length,
      maxUpd,
      idSum,
      shortHash(names(db.engineers) + '|' + names(db.teams || []) + '|' + names(db.users)),
      user.id,
      shortHash(JSON.stringify(user.permissions || []) + user.dataScope),
      shortHash(JSON.stringify(filters)),
    ].join('/');
    if (knownVersion && knownVersion === version) return { version, unchanged: true };
    return { version, rows: await contracts.list(filters) };
  },

  async get(id) {
    const { db, user } = await authorize('contract.view');
    const c = findContract(db, user, id);
    const view = contractView(c, user, db);
    if (c.esign?.signature) view.esign.signature = c.esign.signature;
    return view;
  },

  async create(data) {
    const { db, user } = await authorize('contract.create');
    const fields = normalizeContractInput(db, user, data, null);
    assertSchedulesAssignable(db, user, fields.schedules, [], null);
    const cust = upsertCustomerForContract(db, user, fields.customerName, fields.customerPhone, fields.customerPhone2);
    const contract = {
      totalAmount: 0,
      discount: 0,
      voucher: 0,
      payments: [],
      lineItems: [],
      ...fields,
      id: nextId(db, 'contracts'),
      companyId: user.companyId,
      customerId: cust.id,
      esign: { status: ESIGN_STATUS.NONE, token: null },
      history: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    };
    addHistory(contract, user, '계약 등록');
    db.contracts.push(contract);
    invalidateNumbers(db);
    saveDb(db);
    return contractView(contract, user, db);
  },

  async update(id, data) {
    const { db, user } = await authorize('contract.edit');
    const c = findContract(db, user, id);
    if (c.deletedAt) throw new ApiError('휴지통에 있는 계약은 수정할 수 없습니다.');
    const fields = normalizeContractInput(db, user, data, c);
    assertSchedulesAssignable(db, user, fields.schedules, c.schedules, c.id);
    const before = clone(c);

    // 서명완료된 계약의 핵심 조건(금액/시공내용)이 바뀌면 재서명 필요
    if (c.esign?.status === ESIGN_STATUS.SIGNED) {
      const changed =
        fields.items !== c.items ||
        (fields.customerNote || '') !== (c.customerNote || '') || // 고객 참고사항도 계약서 내용
        ('totalAmount' in fields &&
          (fields.totalAmount !== c.totalAmount ||
            fields.discount !== c.discount ||
            fields.voucher !== c.voucher ||
            JSON.stringify(fields.lineItems) !== JSON.stringify(c.lineItems || [])));
      if (changed) c.esign = { ...c.esign, status: ESIGN_STATUS.NONE, token: null, previousSignedAt: c.esign.signedAt };
    }
    if (fields.customerPhone !== c.customerPhone) {
      c.customerId = upsertCustomerForContract(db, user, c.customerName, fields.customerPhone, fields.customerPhone2).id;
    }
    Object.assign(c, fields, { updatedAt: nowIso() });
    if ('payments' in fields) {
      cleanReceipts(db, c);
      syncReceiptCounts(db, c);
    }
    const changes = diffContract(db, before, c);
    if (changes.length) addHistory(c, user, '계약 수정', changes);
    invalidateNumbers(db);
    saveDb(db);
    return contractView(c, user, db);
  },

  // 일정관리 화면에서 특정 회차의 날짜/시간/담당만 수정
  async updateSchedule(id, stepIndex, patch) {
    const { db, user } = await authorize('schedule.edit');
    const c = findContract(db, user, id);
    if (!c.schedules[stepIndex]) throw new ApiError('일정을 찾을 수 없습니다.', 'NOT_FOUND');
    const before = clone(c);
    const input = c.schedules.map((s, i) => (i === stepIndex ? { ...s, ...patch } : s));
    const next = normalizeSchedules(db, user, input, c.schedules);
    assertSchedulesAssignable(db, user, next, c.schedules, c.id);
    c.schedules = next;
    c.updatedAt = nowIso();
    const changes = diffContract(db, before, c);
    if (changes.length) addHistory(c, user, '일정 변경', changes);
    saveDb(db);
    return contractView(c, user, db);
  },

  // 목록에서 선택 승인/미승인
  async setApproval(ids, approval) {
    const { db, user } = await authorize('contract.approve');
    if (!APPROVAL_STATUS.includes(approval)) throw new ApiError('승인 상태를 선택해 주세요.');
    ids.forEach((id) => {
      const c = findContract(db, user, id);
      if (c.approval === approval) return;
      addHistory(c, user, '계약 승인 변경', [{ label: '계약승인', from: c.approval, to: approval }]);
      c.approval = approval;
      c.updatedAt = nowIso();
    });
    saveDb(db);
  },

  async moveToTrash(ids) {
    const { db, user } = await authorize('contract.delete');
    ids.forEach((id) => {
      const c = findContract(db, user, id);
      c.deletedAt = nowIso();
      addHistory(c, user, '휴지통으로 이동');
    });
    invalidateNumbers(db);
    saveDb(db);
  },

  async restore(ids) {
    const { db, user } = await authorize('contract.delete');
    ids.forEach((id) => {
      const c = findContract(db, user, id);
      c.deletedAt = null;
      addHistory(c, user, '휴지통에서 복구');
    });
    invalidateNumbers(db);
    saveDb(db);
  },

  async purge(ids) {
    const { db, user } = await authorize('contract.delete');
    const set = new Set(ids.map(Number));
    const purgeIds = new Set(visibleContracts(db, user).filter((c) => set.has(c.id) && c.deletedAt).map((c) => c.id));
    db.contracts = db.contracts.filter((c) => !purgeIds.has(c.id));
    invalidateNumbers(db);
    saveDb(db);
  },

  // ---------------- 계약 상세 (같은 계약자·현장 묶음) ----------------
  // GET /api/contracts/:id/group
  async group(id) {
    const { db, user } = await authorize('contract.view');
    const base = findContract(db, user, id);
    const key = groupKey(base);
    const items = visibleContracts(db, user)
      .filter((c) => !c.deletedAt && groupKey(c) === key)
      .map((c) => contractView(c, user, db))
      .sort(SORTERS.no_desc);
    if (base.deletedAt) items.unshift(contractView(base, user, db));
    const customer = db.customers.find((c) => c.id === base.customerId);
    // 같은 계약자의 다른 현장 계약 (계약자 탭)
    const others = visibleContracts(db, user)
      .filter((c) => !c.deletedAt && c.customerId === base.customerId && groupKey(c) !== key)
      .map((c) => contractView(c, user, db))
      .sort(SORTERS.no_desc);
    const notes = items
      .flatMap((c) => (c.notes || []).map((n) => ({ ...n, contractId: c.id, category: c.category })))
      .sort((a, b) => b.at.localeCompare(a.at));
    return { selectedId: base.id, contracts: items, customer: customer ? clone(customer) : null, otherContracts: others, notes };
  },

  // ---------------- 입금 (계약 상세의 입금등록) ----------------
  // 계약 상세에서 할인·상품권만 바로 적용 (예: 잔금 받을 때 할인) — 변경이력 기록
  async setDiscount(id, { discount, voucher, discountReason } = {}) {
    const { db, user } = await authorize('contract.edit');
    if (!can(user, 'contract.amount')) throw new ApiError('금액·입금 정보 권한이 없습니다.', 'FORBIDDEN');
    const c = findContract(db, user, id);
    if (c.deletedAt) throw new ApiError('휴지통에 있는 계약입니다.');
    const d = Math.round(Number(discount) || 0);
    const v = Math.round(Number(voucher) || 0);
    if (d < 0 || v < 0) throw new ApiError('할인 금액을 올바르게 입력해 주세요.');
    if (d + v > (Number(c.totalAmount) || 0)) throw new ApiError('할인/상품권 금액이 시공총액보다 큽니다.');
    const before = clone(c);
    c.discount = d;
    c.voucher = v;
    c.discountReason = String(discountReason || '').trim().slice(0, 100);
    // 서명완료된 계약의 금액이 바뀌면 재서명 필요
    if (c.esign?.status === ESIGN_STATUS.SIGNED && (before.discount !== d || before.voucher !== v)) {
      c.esign = { ...c.esign, status: ESIGN_STATUS.NONE, token: null, previousSignedAt: c.esign.signedAt };
    }
    const changes = diffContract(db, before, c);
    if (changes.length) addHistory(c, user, '할인 적용', changes);
    c.updatedAt = nowIso();
    saveDb(db);
    return contractView(c, user, db);
  },

  // 영수증 사진 보기
  async receipt(id, paymentId) {
    const { db, user } = await authorize('contract.view');
    if (!can(user, 'contract.amount')) throw new ApiError('금액·입금 정보 권한이 없습니다.', 'FORBIDDEN');
    const c = findContract(db, user, id);
    const list = (db.paymentReceipts || []).filter((x) => x.contractId === c.id && x.paymentId === Number(paymentId)).sort((a, b) => a.id - b.id);
    if (!list.length) throw new ApiError('첨부된 영수증 사진이 없습니다.', 'NOT_FOUND');
    const images = list.map((r) => ({ id: r.id, image: r.image, createdAt: r.createdAt }));
    return { images, image: images[0].image, createdAt: images[0].createdAt }; // image: 예전 화면 호환
  },

  async addPayment(id, payment) {
    const { db, user } = await authorize('contract.edit');
    if (!can(user, 'contract.amount')) throw new ApiError('금액·입금 정보 권한이 없습니다.', 'FORBIDDEN');
    const c = findContract(db, user, id);
    if (c.deletedAt) throw new ApiError('휴지통에 있는 계약입니다.');
    c.payments = c.payments || [];
    const p = normalizePayment({ ...payment, hasReceipt: false, receiptCount: 0 }, Math.max(0, ...c.payments.map((x) => x.id)) + 1);
    c.payments.push(p);
    changeReceipts(db, user, c, p, { ...receiptChangesOf(payment), image: payment.receiptImage || undefined });
    addHistory(c, user, `${p.kind === '환불' ? '환불' : '입금'} 등록`, [{ label: p.kind, from: '-', to: `${won(p.amount)}원 (${p.method})` }]);
    c.updatedAt = nowIso();
    saveDb(db);
    return contractView(c, user, db);
  },

  async updatePayment(id, paymentId, payment) {
    const { db, user } = await authorize('contract.edit');
    if (!can(user, 'contract.amount')) throw new ApiError('금액·입금 정보 권한이 없습니다.', 'FORBIDDEN');
    const c = findContract(db, user, id);
    const idx = (c.payments || []).findIndex((x) => x.id === Number(paymentId));
    if (idx < 0) throw new ApiError('입금 내역을 찾을 수 없습니다.', 'NOT_FOUND');
    const before = c.payments[idx];
    const p = normalizePayment({ ...payment, createdAt: before.createdAt, hasReceipt: before.hasReceipt, receiptCount: before.receiptCount }, before.id);
    c.payments[idx] = p;
    changeReceipts(db, user, c, p, receiptChangesOf(payment));
    addHistory(c, user, '입금 수정', [{ label: `${before.kind} ${before.date}`, from: `${won(before.amount)}원`, to: `${won(p.amount)}원` }]);
    c.updatedAt = nowIso();
    saveDb(db);
    return contractView(c, user, db);
  },

  // 입금의 영수증 사진만 추가/삭제 (계약 수정 화면의 입금 줄 [+ 사진])
  async paymentPhotos(id, paymentId, { add = [], remove = [] } = {}) {
    const { db, user } = await authorize('contract.edit');
    if (!can(user, 'contract.amount')) throw new ApiError('금액·입금 정보 권한이 없습니다.', 'FORBIDDEN');
    const c = findContract(db, user, id);
    const p = (c.payments || []).find((x) => x.id === Number(paymentId));
    if (!p) throw new ApiError('입금 내역을 찾을 수 없습니다.', 'NOT_FOUND');
    const before = p.receiptCount || 0;
    changeReceipts(db, user, c, p, { add: Array.isArray(add) ? add : [], remove: Array.isArray(remove) ? remove : [] });
    if (p.receiptCount !== before) addHistory(c, user, '영수증 사진 변경', [{ label: `${p.kind} ${p.date}`, from: `${before}장`, to: `${p.receiptCount}장` }]);
    c.updatedAt = nowIso();
    saveDb(db);
    return contractView(c, user, db);
  },

  async removePayment(id, paymentId) {
    const { db, user } = await authorize('contract.edit');
    if (!can(user, 'contract.amount')) throw new ApiError('금액·입금 정보 권한이 없습니다.', 'FORBIDDEN');
    const c = findContract(db, user, id);
    const p = (c.payments || []).find((x) => x.id === Number(paymentId));
    if (!p) throw new ApiError('입금 내역을 찾을 수 없습니다.', 'NOT_FOUND');
    c.payments = c.payments.filter((x) => x !== p);
    cleanReceipts(db, c);
    addHistory(c, user, '입금 삭제', [{ label: `${p.kind} ${p.date}`, from: `${won(p.amount)}원`, to: '삭제' }]);
    c.updatedAt = nowIso();
    saveDb(db);
    return contractView(c, user, db);
  },

  // ---------------- 상담내역 ----------------
  async addNote(id, text) {
    const { db, user } = await authorize('contract.view');
    const body = String(text || '').trim();
    if (!body) throw new ApiError('상담 내용을 입력해 주세요.');
    const c = findContract(db, user, id);
    c.notes = c.notes || [];
    c.notes.push({ id: Math.max(0, ...c.notes.map((n) => n.id)) + 1, at: nowIso(), byId: user.id, byName: user.name, text: body.slice(0, 2000) });
    c.updatedAt = nowIso();
    saveDb(db);
  },

  // 계약서 보기: 고객에게 한 장으로 가는 계약 묶음 (첫 번째 = 요청한 계약 기준 서명 이미지 포함)
  async signBundle(id) {
    const { db, user } = await authorize('contract.view');
    const base = findContract(db, user, id);
    const list = signBundle(db, user, base);
    const signature = base.esign?.signature;
    const views = list.map((c) => {
      const v = contractView(c, user, db);
      if (signature && c.esign?.status === ESIGN_STATUS.SIGNED && (c === base || c.esign.token === base.esign.token)) v.esign.signature = signature;
      return v;
    });
    // 묶음 전체가 같은 링크일 때만 기존 링크 사용 (따로 보낸 예전 링크가 섞여 있으면 다시 요청 → 한 장으로 합침)
    const t = base.esign?.token;
    const token = t && base.esign.status !== ESIGN_STATUS.NONE && list.every((c) => c.esign?.token === t) ? t : null;
    return { contracts: views, token, url: token ? signUrlOf(token) : '' };
  },

  // POST /api/contracts/:id/esign  → 고객에게 서명 링크 발송
  //   같은 계약자·현장의 서명 안 된 계약(줄눈·청소 등)을 한 링크로 묶어 한 번에 서명
  async requestSign(id) {
    const { db, user } = await authorize('esign.send');
    const c = findContract(db, user, id);
    if (c.deletedAt) throw new ApiError('휴지통에 있는 계약입니다.');
    if (c.esign?.status === ESIGN_STATUS.SIGNED) throw new ApiError('이미 서명이 완료된 계약입니다.');
    const list = signBundle(db, user, c);
    const token = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const together = list.length > 1 ? list.map((x) => x.category).join('·') : '';
    for (const x of list) {
      x.esign = { ...x.esign, status: ESIGN_STATUS.WAITING, token, requestedAt: nowIso(), requestedBy: user.id };
      x.updatedAt = nowIso();
      addHistory(x, user, together ? `전자서명 요청 (${together} 한 장으로)` : '전자서명 요청');
    }
    saveDb(db);
    return { token, url: signUrlOf(token), count: list.length };
  },
};

const signUrlOf = (token) => `${publicBaseUrl().replace(/\/+$/, '')}/sign/${token}`;

// ============================================================
// 전자서명 / 고객 모바일웹 (로그인 불필요)   GET/POST /api/esign/:token
// ============================================================

export const esign = {
  // 한 링크에 묶인 계약들(줄눈·청소 등)을 한 장의 계약서로
  async getByToken(token) {
    const db = await loadDb();
    const list = bundleByToken(db, token);
    const company = db.companies.find((x) => x.id === list[0].companyId);
    const signature = list.find((c) => c.esign.signature)?.esign.signature;
    const views = list.map((c) => {
      const view = clone(c);
      view.no = numberOf(db, c);
      if (view.esign.status === ESIGN_STATUS.SIGNED) {
        if (signature) view.esign.signature = signature; // 서명 완료 후에는 고객 본인 서명 표시
      } else delete view.esign.signature;
      delete view.history;
      delete view.memo; // 내부 메모는 고객에게 노출하지 않음
      delete view.happyCallMemo;
      delete view.notes;
      delete view.engineerNote;
      return view;
    });
    return { contract: views[0], contracts: views, company: { name: company.name, ceo: company.ceo, bizNo: company.bizNo, address: company.address } };
  },

  async sign(token, { signerName, signature, agreed }) {
    const db = await loadDb();
    const list = bundleByToken(db, token);
    if (list.some((c) => c.esign.status === ESIGN_STATUS.SIGNED)) throw new ApiError('이미 서명이 완료된 계약입니다.');
    if (!agreed) throw new ApiError('계약 내용에 동의해 주세요.');
    if (!signerName?.trim()) throw new ApiError('서명자 성함을 입력해 주세요.');
    if (!signature) throw new ApiError('서명을 해 주세요.');
    const info = await clientInfo(); // 서명 증빙: 접속 기기(서버에서는 IP 포함)
    const signedAt = nowIso();
    const terms = contractTermsFor(list[0].brand); // 서명 당시 계약 조건 보관 (나중에 조건을 바꿔도 그대로)
    for (const c of list) {
      c.esign = { ...c.esign, status: ESIGN_STATUS.SIGNED, signerName: signerName.trim(), signature, signedAt, terms, ...info };
      c.updatedAt = signedAt;
      addHistory(c, { id: null, name: `고객(${signerName.trim()})`, role: 'CUSTOMER' }, '전자서명 완료');
    }
    saveDb(db);
  },
};

function bundleByToken(db, token) {
  const list = token ? db.contracts.filter((x) => x.esign?.token === token && !x.deletedAt).sort((a, b) => a.id - b.id) : [];
  if (!list.length) throw new ApiError('유효하지 않거나 만료된 서명 링크입니다.', 'NOT_FOUND');
  return list;
}

// ============================================================
// 알림톡   POST /api/notifications   (서버에서 비즈고 API 호출)
// ============================================================

export const notifications = {
  async send({ contractId, template, target, brand, receiverName, receiverPhone, message }) {
    const { db, user } = await authorize('notify.send');
    findContract(db, user, contractId);
    if (digitsOnly(receiverPhone).length < 10) throw new ApiError('수신자 연락처가 없습니다.');
    // TODO: 백엔드 연동 시 서버가 비즈고(Bizgo) 알림톡 API 를 호출하고 결과를 기록
    const log = {
      id: nextId(db, 'notifications'),
      companyId: user.companyId,
      contractId,
      template,
      target,
      brand,
      receiverName,
      receiverPhone,
      message,
      sentBy: user.id,
      sentAt: nowIso(),
      result: 'MOCK',
    };
    db.notifications.push(log);
    saveDb(db);
    return clone(log);
  },

  async history(contractId) {
    const { db, user } = await authorize('notify.send');
    return clone(db.notifications.filter((n) => n.companyId === user.companyId && n.contractId === contractId));
  },
};

// ============================================================
// 통계/진행현황   GET /api/reports/contracts?dateType=&from=&to=
// ============================================================

// 통계 시공기사별에서 여러 기사가 나눠 맡은 계약의 금액을 모으는 줄 이름
export const SHARED_ROW = '여러 기사 공동 시공';

export const reports = {
  async contracts({ dateType = 'contractDate', from, to } = {}) {
    const { db, user } = await authorize('stats.view');
    return visibleContracts(db, user)
      .filter((c) => !c.deletedAt)
      .filter((c) => matchesFilter(c, { dateType, startDate: from, endDate: to }))
      .map((c) => contractListView(c, user, db))
      .map((v) => (can(user, 'sales.total') ? v : hideAmounts(v))); // 매출 합계 권한 없으면 통계에 금액 없음
  },

  // 시공기사별: 시공 회차(①②③) 날짜 기준으로 기사(팀)마다 배정·완료 집계 (취소 계약 제외)
  //   완료 = 기사가 '시공완료' 보고했거나 계약이 시공완료 상태
  //   금액(총금액·할인·계약금·입금·잔액)은 '회사 매출 합계 보기' 권한(관리자)만, 같은 기사의 같은 계약은 한 번만 합산
  //   여러 기사가 나눠 맡은 계약(1차 A, 2차 B)의 금액은 기사 개인에서 빼고 '여러 기사 공동 시공' 줄에 한 번만
  //   → 기사별 금액 + 공동 줄 = 회사 전체 (중복 없음)
  async engineers({ from, to } = {}) {
    const { db, user } = await authorize('stats.view');
    const withAmount = can(user, 'sales.total');
    const zero = () => ({ total: 0, discount: 0, deposit: 0, paid: 0, balance: 0 });
    const add = (t, m) => Object.keys(m).forEach((k) => (t[k] += m[k]));
    const map = {};
    const shared = { name: SHARED_ROW, shared: true, assigned: 0, done: 0, postponed: 0, unable: 0, byCategory: {}, jobs: [], amounts: zero(), doneAmounts: zero() };
    for (const c of visibleContracts(db, user)) {
      if (c.deletedAt || c.status === '취소') continue;
      const a = withAmount ? calcAmounts(c) : null;
      const money = a && { total: a.total, discount: a.discount + a.voucher, deposit: a.byKind['계약금'] || 0, paid: a.paid - a.refund, balance: a.balance };
      const names = [...new Set(c.schedules.map((s) => assigneeOf(db, s).assigneeName).filter(Boolean))];
      const sharedWith = money && names.length > 1 ? names : null; // 회차별 담당이 다른 계약
      const inRangeSteps = c.schedules.filter((s) => s.date && inRange(s.date, from, to) && assigneeOf(db, s).assigneeName);
      if (sharedWith && inRangeSteps.length) {
        const allDone = c.status === '시공완료' || c.schedules.every((s) => !assigneeOf(db, s).assigneeName || s.mobileStatus === '시공완료');
        shared.assigned += 1;
        add(shared.amounts, money);
        if (allDone) {
          shared.done += 1;
          shared.byCategory[c.category] = (shared.byCategory[c.category] || 0) + 1;
          add(shared.doneAmounts, money);
        }
        const step = c.schedules.indexOf(inRangeSteps[0]);
        shared.jobs.push({
          contractId: c.id, no: numberOf(db, c), date: inRangeSteps[0].date, step: step + 1, category: c.category, workType: c.workType,
          customerName: c.customerName, site: formatAddress(c), done: allDone, mobileStatus: '', money, engineers: names,
        });
      }
      c.schedules.forEach((s, i) => {
        if (!s.date || !inRange(s.date, from, to)) return;
        const who = assigneeOf(db, s).assigneeName;
        if (!who) return;
        const done = s.mobileStatus === '시공완료' || c.status === '시공완료';
        const r = (map[who] = map[who] || { name: who, assigned: 0, done: 0, postponed: 0, unable: 0, byCategory: {}, jobs: [], seen: new Set(), ...(withAmount ? { amounts: zero(), doneAmounts: zero() } : {}) });
        r.assigned += 1;
        if (done) {
          r.done += 1;
          r.byCategory[c.category] = (r.byCategory[c.category] || 0) + 1;
        } else if (s.mobileStatus === '시공연기요청') r.postponed += 1;
        else if (s.mobileStatus === '시공불가') r.unable += 1;
        const first = !r.seen.has(c.id); // 같은 계약의 다른 회차면 금액은 이미 셈
        r.seen.add(c.id);
        if (money && first && !sharedWith) {
          add(r.amounts, money);
          if (done) add(r.doneAmounts, money);
        }
        r.jobs.push({
          contractId: c.id, no: numberOf(db, c), date: s.date, step: i + 1, category: c.category, workType: c.workType,
          customerName: c.customerName, site: formatAddress(c), done, mobileStatus: s.mobileStatus || '',
          ...(money ? { money: first && !sharedWith ? money : null, sharedWith } : {}),
        });
      });
    }
    const rows = Object.values(map)
      .map(({ seen, ...r }) => ({ ...r, jobs: r.jobs.sort((x, y) => x.date.localeCompare(y.date)) }))
      .sort((x, y) => y.done - x.done || x.name.localeCompare(y.name));
    if (shared.assigned) rows.push({ ...shared, jobs: shared.jobs.sort((x, y) => x.date.localeCompare(y.date)) }); // 맨 아래
    return rows;
  },
};

// ============================================================
// 기존 프로그램 데이터 가져오기 (관리자 전용)   설정 > 데이터 가져오기
//   - 기사 목록: 이름/아이디/연락처 (비밀번호는 가져오지 않음 → 기사관리에서 설정)
//   - 계약: 예전 번호(legacyNo)로 이미 가져온 건은 건너뜀 → 같은 파일을 다시 올려도 중복 없음
//   화면에서 100건씩 나눠 보냅니다.
// ============================================================

const IMPORT_BATCH_MAX = 200;

function authorizeImport(ctx) {
  if (ctx.user.role !== 'ADMIN') throw new ApiError('데이터 가져오기는 업체 관리자만 할 수 있습니다.', 'FORBIDDEN');
  return ctx;
}

function newEngineer(db, user, { name, loginId = '', phone = '', categories }) {
  const cats = categories && categories.length ? categories : categoriesFromName(name);
  const e = {
    id: nextId(db, 'engineers'),
    companyId: user.companyId,
    name: String(name).trim(),
    categories: cats,
    category: cats.join('·') || '기타',
    phone: phone ? formatPhone(phone) : '',
    loginId,
    passwordHash: null,
    teamId: null,
    email: '',
    zipcode: '',
    address: '',
    addressDetail: '',
    memo: '기존 프로그램에서 가져옴',
    active: true,
    createdAt: nowIso(),
  };
  db.engineers.push(e);
  return e;
}

export const imports = {
  async engineers(list = []) {
    const { db, user } = authorizeImport(await authorize('settings.manage'));
    const result = { created: 0, skipped: 0, errors: [] };
    list.slice(0, IMPORT_BATCH_MAX).forEach((row) => {
      const name = String(row.name || '').trim();
      if (!name) return;
      const mine = db.engineers.filter((e) => e.companyId === user.companyId);
      if (mine.some((e) => e.name === name)) {
        result.skipped += 1;
        return;
      }
      let loginId = String(row.loginId || '').trim();
      if (loginId && (!/^[a-zA-Z0-9_.-]{3,20}$/.test(loginId) || isLoginIdTaken(db, loginId))) {
        result.errors.push({ name, message: `아이디 [${loginId}] 는 형식이 맞지 않거나 이미 사용 중이라 비워 두었습니다.` });
        loginId = '';
      }
      newEngineer(db, user, { name, loginId, phone: digitsOnly(row.phone).length >= 10 ? row.phone : '', categories: row.categories });
      result.created += 1;
    });
    saveDb(db);
    return result;
  },

  async contracts(rows = []) {
    const { db, user } = authorizeImport(await authorize('contract.create'));
    const company = db.companies.find((c) => c.id === user.companyId);
    const result = { created: 0, skipped: 0, errors: [], newEngineers: [], newBrands: [] };
    const done = new Set(db.contracts.filter((c) => c.companyId === user.companyId && c.legacyNo).map((c) => String(c.legacyNo)));
    const engineerFor = (name) => {
      const n = String(name || '').trim();
      if (!n) return null;
      let e = db.engineers.find((x) => x.companyId === user.companyId && x.name === n);
      if (!e) {
        e = newEngineer(db, user, { name: n });
        result.newEngineers.push(n);
      }
      return e.id;
    };

    rows.slice(0, IMPORT_BATCH_MAX).forEach((r) => {
      const key = String(r.legacyNo || '').trim();
      if (key && done.has(key)) {
        result.skipped += 1;
        return;
      }
      try {
        const brands = company.brands?.length ? company.brands : [company.name];
        let brand = String(r.brand || '').trim() || brands[0];
        if (!brands.includes(brand)) {
          company.brands = [...brands, brand];
          result.newBrands.push(brand);
        }
        const schedules = (r.schedules || []).map((s) => ({ ...s, assignType: ASSIGN_TYPES.ENGINEER, engineerId: engineerFor(s.engineerName) }));
        const input = { ...r, brand, schedules, ownerId: null };
        // 예전 데이터에 할인+상품권이 총액보다 큰 경우: 총액을 실계약금 기준으로 맞춤
        if ((Number(input.discount) || 0) + (Number(input.voucher) || 0) > (Number(input.totalAmount) || 0)) {
          input.totalAmount = (Number(input.discount) || 0) + (Number(input.voucher) || 0);
        }
        const fields = normalizeContractInput(db, user, input, null);
        const cust = upsertCustomerForContract(db, user, fields.customerName, fields.customerPhone, fields.customerPhone2);
        const contract = {
          totalAmount: 0,
          discount: 0,
          voucher: 0,
          payments: [],
          lineItems: [],
          ...fields,
          legacyNo: key || null,
          id: nextId(db, 'contracts'),
          companyId: user.companyId,
          customerId: cust.id,
          esign: { status: ESIGN_STATUS.NONE, token: null },
          history: [],
          createdAt: nowIso(),
          updatedAt: nowIso(),
          deletedAt: null,
        };
        addHistory(contract, user, `기존 프로그램에서 가져옴 (예전 번호 ${key || '-'})`);
        db.contracts.push(contract);
        if (key) done.add(key);
        result.created += 1;
      } catch (e) {
        result.errors.push({ legacyNo: key, customerName: r.customerName || '', message: e.message });
      }
    });
    invalidateNumbers(db);
    saveDb(db);
    return result;
  },
};
