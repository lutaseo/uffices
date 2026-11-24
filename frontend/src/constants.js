// 업무 코드값 모음. 추후 '설정' 메뉴에서 업체별로 관리하도록 확장할 값들입니다.

export const BRANDS = ['더좋은집', '더스타트'];

// 구분 (품목)
export const CATEGORIES = ['줄눈', '청소', '탄성', '새집증후군', '나노코팅', '기타'];

// ---------------- 신화탄성 탄성·페인트 계약서 (기능 paintContract, 업체 전용) ----------------
// 제품별 시공장소 체크, 품질보증, 구역 / 곰팡이방지 살균시공 / AS 보장범위 / 시공후기 페이백
//   '페인트' 구분은 운영자가 업체/계정관리 > 시공 구분에 넣으면 됨
export const PAINT_STYLE_CATEGORIES = ['탄성', '페인트'];
export const PAINT_PLACES = ['베란다', '대피실', '세탁실', '실외기실'];
export const MOLD_PREFIX = '곰팡이방지 살균시공';
export const MOLD_ROOMS = ['드레스룸', '펜트리'];
export const MOLD_PRICE = 150000;
export const moldLineName = (room) => `${MOLD_PREFIX} (${room})`;
export const isMoldLine = (l) => String(l?.name || '').startsWith(MOLD_PREFIX);
export const REVIEW_PAYBACK = 20000; // 시공 후기이벤트 참여 페이백
// 계약서 하단 업체 정보 (운영자가 업체 등록·수정에서 입력): 업태 / 종목 / 고객센터 / 휴대번호 / 빠른문의
export const COMPANY_DOC_FIELDS = ['bizType', 'bizItem', 'csPhone', 'mobile', 'quickPhone'];
// 이 업체·구분이 신화탄성 양식인지 (기능이 켜져 있고 구분이 탄성·페인트)
export const isPaintStyle = (company, category) => PAINT_STYLE_CATEGORIES.includes(category) && hasFeature(company, 'paintContract');

// 매입·재고 구분: 여러 시공에 같이 쓰는 비용(공통) + 업체의 시공 구분
//   박람회: 박람회 참가비·부스비 등 (매입) / 박람회 현장 판매 등 (매출)
export const purchaseCategories = (company) => [...new Set(['공통', '박람회', ...companyCategories(company)])];
export const currentPurchaseCategories = () => [...new Set(['공통', '박람회', ...currentCategories()])];

// 업체의 시공 구분 (운영자가 업체/계정관리에서 순서까지 정함) — 정하지 않았으면 기본 목록
export function companyCategories(company) {
  const list = Array.isArray(company?.categories) ? company.categories.filter((c) => String(c || '').trim()) : [];
  return list.length ? list : CATEGORIES;
}
// 화면에서 지금 로그인한 업체의 구분 (AuthContext 가 업체 정보를 받을 때마다 맞춤)
let currentCompany = null;
export function setCurrentCompany(company) {
  currentCompany = company || null;
}
export const currentCategories = () => companyCategories(currentCompany);
// ---------------- 업체별 기능 스위치 ----------------
// 운영자(super)가 업체/계정관리 > [수정/연장] 에서 업체마다 켜고 끕니다.
// 새 기능을 만들면 여기에 한 줄 추가하고, 화면은 currentHasFeature(key), 서버는 requireFeature(db, user, key) 로 막습니다.
// on: 업체에 따로 정하지 않았을 때의 기본값 (기존 기능은 true, 시험 중인 새 기능은 false 로 두면 켠 업체만 보임)
export const FEATURES = [
  { key: 'fair', label: '박람회 일정', on: true },
  { key: 'as', label: 'AS관리', on: true },
  { key: 'workRecord', label: '기사 시공 기록 (완료 보고 때)', on: true },
  { key: 'alimtalk', label: '카카오 알림톡 보내기', on: true },
  { key: 'manager', label: '상담실장 화면 (/t)', on: true },
  { key: 'customer', label: '고객 확인 페이지 (/c)', on: true },
  { key: 'auditUndo', label: '수정로그 되돌리기 (관리자)', on: true },
  { key: 'fastLoad', label: '빠른 불러오기 (계약 보기·저장 때 필요한 계약만 전체로 읽음)', on: true },
  { key: 'lineAmounts', label: '계약 상세에 패키지·추가시공품목 금액 따로 표시', on: true },
  { key: 'autoRetry', label: '서버가 바쁠 때 화면이 알아서 다시 시도', on: true },
  { key: 'installOthers', label: '내 정보에서 상담실장·기사모바일 앱도 설치 (설치 화면 열기·주소 복사)', on: true },
  { key: 'addressMap', label: '현장 주소 검색(우편번호) · 지도 보기 버튼', on: true },
  { key: 'asEngineer', label: 'AS 담당 기사 지정 · 기사모바일 AS관리(알림 · 방문일 등록)', on: true },
  { key: 'asReport', label: '기사모바일 AS 보고 (상태 · 메모, 시공완료면 AS 완료)', on: true },
  { key: 'companyFiles', label: '회사 자료 백업 (PDF · PPT 등 올려 두고 내려받기)', on: true },
  { key: 'purchases', label: '매입·매출관리 (통계정보 > 매입·매출관리: 박람회비 등 비용·기타 수입, 통계에서 매출·매입·차액)', on: false },
  { key: 'stocks', label: '재고체크 (통계정보 > 재고체크: 자재 입고·사용·실사, 부족 표시)', on: false },
  { key: 'parallelSave', label: '업체별 따로 저장 (다른 업체 저장을 기다리지 않음 — 끄면 예전처럼 모든 업체가 한 줄)', on: true },
  { key: 'paintContract', label: '신화탄성 탄성·페인트 계약서 (시공장소·품질보증·구역, 곰팡이방지·AS보장·후기 페이백, 업체 정보 칸)', on: false },
  { key: 'photoStorage', label: '사진 전용 저장소 (새 사진을 DB 대신 사진 저장소에)', on: true },
  { key: 'callLog', label: '상담내역 메뉴 (전화번호별 통화 메모 · 번호 검색)', on: true },
  { key: 'scheduleLock', label: '시공일자·기사배정은 권한 있는 사람만 (권한 없으면 계약 등록에서 시공 칸 숨김)', on: true },
];
export function hasFeature(company, key) {
  const f = FEATURES.find((x) => x.key === key);
  const v = company?.features?.[key];
  return typeof v === 'boolean' ? v : f ? f.on : true;
}
export const currentHasFeature = (key) => hasFeature(currentCompany, key);
// 운영자 입력 → { key: true/false } (모르는 이름은 버림)
export function parseFeatures(value) {
  const out = {};
  FEATURES.forEach((f) => {
    if (value && typeof value[f.key] === 'boolean') out[f.key] = value[f.key];
  });
  return out;
}

