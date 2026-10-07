// 계약 데이터를 화면용으로 가공 + 변경이력 기록 (서비스 계층 내부용)

import { can } from '../auth/permissions.js';
import { clone, nowIso } from './core.js';
import { numberOf } from './numbering.js';

export function assigneeOf(db, s) {
  const engineer = s.engineerId ? db.engineers.find((e) => e.id === s.engineerId) : null;
  const team = s.teamId ? db.teams.find((t) => t.id === s.teamId) : null;
  const isTeam = s.assignType === 'team';
  return {
    engineerName: engineer?.name || '',
    engineerPhone: engineer?.phone || '',
    teamName: team?.name || '',
    assigneeName: isTeam ? (team ? `[팀] ${team.name}` : '') : engineer?.name || '',
  };
}

// 금액 권한이 없는 사용자에게는 금액 필드를 내려주지 않음
export function contractView(c, user, db) {
  const out = clone(c);
  out.no = numberOf(db, c); // 계약일 순서 번호 (휴지통은 null)
  out.ownerName = db.users.find((u) => u.id === c.ownerId)?.name || '';
  out.schedules = out.schedules.map((s) => ({ ...s, ...assigneeOf(db, s) }));
  if (out.esign) delete out.esign.signature; // 서명 이미지는 상세조회에서만
  return can(user, 'contract.amount') ? out : hideAmounts(out);
}

// 금액·입금 정보를 지운 계약 (권한 없는 사용자용)
export function hideAmounts(view) {
  const out = { ...view };
  out.totalAmount = null;
  out.discount = null;
  out.voucher = null;
  out.discountReason = null;
  out.payments = [];
  out.lineItems = (out.lineItems || []).map(({ unitPrice, ...rest }) => rest);
  out.amountHidden = true;
  return out;
}

// 목록용 가벼운 계약 (계약 목록·통계): 긴 글·변경이력 등 목록에서 안 쓰는 항목은 빼고 보냄
//   상세·수정·계약서 화면은 contracts.get / group 으로 전체를 따로 받습니다.
//   목록 화면(표·합계·엑셀·알림톡·진행상황·통계)에서 새 항목을 쓰게 되면 여기에도 남겨야 합니다.
export const LIST_DROP = ['history', 'memo', 'happyCallMemo', 'notes', 'engineerNote', 'customerNote', 'legacyNo', 'customerId', 'updatedAt', 'taxInvoice', 'cashReceipt', 'discountReason'];
const SCHEDULE_KEEP = ['date', 'time', 'ampm', 'assignType', 'engineerId', 'teamId', 'assigneeName', 'engineerName', 'engineerPhone', 'teamName', 'mobileStatus'];
const filled = (v) => v !== '' && v !== null && v !== undefined;
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => filled(o[k])).map((k) => [k, o[k]]));

export function contractListView(c, user, db) {
  const light = { ...c };
  LIST_DROP.forEach((k) => delete light[k]);
  const out = contractView(light, user, db);
  delete out.companyId;
  Object.keys(out).forEach((k) => out[k] === '' && delete out[k]); // 빈 글자 칸은 보내지 않음 (null 은 '숨김' 뜻이라 유지)
  out.esign = { status: out.esign?.status };
  out.schedules = (out.schedules || []).map((s) => pick({ ...s, assignType: s.assignType === 'team' ? 'team' : '' }, SCHEDULE_KEEP)); // 기사배정(기본)은 생략
  out.payments = (out.payments || []).map((p) => pick(p, ['amount', 'method', 'kind']));
  out.lineItems = (out.lineItems || []).map((l) => pick(l, ['name', 'qty']));
  return out;
}

// 변경이력: 누가 언제 무엇을 바꿨는지 (실장 권한 위임 구조에서 필수)
export function addHistory(c, user, action, changes = []) {
  c.updatedAt = nowIso(); // 변경이 생기면 항상 수정시각도 갱신 (목록 '변경 없음' 확인에 사용)
  c.history = c.history || [];
  c.history.push({
    at: nowIso(),
    byId: user.id,
    byName: user.name,
    byRole: user.role,
    action,
    changes,
  });
}
