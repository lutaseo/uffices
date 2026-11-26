// 신화탄성 계약서 엑셀(등록용 시트) 한 줄 → 계약 등록 자료
//   제목 줄: 계약일 · 아파트 · 동 · 호 · 타입 · 고객명 · 연락처 · 제품 · 시공장소 · 품질보증 · 구역 · 정가
//            · 곰팡이방지 · AS보장 · 최종금액 · 계약금 · 계약금결제 · 후기페이백 · 할인내용 · 메모
//   금액은 원 단위(900000) 또는 만원 단위(90)도 받음 — 1000 보다 작으면 만원으로 봄
import { PAINT_PLACES, MOLD_ROOMS, PAYMENT_METHODS } from '../constants.js';

const text = (v) => String(v ?? '').trim();
const yes = (v) => /^(o|y|yes|v|✔|☑|예|있음|참여|보장|true|1)$/i.test(text(v));

export function moneyOf(v) {
  const n = Number(text(v).replace(/[^\d.]/g, '')) || 0;
  return Math.round(n > 0 && n < 1000 ? n * 10000 : n);
}

// 2026-11-20 / 2026.11.20 / 11/20 / 엑셀 날짜 숫자 → YYYY-MM-DD
export function dateOf(v, year = new Date().getFullYear()) {
  if (typeof v === 'number' && v > 20000) {
    const d = new Date(Math.round((v - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = text(v);
  let m = s.match(/^(\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (m) return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return '';
}

export function mapPaintRow(r) {
  const get = (...keys) => text(keys.map((k) => r[k]).find((v) => text(v)));
  const method = get('계약금결제', '결제');
  return {
    contractDate: dateOf(r['계약일']),
    aptName: get('아파트', '아파트명', '현장'),
    dong: get('동').replace(/동$/, ''),
    ho: get('호', '호수').replace(/호$/, ''),
    aptType: get('타입'),
    customerName: get('고객명', '고객'),
    customerPhone: get('연락처', '전화번호'),
    product: get('제품', '제품명'),
    places: PAINT_PLACES.filter((p) => get('시공장소').includes(p)),
    warranty: get('품질보증', 'AS기간'),
    zone: get('구역', '비고(구역)'),
    price: moneyOf(get('정가', '기본 시공금액', '금액')),
    molds: MOLD_ROOMS.filter((m) => get('곰팡이방지').includes(m)),
    asCoverage: yes(get('AS보장')),
    finalAmount: moneyOf(get('최종금액')),
    deposit: moneyOf(get('계약금')),
    depositMethod: PAYMENT_METHODS.find((m) => method && (m === method || m.startsWith(method) || (method === '이체' && m === '계좌이체'))) || '',
    reviewPayback: yes(get('후기페이백')),
    discountReason: get('할인내용', '박람회 이벤트혜택'),
    memo: get('메모'),
  };
}
