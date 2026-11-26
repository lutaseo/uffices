// ============================================================
// 오래된 사진 정리 (설정 > 사진 정리, 업체 관리자, 기능 photoCleanup)
//
// 계약서 제18조: 사진은 시공이 끝난 뒤 6개월 동안 서비스에 보관하고, 그 뒤에는
//   이용사(관리자)가 압축 파일로 내려받은 다음 서버에서 지울 수 있다.
//   - 대상: 시공완료·취소된 계약 중 AS 가 모두 끝났고, 마지막 날짜(시공일·계약일·AS 날짜·완료일)가
//           기준(오늘 − 6개월)보다 전이며, 사진(실물 계약서·입금 영수증·AS)이 있는 계약
//   - 화면 순서: [미리보기] → [압축 파일 내려받기](계약별 폴더) → [서버에서 지우기]
//   - 지우면 계약에 '사진 정리' 변경이력과 정리한 날을 남기고, 사진 장수 표시는 0 으로
// ============================================================

import { saveDb, fileStore } from './runtime.js';
import { ApiError, authorize, requireFeature } from './core.js';
import { ROLES } from '../auth/permissions.js';
import { addHistory } from './views.js';
import { numberOf } from './numbering.js';
import { isDateKey, toDateKey, today } from '../utils/date.js';

export const PHOTO_KEEP_MONTHS = 6;
const MAX_PER_CLEAR = 50; // 한 번에 지우는 계약 수 (압축 파일 하나에 담는 수와 같음)
const KIND_LABEL = { contractPaper: '실물계약서', asPhoto: 'AS사진' };
const STORE_PREFIX = 'vbstore:';

const cutoffOf = (months = PHOTO_KEEP_MONTHS) => {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(1, Math.floor(Number(months) || PHOTO_KEEP_MONTHS)));
  return toDateKey(d);
};

// 계약의 마지막 날짜 (시공일·계약일·완료일·AS 접수·완료일·취소일 중 가장 늦은 날)
function lastDateOf(c) {
  const dates = [
    c.contractDate,
    c.completedDate,
    c.canceledDate,
    ...(c.schedules || []).map((s) => s.date),
    ...(c.asLogs || []).flatMap((l) => [l.date, l.doneAt, l.visitDate]),
  ].filter(isDateKey);
  return dates.sort().at(-1) || '';
}

const photoCountOf = (c) =>
  (Number(c.paperPhotoCount) || 0) +
  (c.payments || []).reduce((t, p) => t + (Number(p.receiptCount) || 0), 0) +
  (c.asLogs || []).reduce((t, l) => t + (Number(l.photoCount) || 0), 0);

function isTarget(c, companyId, cutoff) {
  if (c.companyId !== companyId || c.deletedAt) return false;
  if (c.status !== '시공완료' && c.status !== '취소') return false;
  if ((c.asLogs || []).some((l) => !l.doneAt)) return false; // 처리 중인 AS 가 있으면 그대로
  const last = lastDateOf(c);
  return !!last && last < cutoff && photoCountOf(c) > 0;
}

async function admin() {
  const { db, user } = await authorize('contract.edit');
  if (user.role !== ROLES.ADMIN) throw new ApiError('업체 관리자만 쓸 수 있습니다.', 'FORBIDDEN');
  requireFeature(db, user, 'photoCleanup');
  return { db, user };
}

