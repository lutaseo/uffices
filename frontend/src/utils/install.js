// 앱 설치 (PC·휴대폰 바탕화면에 아이콘 → 누르면 주소창 없는 앱 창으로 열림)
//   - 크롬·엣지·삼성인터넷: 브라우저가 '설치할 수 있음'을 알려 주면(beforeinstallprompt) 그 신호를 보관했다가 [앱 설치] 버튼으로 띄움
//   - 아이폰(사파리) 등 신호가 없는 브라우저: 화면에 설치 방법을 글로 안내
//   - 앱 정보(manifest)는 업체 주소·화면(일반 / 상담실장 t / 기사모바일 m)마다 따로 → 설치하면 그 화면으로 열림
//   - 주소 끝에 ?web=1 을 붙여 열면 '브라우저처럼' 열리는 바로가기용 앱 정보로 바꿈 (탭에 기억)
import { useEffect, useState } from 'react';

let deferred = null;
let installed = false;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 브라우저가 멋대로 띄우지 않게 — 내 정보의 [앱 설치]로만
    deferred = e;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

const WEB_KEY = 'vb.web';
function webMode() {
  try {
    if (new URLSearchParams(window.location.search).get('web') === '1') window.sessionStorage.setItem(WEB_KEY, '1');
    return window.sessionStorage.getItem(WEB_KEY) === '1';
  } catch {
    return false;
  }
}

export const isStandalone = () =>
  typeof window !== 'undefined' && (!!window.matchMedia?.('(display-mode: standalone)').matches || !!window.matchMedia?.('(display-mode: window-controls-overlay)').matches || window.navigator.standalone === true);

const KIND = { staff: '', manager: 't', engineer: 'm' };

// 로그인한 업체·화면에 맞는 앱 정보로 바꿈 (로그인 뒤 /contracts 같은 주소로 다녀도 설치하면 업체 첫 화면으로)
export function setAppManifest(code, app) {
  if (typeof document === 'undefined' || !/^[a-z0-9-]{2,30}$/.test(String(code || ''))) return;
  const link = document.querySelector('link[rel="manifest"]');
  if (!link) return;
  const href = `/api/page?manifest=1&code=${encodeURIComponent(code)}&kind=${KIND[app] ?? ''}${webMode() ? '&web=1' : ''}`;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

// 이 화면의 주소 (브라우저처럼 열리는 바로가기용은 ?web=1)
export function appUrl(code, app, web = false) {
  const kind = KIND[app] ?? '';
  return `${window.location.origin}/${code}${kind ? `/${kind}` : ''}${web ? '?web=1' : ''}`;
}

export function deviceType() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Android/i.test(ua)) return 'android';
  return 'pc';
}

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => {
    const fn = () => tick((n) => n + 1);
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, []);
  return {
    canPrompt: !!deferred,
    installed,
    standalone: isStandalone(),
    async prompt() {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      notify();
      await e.prompt();
      const choice = await e.userChoice.catch(() => null);
      return choice?.outcome === 'accepted';
    },
  };
}
