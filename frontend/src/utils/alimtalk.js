// ============================================================
// 카카오 알림톡 템플릿 (비즈고에 등록·승인된 문구와 '한 글자도 다르지 않게')
//
//   카카오는 등록된 문구와 다르면 발송을 거절합니다.
//   비즈고에서 문구를 바꾸면 여기 body/title/buttons 도 똑같이 바꿔야 합니다.
//   #{이름} 칸은 보낼 때 계약 정보로 채워집니다 (variablesFor).
//
//   code: 비즈고 템플릿 코드 — 승인 후 실제 코드로 바꿔 넣기 (빈 값 = 아직 미등록)
//   channel: 템플릿이 등록된 카카오톡 채널(브랜드). 다른 브랜드로는 보낼 수 없음
// ============================================================

import { formatAddress } from './format.js';
import { timeLabel } from './contract.js';

export const ALIMTALK_BASE_URL = 'https://veritybase.vercel.app';

export const ALIMTALK_TEMPLATES = {
  // 기사님께: 작업 배정 (예전 togisa_start01 과 같은 문구, 버튼만 새 주소)
  기사배정_기사: {
    code: '',
    label: '기사배정 안내 (기사용)',
    channel: '더좋은집',
    title: '작업이 배정되었습니다.',
    subtitle: '더 좋은집',
    body: '기사님께 작업이 배정되었습니다.\n모바일에서 확인해주세요.\n\n- 시공일 : #{시공일}\n- 시간 : #{시간}\n- 주소 : #{주소}',
    buttons: [{ name: '시공확인페이지', url: `${ALIMTALK_BASE_URL}/thegood/engineer` }],
  },
  // 고객님께: 담당 기사 배정
  기사배정_고객: {
    code: '',
    label: '기사배정 안내 (고객용)',
    channel: '더좋은집',
    body: '#{고객명}님, 시공 담당 기사가 배정되었습니다.\n\n- 시공일 : #{시공일}\n- 시간 : #{시간}\n- 담당 기사 : #{기사명}',
    buttons: [{ name: '내 계약 확인', url: `${ALIMTALK_BASE_URL}/thegood/c/?q=#{링크}` }],
  },
  // 고객님께: 계약 완료
  계약완료: {
    code: '',
    label: '계약완료 안내',
    channel: '더좋은집',
    body: '#{고객명}님, 전자계약 작성이 정상적으로 완료되었습니다.\n감사합니다.',
    buttons: [{ name: '내 계약 확인', url: `${ALIMTALK_BASE_URL}/thegood/c/?q=#{링크}` }],
  },
  // 고객님께: 전자계약 서명 요청 (버튼 주소 끝이 고객마다 다름)
  서명요청: {
    code: '',
    label: '전자계약 서명요청',
    channel: '더좋은집',
    body: '#{고객명}님, 계약 내용을 확인하시고 서명해 주세요.\n아래 버튼을 누르면 계약서를 볼 수 있습니다.',
    buttons: [{ name: '계약서 확인·서명', url: `${ALIMTALK_BASE_URL}/e/?q=#{서명링크}` }],
  },
};

// 화면의 (템플릿, 받는 사람) → 알림톡 템플릿 키
export const templateKeyOf = (template, target) => (template === '기사배정' ? `기사배정_${target === '기사' ? '기사' : '고객'}` : template);

// #{이름} 칸 채우기
export const fillVars = (text, vars) => String(text || '').replace(/#\{([^}]+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== '' ? String(vars[k]) : m));

// 계약·회차·서명 링크·고객모바일 링크 → 템플릿 빈칸 값
//   #{링크}: 고객모바일 바로 로그인 (/thegood/c/…), #{서명링크}: 전자서명 (/sign/…)
export function variablesFor({ contract, schedule, signUrl, customerToken }) {
  const s = schedule || {};
  return {
    고객명: contract.customerName || '',
    시공일: s.date || '미정',
    시간: timeLabel(s) || '시간 협의',
    주소: formatAddress(contract),
    기사명: s.assigneeName || s.engineerName || '배정중',
    링크: customerToken || '',
    서명링크: String(signUrl || '').split('/sign/')[1] || '',
  };
}

// 실제로 나갈 메시지 (미리보기·발송 공용)
export function buildAlimtalk(key, ctx) {
  const t = ALIMTALK_TEMPLATES[key];
  const vars = variablesFor(ctx);
  return {
    key,
    code: t.code,
    channel: t.channel,
    title: t.title || '',
    subtitle: t.subtitle || '',
    text: fillVars(t.body, vars),
    buttons: t.buttons.map((b) => ({ name: b.name, url: fillVars(b.url, vars) })),
    variables: vars,
    missing: [...new Set([...t.body.matchAll(/#\{([^}]+)\}/g), ...t.buttons.flatMap((b) => [...b.url.matchAll(/#\{([^}]+)\}/g)])].map((m) => m[1]))].filter((k) => !vars[k]),
  };
}
