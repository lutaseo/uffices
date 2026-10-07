// 업무 코드값 모음. 추후 '설정' 메뉴에서 업체별로 관리하도록 확장할 값들입니다.

export const BRANDS = ['더좋은집', '더스타트'];

// 구분 (품목)
export const CATEGORIES = ['줄눈', '청소', '탄성', '새집증후군', '나노코팅', '기타'];

// 고객에게 계약서 한 장으로 묶어 보내는 구분 (같은 계약자·현장일 때). 그 외(나노코팅 등)는 따로
export const SIGN_TOGETHER = ['줄눈', '청소'];

// 시공종류
export const WORK_TYPES = ['시공', 'AS', '하자보수'];

export const RECEPTION_TYPES = ['음성계약', '박람회', '옵션', '사전계약', '무상시공'];

// 시공상태(최종) — 고객 모바일웹에 표시되는 값
export const WORK_STATUS = ['미정', '해피콜완료', '배정', '시공완료', '시공연기', '취소'];

// 기사가 모바일웹에서 보고하는 회차별 상태 ('' = 입력 전)
export const MOBILE_STATUS = ['시공완료', '시공연기요청', '시공불가'];

// 계약승인
export const APPROVAL_STATUS = ['승인대기', '승인', '미승인'];

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
};

// 입금 구분
export const PAYMENT_KINDS = ['계약금', '중도금', '잔금', '추가금', '환불'];

// 영수증 발행 구분
export const RECEIPT_TYPES = ['미발행', '현금영수증', '세금계산서', '카드전표'];

// 계약 단위 세금계산서 / 현금영수증 발행 상태
export const ISSUE_STATUS = ['', '발행요청', '발행완료', '해당없음'];

// 전자계약(서명) 상태
// 계약서 '계약 조건' (고정 — 바꿀 때는 여기를 수정)
//   CONTRACT_TERMS_BY_BRAND 에 브랜드별 조건을 넣으면 그 브랜드 계약서에 사용, 없으면 기본 조건
//   이미 서명한 계약서는 서명할 때의 조건이 계약에 함께 저장되어 바뀌지 않음
export const DEFAULT_CONTRACT_TERMS = [
  '시공 일정은 고객과 협의하여 확정하며, 일정 변경은 시공 3일 전까지 요청해야 합니다.',
  '잔금은 시공 완료 후 당일 결제를 원칙으로 합니다.',
  '시공 후 하자 발생 시 보증기간 내 무상 A/S 를 제공합니다.',
  '고객 사정에 의한 계약 취소 시 계약금은 환불되지 않을 수 있습니다.',
];

export const CONTRACT_TERMS_BY_BRAND = {
  // 더좋은집: ['…', '…'],
  // 더스타트: ['…', '…'],
};

export const contractTermsFor = (brand) => (CONTRACT_TERMS_BY_BRAND[brand]?.length ? CONTRACT_TERMS_BY_BRAND[brand] : DEFAULT_CONTRACT_TERMS);

export const ESIGN_STATUS = {
  NONE: '미발송',
  WAITING: '서명대기',
  SIGNED: '서명완료',
};

export const PAYMENT_METHODS = ['카드', '현금', '계좌이체'];

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
