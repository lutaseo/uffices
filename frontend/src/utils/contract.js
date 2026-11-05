// 계약 금액 계산. 저장하지 않고 항상 원본값에서 계산해 불일치를 막습니다.
//   실계약금   = 시공총액 - 할인 - 상품권
//   매출취소   = 취소된 계약의 실계약금 (취소 건은 받을 돈이 없음)
//   입금       = 입금 내역 합계 (환불 제외)
//   환불       = 입금 내역 중 '환불' 합계
//   남은금액   = (실계약금 - 매출취소) - (입금 - 환불)

export const isRefund = (p) => p.kind === '환불';

export function calcAmounts(c) {
  const total = Number(c.totalAmount) || 0;
  const discount = Number(c.discount) || 0;
  const voucher = Number(c.voucher) || 0;
  const actual = total - discount - voucher;
  const canceled = c.status === '취소' ? actual : 0;
  const payments = c.payments || [];
  let paid = 0;
  let refund = 0;
  const paidBy = {};
  const byKind = {}; // 항목별 입금: 계약금 / 중도금 / 잔금 / 추가금
  payments.forEach((p) => {
    const amount = Number(p.amount) || 0;
    if (isRefund(p)) {
      refund += amount;
      return;
    }
    paid += amount;
    paidBy[p.method] = (paidBy[p.method] || 0) + amount;
    byKind[p.kind || '계약금'] = (byKind[p.kind || '계약금'] || 0) + amount;
  });
  return { total, discount, voucher, actual, canceled, paid, refund, paidBy, byKind, balance: actual - canceled - (paid - refund) };
}

export function summarize(contracts) {
  const sum = {
    count: contracts.length,
    completed: 0,
    canceled: 0,
    total: 0,
    discount: 0,
    voucher: 0,
    actual: 0,
    paid: 0,
    paidBy: {},
    balance: 0,
    canceledAmount: 0,
    refund: 0,
  };
  contracts.forEach((c) => {
    const a = calcAmounts(c);
    if (c.status === '시공완료') sum.completed += 1;
    sum.refund += a.refund;
    if (c.status === '취소') {
      sum.canceled += 1;
      sum.canceledAmount += a.actual;
      return; // 취소 건은 매출 합계에서 제외
    }
    sum.total += a.total;
    sum.discount += a.discount;
    sum.voucher += a.voucher;
    sum.actual += a.actual;
    sum.paid += a.paid;
    sum.balance += a.balance;
    Object.entries(a.paidBy).forEach(([k, v]) => {
      sum.paidBy[k] = (sum.paidBy[k] || 0) + v;
    });
  });
  return sum;
}

// 가장 이른 시공예정일 (정렬용)
export const firstScheduleDate = (c) =>
  (c.schedules || []).map((s) => s.date).filter(Boolean).sort()[0] || '';

// 목록/계약서에 표시할 시공내용 요약 (상품내역 + 자유입력)
export function itemsSummary(c) {
  const lines = (c.lineItems || []).map((l) => `${l.name}${l.qty > 1 ? ` x${l.qty}` : ''}`);
  return [...lines, c.items].filter(Boolean).join(' / ');
}