export const currentWorkCategories = () => currentCategories().filter((c) => c !== '기타');
// 통계 등 순서: 업체 구분 순서 → 그 밖의 예전 구분
export const categoryOrder = () => [...new Set([...currentCategories(), ...CATEGORIES])];

// 기사 담당시공 · 상품 구분 등 실제 시공 구분 ('기타' 제외)
export const workCategories = (company) => companyCategories(company).filter((c) => c !== '기타');

// 운영자 입력(쉼표·줄바꿈 구분) → 구분 목록 (앞뒤 공백·중복 제거, 최대 20개, 이름 20자)
export function parseCategories(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,\n]/);
  return [...new Set(raw.map((c) => String(c || '').trim().replace(/[[\]]/g, '').slice(0, 20)).filter(Boolean))].slice(0, 20);
}
export const PRODUCT_KINDS = ['패키지', '추가시공품목', '무료시공']; // 상품 구분

// 고객에게 계약서 한 장으로 묶어 보내는 구분 (같은 계약자·현장일 때). 그 외(나노코팅 등)는 따로
export const SIGN_TOGETHER = ['줄눈', '청소'];

// 시공종류
export const WORK_TYPES = ['시공', 'AS', '하자보수'];

export const RECEPTION_TYPES = ['박람회', '음성계약', '사전계약', '옵션', '무상시공']; // 맨 앞이 새 계약의 기본값

// 시공상태(최종) — 고객 모바일웹에 표시되는 값
export const WORK_STATUS = ['미정', '해피콜완료', '배정', '시공완료', '시공연기', '취소'];

// 기사가 모바일웹에서 보고하는 회차별 상태 ('' = 입력 전)
//   현장도착·시공시작은 진행 중 알림용 (완료 집계에는 들어가지 않음)
export const MOBILE_STATUS = ['현장도착', '시공시작', '시공완료', '시공연기요청', '시공불가'];

// 계약승인

// 시공 담당 지정 방식
export const ASSIGN_TYPES = { ENGINEER: 'engineer', TEAM: 'team' };

// 기사 휴무 구분
export const OFF_PERIODS = [
  { value: 'AM', label: '오전' },
  { value: 'PM', label: '오후' },
  { value: 'DAY', label: '종일' },
];
export const OFF_LABEL = { AM: '오전', PM: '오후', DAY: '종일' };

