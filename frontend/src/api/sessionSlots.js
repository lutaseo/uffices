// 로그인 칸 나누기: 한 브라우저에서 일반 화면(직원) · 상담실장(/t) · 기사모바일(/m)에 따로 로그인
//   쿠키(서버) / localStorage(데모) 하나에 { ...일반 화면 로그인, mgr: 상담실장, eng: 기사모바일, customer: 고객모바일 } 으로 보관
//   업무 코드(getSession/setSession)는 지금 탭의 칸만 봄 — 서버는 요청 머리글(x-vb-app), 데모는 탭 정보로 앎
//   예) 일반 화면에 관리자로 로그인한 채 새 탭에서 /업체/m 이나 /업체/t 를 열면 그 로그인 화면이 따로 뜸

export const APP_HEADER = 'x-vb-app'; // 화면 → 서버: 'engineer' | 'manager' | (없음 = 일반)
const SLOTS = { engineer: 'eng', manager: 'mgr' };
export const APPS = ['staff', ...Object.keys(SLOTS)];
export const appOf = (v) => (SLOTS[v] ? v : 'staff');

const clean = (o) => {
  if (!o) return null;
  const { exp, ...rest } = o; // eslint-disable-line no-unused-vars
  return Object.keys(rest).length ? rest : null;
};
const withoutSlots = (o) => {
  const out = { ...(o || {}) };
  Object.values(SLOTS).forEach((k) => delete out[k]);
  return out;
};

// 저장된 전체 → 지금 화면이 보는 로그인
//   예전 쿠키(칸 나누기 전)에 기사 로그인이 맨 위에 있으면 기사모바일 칸으로 봄 (기사는 다시 로그인 안 해도 됨)
const legacyEngineer = (full) => (full && full.engineerId && !full.userId ? { engineerId: full.engineerId } : null);

export function viewSession(full, app) {
  if (!full) return null;
  const slot = SLOTS[app];
  const own = slot === 'eng' ? full.eng || legacyEngineer(full) : slot ? full[slot] : null;
  if (slot) return clean({ ...(own || {}), ...(full.customer ? { customer: full.customer } : {}) });
  return clean(withoutSlots(full)); // 기사 아이디만 있는 계정은 일반 화면에서도 기사로 로그인 (예전처럼)
}

// 지금 화면의 로그인을 바꿈(data=null 이면 로그아웃) → 다른 칸은 그대로 둔 전체
export function mergeSession(full, app, data) {
  const base = clean(full) || {};
  const slot = SLOTS[app];
  if (slot) {
    const { customer, ...own } = withoutSlots(clean(data) || {});
    const out = { ...base };
    delete out[slot];
    if (slot === 'eng' && legacyEngineer(base)) delete out.engineerId; // 예전 맨 위 기사 로그인 정리
    if (Object.keys(own).length) out[slot] = own;
    if (data && 'customer' in data) {
      if (customer) out.customer = customer;
      else delete out.customer;
    }
    return clean(out);
  }
  const out = withoutSlots(clean(data) || {});
  Object.values(SLOTS).forEach((k) => {
    if (base[k]) out[k] = base[k];
  });
  if (!out.eng && legacyEngineer(base) && !legacyEngineer(out)) out.eng = legacyEngineer(base); // 예전 기사 로그인은 기사모바일 칸으로 옮겨 둠
  return clean(out);
}

// ---------------- 브라우저: 이 탭이 어느 화면인지 ----------------
//   /업체/m... → 기사모바일, /업체/t → 상담실장, /업체 (로그인 첫 주소) → 일반 화면 — 탭마다 기억(sessionStorage)
//   상담실장은 로그인 뒤 /consult, /contracts/new 같은 일반 주소로 다니므로 주소만으로는 모름 → 탭에 기억한 값 사용
const TAB_KEY = 'vb.app';
function pathApp(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  const PAGES = ['c', 'e', 'm', 't', 'consult', 'contracts', 'customers', 'schedule', 'progress', 'stats', 'admin', 'settings', 'me', 'engineer', 'sign', 'api', 'assets'];
  const rest = parts[0] && !PAGES.includes(parts[0]) ? parts.slice(1) : parts; // 업체 코드 빼기
  if (rest[0] === 'm' || rest[0] === 'engineer') return 'engineer';
  if ((rest[0] === 't' && rest.length === 1) || rest[0] === 'consult') return 'manager'; // 상담홈(/consult)도 상담실장 탭
  if (rest.length === 0) return 'staff';
  return null; // 일반 주소 — 탭에 기억한 값
}

export function tabApp() {
  if (typeof window === 'undefined') return 'staff';
  const byPath = pathApp(window.location.pathname);
  try {
    if (byPath) {
      window.sessionStorage.setItem(TAB_KEY, byPath);
      return byPath;
    }
    return appOf(window.sessionStorage.getItem(TAB_KEY));
  } catch {
    return byPath || 'staff';
  }
}

export function setTabApp(app) {
  try {
    window.sessionStorage.setItem(TAB_KEY, appOf(app));
  } catch {
    // 저장 안 되는 브라우저면 주소로만 판단
  }
}