export const photoCleanup = {
  // 정리할 계약 목록 (오래된 것부터)
  async preview({ months = PHOTO_KEEP_MONTHS } = {}) {
    const { db, user } = await admin();
    const cutoff = cutoffOf(months);
    const list = db.contracts
      .filter((c) => isTarget(c, user.companyId, cutoff))
      .map((c) => ({ id: c.id, no: numberOf(db, c), customerName: c.customerName, category: c.category, status: c.status, lastDate: lastDateOf(c), photoCount: photoCountOf(c) }))
      .sort((a, b) => a.lastDate.localeCompare(b.lastDate) || a.id - b.id);
    return { cutoff, months: Number(months) || PHOTO_KEEP_MONTHS, count: list.length, photoCount: list.reduce((t, x) => t + x.photoCount, 0), contracts: list };
  },

  // 한 계약의 사진 전부 (압축 파일에 담을 것) — 이름: 실물계약서_1.jpg, 입금_계약금_2026-05-01_1.jpg, AS사진_1회_1.jpg
  async photos(contractId) {
    const { db, user } = await admin();
    const c = db.contracts.find((x) => x.id === Number(contractId) && x.companyId === user.companyId && !x.deletedAt);
    if (!c) throw new ApiError('계약을 찾을 수 없습니다.', 'NOT_FOUND');
    const seq = {};
    return (db.paymentReceipts || [])
      .filter((r) => r.contractId === c.id)
      .sort((a, b) => a.id - b.id)
      .map((r) => {
        const pay = r.kind ? null : (c.payments || []).find((p) => p.id === r.paymentId);
        const base = r.kind === 'asPhoto' ? `AS사진_${(Number(r.asIndex) || 0) + 1}회` : KIND_LABEL[r.kind] || (pay ? `입금_${pay.kind}_${pay.date}` : '입금영수증');
        seq[base] = (seq[base] || 0) + 1;
        const ext = /^data:image\/png/.test(r.image || '') ? 'png' : 'jpg';
        return { id: r.id, name: `${base}_${seq[base]}.${ext}`, image: r.image };
      });
  },

  // 서버에서 지우기 (압축 파일을 내려받은 뒤) — 지금도 대상인 계약만, 한 번에 MAX_PER_CLEAR 건까지
  async clear(contractIds = [], { months = PHOTO_KEEP_MONTHS } = {}) {
    const { db, user } = await admin();
    const ids = [...new Set((Array.isArray(contractIds) ? contractIds : []).map(Number))];
    if (!ids.length) throw new ApiError('정리할 계약을 골라 주세요.');
    if (ids.length > MAX_PER_CLEAR) throw new ApiError(`한 번에 ${MAX_PER_CLEAR}건까지 정리할 수 있습니다.`);
    const cutoff = cutoffOf(months);
    const targets = db.contracts.filter((c) => ids.includes(c.id) && isTarget(c, user.companyId, cutoff));
    const targetIds = new Set(targets.map((c) => c.id));
    const removed = (db.paymentReceipts || []).filter((r) => targetIds.has(r.contractId));
    db.paymentReceipts = (db.paymentReceipts || []).filter((r) => !targetIds.has(r.contractId));
    targets.forEach((c) => {
      const n = removed.filter((r) => r.contractId === c.id).length;
      c.paperPhotoCount = 0;
      (c.payments || []).forEach((p) => {
        p.receiptCount = 0;
        p.hasReceipt = false;
      });
      (c.asLogs || []).forEach((l) => {
        if (l.photoCount) l.photoCount = 0;
      });
      if (c.asInfo?.photoCount) c.asInfo = { ...c.asInfo, photoCount: 0 };
      c.photosClearedAt = today();
      addHistory(c, user, `사진 정리 (${PHOTO_KEEP_MONTHS}개월 지남)`, [{ label: '사진', from: `${n}장`, to: '0장 (압축 파일로 보관)' }]);
    });
    if (targets.length) saveDb(db);
    // 사진 저장소에 있는 파일도 지움 (실패해도 목록에서는 빠짐 — 남은 파일은 용량만 차지)
    const paths = removed.map((r) => String(r.image || '')).filter((v) => v.startsWith(STORE_PREFIX)).map((v) => v.slice(STORE_PREFIX.length));
    const s = fileStore();
    if (paths.length && s && s.configured()) {
      for (let i = 0; i < paths.length; i += 500) await s.remove(paths.slice(i, i + 500)).catch(() => {});
    }
    return { count: targets.length, photoCount: removed.length, skipped: ids.length - targets.length };
  },
};