// 일정관리설정 기본값 (업체별로 설정 > 일정관리설정에서 변경)
export const DEFAULT_SCHEDULE_SETTINGS = {
  amEnd: '12:00', // 이 시각 이전 시작 = 오전, 이후 = 오후
  startTime: '08:00',
  endTime: '20:00',
  interval: 30,
  maxPerDay: 0, // 기사 1인 하루 최대 배정 건수 (0 = 제한 없음)
  // 시공 자재 목록 — 기사가 시공완료 보고 때 골라 쓰고 번호(색상)만 적음 (예: 크린파파 위너스 101번)
  materials: ['크린파파 위너스', '빅라이언', '케라폭시', '폴리'],
};

// 입금 구분
export const PAYMENT_KINDS = ['계약금', '중도금', '잔금', '추가금', '환불'];

// 영수증 발행 구분
export const RECEIPT_TYPES = ['미발행', '현금영수증', '세금계산서', '카드전표'];

// 계약 단위 세금계산서 / 현금영수증 발행 상태
export const ISSUE_STATUS = ['', '발행요청', '발행완료', '해당없음'];

// 계약서 '계약 조건' — 운영자(super) > 계약조건 화면에서 업체·브랜드별로 입력 (company.contractTerms[브랜드])
//   형식: 문자열 묶음 목록. '[구분]' 첫 줄 + 한 줄에 한 항목 → 그 구분 계약서에만 표시,
//         '[구분]'으로 시작하지 않는 묶음(계약 당사자·대금 등 중요 조항)은 모든 계약서 맨 앞에 강조
//   입력하지 않은 브랜드는 아래 기본(예전부터 쓰던 조건) 사용
//   이미 서명한 계약서는 서명할 때의 조건이 계약에 함께 저장되어 바뀌지 않음
export const DEFAULT_CONTRACT_TERMS = [
  '시공 일정은 고객과 협의하여 확정하며, 일정 변경은 시공 3일 전까지 요청해야 합니다.',
  '잔금은 시공 완료 후 당일 결제를 원칙으로 합니다.',
  '시공 후 하자 발생 시 보증기간 내 무상 A/S 를 제공합니다.',
  '고객 사정에 의한 계약 취소 시 계약금은 환불되지 않을 수 있습니다.',
];

// 더좋은집 계약서 안내 — '[구분]' 첫 줄 + '*' 항목들. 계약서에는 그 계약의 구분(줄눈·청소) 부분만 표시
//   '[구분]'으로 시작하지 않는 항목(맨 앞 계약 당사자·대금 조항)은 모든 계약서에 항상 표시
const THEGOOD_TERMS = [
  `본 계약에서 계약 의뢰인을 “갑”, 시공 업체 [더좋은집]을 “을”이라 칭하며, “갑”과 “을”은 아래의 사항에 합의하여 본 계약을 체결합니다.

1. “갑”은 “을”에게 총 시공 금액 중 일부를 계약금으로 납부하며, 이 계약금은 “더좋은집”에 귀속됩니다. 시공 완료 후 지급하는 잔금은 현장 시공을 담당하는 팀장에게 직접 지급하며, 이는 현장 작업비로 사용되어 본사 매출로 처리되지 않습니다. 또한 “갑”은 “을”의 시공이 완료되는 당일 잔금을 납부해야 합니다.`,
  `[줄눈]
*AS규정 : 시공 하자 3년 / 아파트 하자 시공일로부터 3개월 이내 (타일 5장이내, 1회에 한하여 무상지원 / 그 외 유상)
*현관/욕실벽(600*600), 화장실/세탁실/베란다(300*300), 아트월(600*1200), 폴리싱/포세린(600*600mm)기준과 다른 경우 비용 발생`,
  `[청소]
*발코니 / 테라스 / 복층 청소는 별도협의.
*한국인 팀장 및 내.외국인 팀원구성
*청소 후 당일 검수, 당일결제 원칙 (미방문 시 사진 검수 후 AS 1일 이내 가능)
*창문 외부를 바라보고 있는 모든 '면' 과 난간 제외
*인테리어 후 청소비용 별도 협의
*가전제품 내부(에어컨/냉장고/세탁기 등), 기본옵션 외 추가된 가구(옵션/사제 붙박이장 등) 청소 요청 시 별도 협의
*보양지 제거 비용은 별도 협의
*본드, 녹, 페인트, 스티커자국 및 약품성 오염등은 청소만으로는 완벽한 제거가 힘듭니다. 가능한 최대한 제거 작업을 해드리오나, 청소팀이 손을대는 경우 '소비자 과실로 인한 하자처리 불가' 사항으로 청소 시 발견된 부분은 별도 표시 후 안내드립니다. (시공사의 하자 접수로 처리가 가능합니다.)`,
];

