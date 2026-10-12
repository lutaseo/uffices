// ============================================================
// 화면 주소(URL) 관리 — 브라우저 뒤로가기/앞으로가기가 사이트 안에서 동작하도록
//
//   업체마다 주소 앞에 업체 코드가 붙습니다:  /thegood/contracts, /thegood/engineer ...
//   화면 코드에서는 업체 코드를 뺀 주소(/contracts)만 다루고, 이동할 때 자동으로 붙입니다.
//
//   /{업체}              업체 로그인        /{업체}/contracts/12       계약 상세
//   /{업체}/contracts     계약 목록          /{업체}/contracts/12/edit  계약 수정
//   /{업체}/contracts/new 계약 등록          /{업체}/contracts/new?from=12  같은 현장 시공 추가
//   /{업체}/customers  /schedule  /progress  /stats  /settings/...  /me
//   /{업체}/m  /{업체}/m/off  /{업체}/m/contract/12   (기사모바일, 예전 /engineer 주소도 넘겨줌)
//   /{업체}/c  /{업체}/c/:고유값      (고객모바일 — 이름+휴대폰 / 알림톡 링크로 바로 로그인)
//   /                    운영자 로그인      /admin  (운영자 업체 관리)
//   /sign/:token         고객 전자서명 (로그인 불필요, 업체 코드 없음)
//   /e/?q=토큰           = /sign/토큰 (알림톡 버튼용 — 예전 프로그램과 같은 모양)
// ============================================================

import { useEffect, useState } from 'react';

const EVENT = 'uffice:navigate';

// 업체 코드가 아닌 첫 주소 단어 (화면 이름)
const PAGES = ['c', 'e', 'm', 'contracts', 'customers', 'schedule', 'progress', 'stats', 'admin', 'settings', 'me', 'engineer', 'sign', 'api', 'assets'];

function split(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const [first, ...rest] = clean.split('/').filter(Boolean);
  if (first && !PAGES.includes(first)) return { base: first.toLowerCase(), path: `/${rest.join('/')}` };
  return { base: '', path: clean };
}

const current = () => ({
  ...split(window.location.pathname),
  query: new URLSearchParams(window.location.search),
  state: window.history.state || {},
});

// 현재 업체 코드를 붙인 실제 주소 (/sign 은 업체 코드 없이)
export function withBase(to, base = split(window.location.pathname).base) {
  const target = new URL(to, window.location.origin);
  if (!base || target.pathname.startsWith('/sign/') || split(target.pathname).base) return target.pathname + target.search;
  return `/${base}${target.pathname === '/' ? '' : target.pathname}${target.search}`;
}

// options.replace: 현재 기록을 바꿈(뒤로가기 대상이 되지 않음), options.state: 기록에 함께 저장할 값
// options.base: 업체 코드를 바꿔서 이동 (로그인 직후 자기 업체 주소로), ''이면 업체 코드 없이
export function navigate(to, { replace = false, state = {}, base } = {}) {
  const target = new URL(base === undefined ? withBase(to) : withBase(to, base), window.location.origin);
  const same = target.pathname + target.search === window.location.pathname + window.location.search;
  if (same && !replace) return;
  window.history[replace ? 'replaceState' : 'pushState'](state, '', target.pathname + target.search);
  window.dispatchEvent(new Event(EVENT));
  if (!replace) window.scrollTo(0, 0);
}

// 이전 화면이 사이트 안이면 뒤로가기, 아니면 지정한 주소로 이동
export function goBack(fallback) {
  if (window.history.state?.canGoBack) window.history.back();
  else navigate(fallback, { replace: true });
}

// 다른 화면으로 이동하면서, 그 화면에서 "뒤로" 누르면 여기로 돌아오게 표시
export const navigateForward = (to) => navigate(to, { state: { canGoBack: true } });

export function useRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const update = () => setRoute(current());
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return route;
}

// '/contracts/:id/edit' 같은 패턴과 주소 비교 → { id: '12' } 또는 null
export function match(pattern, path) {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return params;
}

// <Link to="/contracts">목록</Link> — 새 탭 열기(Ctrl/휠 클릭)도 지원
export function linkProps(to, onNavigate = navigate) {
  return {
    href: withBase(to),
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      onNavigate(to);
    },
  };
}