// 시간 선택 목록: 시간미정 / 오전(시간미정) / 오후(시간미정) / 설정된 간격의 시각
export function timeOptions(settings) {
  const out = [];
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  for (let m = toMin(settings.startTime); m <= toMin(settings.endTime); m += settings.interval) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

// select 값 <-> 일정 필드 변환 ('' | 'AM' | 'PM' | 'ANY'(무관) | 'HH:mm')
export const timeValueOf = (s) => s.time || s.ampm || '';
export const timeFieldsOf = (value) =>
  value === 'AM' || value === 'PM' || value === 'ANY' ? { time: '', ampm: value } : { time: value || '', ampm: '' };

// 시간 표시 ('' 이면 시간 미정) — 무관 = 아무 시간이나 괜찮음
export const AMPM_LABEL = { AM: '오전', PM: '오후', ANY: '무관' };
export function timeLabel(s) {
  if (s.time) return s.time;
  return AMPM_LABEL[s.ampm] || '';
}

// 일정의 시간대 ('AM' | 'PM' | null) — 서버 규칙(api/schedule.js)과 동일
export function slotOf(s, settings) {
  if (s.time) return s.time < settings.amEnd ? 'AM' : 'PM';
  if (s.ampm === 'AM' || s.ampm === 'PM') return s.ampm;
  return null;
}
export const offBlocks = (period, slot) => period === 'DAY' || slot === null || slot === period;

// 팀배정용: 해당 시간대에 팀원 몇 명이 휴무인지 (전원 휴무일 때만 배정 불가 — 서버 규칙과 동일)
export function teamOffStatus(teamId, engineers, offOf, slot) {
  const members = engineers.filter((e) => String(e.teamId) === String(teamId));
  const offCount = members.filter((m) => {
    const off = offOf(m.id);
    return off && offBlocks(off.period, slot);
  }).length;
  return { total: members.length, offCount, allOff: members.length > 0 && offCount === members.length };
}

// 같은 현장에 시공을 추가할 때 계약서 작성 화면에 미리 채울 값
export const groupPrefill = (c) => ({
  brand: c.brand,
  customerName: c.customerName,
  customerPhone: c.customerPhone,
  customerPhone2: c.customerPhone2 || '',
  ownerId: String(c.ownerId || ''),
  aptName: c.aptName,
  dong: c.dong,
  ho: c.ho,
  aptType: c.aptType,
  area: c.area || '',
  contractDate: c.contractDate,
  moveInDate: c.moveInDate || '',
  receptionType: c.receptionType,
  taxInvoice: c.taxInvoice || '',
  cashReceipt: c.cashReceipt || '',
  customerNote: c.customerNote || '', // 같은 현장 추가 시공에도 고객 안내 그대로
});

// 여러 시공의 금액 합계 (계약 상세의 금액 요약)
export function sumAmounts(contracts) {
  const keys = ['total', 'discount', 'voucher', 'actual', 'canceled', 'paid', 'refund', 'balance'];
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  out.byKind = {};
  contracts.forEach((c) => {
    const a = calcAmounts(c);
    keys.forEach((k) => (out[k] += a[k]));
    Object.entries(a.byKind).forEach(([k, v]) => (out.byKind[k] = (out.byKind[k] || 0) + v));
  });
  return out;
}

// "계약금 100,000 · 잔금 50,000" 형태 (금액 있는 항목만)
export function kindBreakdown(byKind, fmt) {
  return ['계약금', '중도금', '잔금', '추가금']
    .filter((k) => byKind[k])
    .map((k) => `${k} ${fmt(byKind[k])}`)
    .join(' · ');
}

// 시공 범위 체크 목록 (기사 모바일 '시공완료' 보고용)
//   상품 줄마다 상세품목을 '+'·줄바꿈으로 나눠 한 칸씩 (예: '욕실2곳 바닥(빅라이언)' / '현관s.v(폴리)')
//   상세품목 앞의 '상품명 :' 머리는 뺌, 상세품목이 없으면 상품명 한 칸, '추가 시공내용' 글도 줄마다 한 칸
const squash = (t) => String(t || '').replace(/\s+/g, '');
export function scopeOf(c) {
  const groups = (c.lineItems || []).map((l) => {
    let detail = String(l.detail || '');
    const head = /^([^:\n]{1,40}):\s*/.exec(detail);
    if (head && (squash(l.name).includes(squash(head[1])) || squash(head[1]).includes(squash(l.name)))) detail = detail.slice(head[0].length);
    const parts = detail
      .split(/\n|\+/)
      .map((x) => x.trim())
      .filter(Boolean);
    return { group: l.name, parts: parts.length ? parts : [l.name] };
  });
  const extra = String(c.items || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
  if (extra.length) groups.push({ group: '추가 시공내용', parts: extra });
  // 같은 글이 두 번 나오면 체크가 헷갈리므로 한 번만
  const seen = new Set();
  return groups
    .map((g) => ({ ...g, parts: g.parts.filter((p) => !seen.has(`${g.group}|${p}`) && seen.add(`${g.group}|${p}`)) }))
    .filter((g) => g.parts.length);
}

// 자재 + 번호(색상) → '크린파파 위너스 101번' (번호가 숫자로 끝나면 '번'을 붙임)
export function materialText(material, color) {
  const c = String(color || '').trim();
  return [String(material || '').trim(), c && (/\d$/.test(c) ? `${c}번` : c)].filter(Boolean).join(' ');
}
