// ============================================================
// 기존 프로그램 데이터 가져오기 (예전 계약관리 '엑셀다운로드' 파일)
//
//  예전 파일은 확장자만 .xls 이고 실제로는 HTML 표입니다.
//  상품내역·메모 등 일부 칸은 HTML 주석(<!-- -->) 안에 들어 있어 함께 읽습니다.
//  브라우저·서버(시험) 어디서나 동작하도록 문자열 처리만 사용합니다.
// ============================================================

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();

const cellsOf = (html) => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => decode(m[1]));
const num = (s) => Number(String(s || '').replace(/[^\d-]/g, '')) || 0;

// 예전 파일 → [{ cells, hidden }]  (cells: 화면에 보이는 칸, hidden: 주석 안의 칸)
export function parseLegacyHtml(html) {
  const body = String(html).split(/<tbody[^>]*>/i)[1];
  if (!body) return [];
  const rows = [];
  for (const m of body.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)) {
    const raw = m[1];
    const hidden = [...raw.matchAll(/<!--([\s\S]*?)-->/g)].map((c) => c[1]).filter((c) => /<td/i.test(c)).map(cellsOf);
    const cells = cellsOf(raw.replace(/<!--[\s\S]*?-->/g, ''));
    if (cells.length >= 22) rows.push({ cells, hidden });
  }
  return rows;
}

// "디에이치 방배126-302" → 아파트명 / 동 / 호  (예: "더파크비스타데시앙109- 804", "구리역롯데캐슬 시그니처A-1003")
export function splitSite(text) {
  const t = String(text || '').trim();
  const i = t.lastIndexOf('-');
  if (i < 0) return { aptName: t, dong: '', ho: '' };
  const left = t.slice(0, i).trim();
  const ho = t.slice(i + 1).replace(/호$/, '').trim();
  const m = left.match(/^(.*?)\s*(\d+|[A-Za-z])\s*동?$/);
  if (m && m[1].trim()) return { aptName: m[1].trim(), dong: m[2], ho };
  return { aptName: left.replace(/동$/, ''), dong: '', ho };
}

const RECEPTION = { 박람: '박람회', 음성: '음성계약', 사전: '사전계약', 옵션: '옵션', 무상: '무상시공' };

// "① : 2026-10-15(9:00)" → { date, time } / "(오전)"·"(오후)" → ampm (시간 미정 오전·오후)
function parseWhen(text) {
  const t = String(text || '').replace(/^[①②③]\s*:\s*/, '');
  const date = (t.match(/\d{4}-\d{2}-\d{2}/) || [''])[0];
  const tm = (t.match(/\((\d{1,2}):(\d{2})\)/) || []).slice(1);
  if (tm.length) return { date, time: `${tm[0].padStart(2, '0')}:${tm[1]}` };
  const ampm = /\(\s*오전/.test(t) ? 'AM' : /\(\s*오후/.test(t) ? 'PM' : '';
  return { date, time: '', ...(ampm ? { ampm } : {}) };
}
const who = (text) => String(text || '').replace(/^[①②③]\s*:\s*/, '').trim();

// 예전 1줄 → 우리 계약 입력 형태 (+ legacyNo: 예전 번호, 중복 가져오기 방지)
export function mapLegacyRow({ cells, hidden = [] }) {
  const c = (i) => cells[i] || '';
  const h = (i, j) => (hidden[i] && hidden[i][j]) || '';
  const status = c(19) || c(5) || '미정';
  let customerName = c(7).replace(/\((승인|승인대기|미승인)\)\s*$/, '').trim();
  const approval = (c(7).match(/\((승인|승인대기|미승인)\)\s*$/) || [])[1] || '승인';
  const extra = /^추가\)/.test(customerName);
  customerName = customerName.replace(/^추가\)\s*/, '');
  const site = splitSite(c(9));

  const schedules = [0, 1]
    .map((i) => ({ ...parseWhen(c(17 + i)), engineerName: who(c(20 + i)) }))
    .filter((s, i) => i === 0 || s.date || s.time || s.engineerName);
  const lastDate = schedules.map((s) => s.date).filter(Boolean).sort().pop() || '';

  const memo = [
    extra && '[추가 계약]',
    h(1, 0) && `[계약메모] ${h(1, 0)}`,
    h(1, 1) && `[서비스] ${h(1, 1)}`,
    h(2, 0) && `[입금메모] ${h(2, 0)}`,
    c(1) === '미지정' && '[예전 브랜드: 미지정]',
    !site.aptName && `[예전 현장 표기] ${c(9)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const paid = num(c(15));
  return {
    legacyNo: c(0),
    brand: c(1) === '미지정' ? '' : c(1),
    category: c(2),
    receptionType: RECEPTION[c(3)] || '음성계약',
    workType: c(4) || '시공',
    status,
    contractDate: c(6),
    customerName,
    customerPhone: c(8),
    aptName: site.aptName || '(현장 미입력)',
    dong: site.dong,
    ho: site.ho,
    aptType: c(10),
    approval,
    totalAmount: num(c(11)),
    discount: num(c(12)),
    voucher: num(c(13)),
    payments: paid > 0 ? [{ date: c(6), kind: '계약금', method: '계좌이체', amount: paid, memo: '기존 프로그램 입금액' }] : [],
    schedules,
    completedDate: status === '시공완료' ? lastDate || c(6) : '',
    canceledDate: status === '취소' ? c(6) : '',
    cancelReason: status === '취소' ? '기존 프로그램에서 취소' : '',
    items: [h(0, 0), h(0, 1) && `[추가] ${h(0, 1)}`].filter(Boolean).join('\n'),
    engineerNote: c(22),
    memo,
  };
}

// 기사 이름 앞 표시 → 담당시공 (줄)=줄눈, 청)=청소, 코)=나노코팅, 탄)=탄성, 새)=새집증후군 / "탄,줄)" 여러 개)
const PREFIX = { 줄: '줄눈', 청: '청소', 코: '나노코팅', 탄: '탄성', 새: '새집증후군' };
export function categoriesFromName(name) {
  const m = String(name || '').match(/^([가-힣,]+)\)/);
  if (!m) return [];
  return [...new Set(m[1].split(',').map((k) => PREFIX[k.trim()]).filter(Boolean))];
}

// 예전 계약 줄과 우리 계약이 같은 계약인지 찾는 열쇠 [정확히, 느슨하게]
//   예전 '번호'는 목록 줄 번호라 예전 프로그램에서 계약을 지우면 당겨져서 쓰지 않음
const looseText = (v) => String(v || '').replace(/\s+/g, '');
export function legacyKeys(x) {
  const phone = String(x.customerPhone || '').replace(/\D/g, '');
  return [
    [x.contractDate, x.category, phone, looseText(x.customerName), looseText(x.aptName), looseText(x.dong), looseText(x.ho)].join('|'),
    [x.contractDate, x.category, phone].join('|'),
  ];
}