// 화면에서 입력하기 전부터 쓰던 조건 (업체주소코드:브랜드) — 운영자가 저장하면 저장한 것이 우선
// 신화탄성 탄성·페인트 계약서 기본 조건 (계약서 비고) — {업체} 자리에 업체명
const PAINT_TERMS = [
  `위의 제품을 설치함에 있어 계약자를 "갑"으로 하고 {업체}을 "을"이라 하며 다음과 같이 계약을 체결한다.`,
  '제1조[계약] 본 계약서 작성 및 계약금 납부와 동시에 계약이 성립됨을 확인한다.',
  '제2조[계약금 및 잔금] "갑"은 본 계약에 의한 계약금은 총 금액의 10%이며, "갑"은 계약한 시공장소에 시공이 완료 상태를 확인 후 잔금을 납부한다.',
  '제3조[해약 및 취소] 본 계약서 작성 및 계약 체결 후 일정이 정해지지 않는 한 계약금은 100% 환불 가능하다. 단, 일정이 정해진 후에 취소는 다른 일정을 받지 못하였으므로 계약금 환불은 불가하다.',
  '제4조[시공] "을"은 "갑"의 시공 장소에 계약 제품을 표준시방서에 따라 시공한다. 또한, "을"이 계약서에 달리 정하지 않는 한 "갑"이 요청하는 날까지 시공을 완료하여야 한다.',
];

const BUILTIN_TERMS = {
  'thegood:더좋은집': THEGOOD_TERMS,
};

// '[줄눈]' 처럼 구분 이름으로 시작하는 조건 묶음
export const termSection = (t) => (/^\[([^\]]+)\]/.exec(String(t)) || [])[1] || '';

// 계약 조건이 어디서 오는지: 'saved'(운영자 입력) / 'builtin'(예전 고정 조건) / 'default'(기본 4줄)
export function termsSource(company, brand) {
  const saved = company?.contractTerms?.[brand];
  if (Array.isArray(saved) && saved.some((t) => String(t).trim())) return 'saved';
  return BUILTIN_TERMS[`${company?.code || ''}:${brand}`] ? 'builtin' : 'default';
}

// 업체·브랜드의 계약 조건 전체 (운영자 저장 > 예전 고정 조건 > 기본)
export function brandTerms(company, brand) {
  const src = termsSource(company, brand);
  if (src === 'saved') return company.contractTerms[brand];
  return src === 'builtin' ? BUILTIN_TERMS[`${company.code}:${brand}`] : DEFAULT_CONTRACT_TERMS;
}

// 그 계약서에 보일 조건. categories(계약서의 구분들)에 맞는 '[구분]' 묶음 + 중요 조항(구분 없는 묶음)
//   맞는 구분 묶음이 없으면(예: 나노코팅) 중요 조항만, 중요 조항도 없으면 전체
export function contractTermsFor(company, brand, categories = []) {
  // 신화탄성 양식(기능 paintContract) 탄성·페인트 계약서: 운영자가 조건을 넣지 않았으면 신화탄성 계약서 비고 조항
  if (hasFeature(company, 'paintContract') && termsSource(company, brand) === 'default' && categories.length && categories.every((c) => PAINT_STYLE_CATEGORIES.includes(c))) {
    return PAINT_TERMS.map((t) => t.replace('{업체}', company?.name || brand || '시공사'));
  }
  const list = brandTerms(company, brand);
  if (!categories.length || !list.some(termSection)) return list;
  const picked = list.filter((t) => !termSection(t) || categories.includes(termSection(t)));
  return picked.length ? picked : list;
}

// 전자계약(서명) 상태
export const ESIGN_STATUS = {
  NONE: '미발송',
  WAITING: '서명대기',
  SIGNED: '서명완료',
};

export const PAYMENT_METHODS = ['계좌이체', '카드', '현금']; // 맨 앞이 새 입금 줄의 기본값

// 계약목록 날짜검색 기준
export const DATE_TYPES = [
  { value: 'contractDate', label: '계약일' },
  { value: 'scheduleDate', label: '시공예정일' },
  { value: 'completedDate', label: '시공완료일' },
  { value: 'canceledDate', label: '취소일' },
  { value: 'moveInDate', label: '입주예정일' },
  { value: 'createdAt', label: '등록일' },
];

export const SORT_OPTIONS = [
  { value: 'no_desc', label: '번호순(최신)' },
  { value: 'no_asc', label: '번호순(과거)' },
  { value: 'scheduleDate_asc', label: '시공예정일순' },
];

export const MAX_SCHEDULE_STEPS = 3;

// 사용자관리: 부서 / 직책 (선택 목록)
export const DEPARTMENTS = ['본사', '지부', '협력업체', '기타', '상담팀', '시공팀', '박람회팀'];
export const POSITIONS = ['대표', '지부장', '이사', '상무', '전무', '실장', '부장', '차장', '과장', '대리', '주임', '사원', '팀장', '줄눈시공팀', '나노시공팀', '탄성시공팀', '청소시공팀', '기타'];
