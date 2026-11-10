// PC: 브라우저(앱 창)를 모두 닫았다가 다시 열면 로그인 풀기
//   1) 서버가 PC 에는 기간 없는 로그인 쿠키를 줌 → 브라우저를 완전히 끄면 사라짐 (server/session.js browserOnly)
//   2) 그런데 크롬 '이전에 열던 페이지 열기' 설정이면 그 쿠키도 되살아나서, 열려 있는 창이 하나라도 있는 동안
//      30초마다 '열려 있음' 시각을 남기고, 화면을 새로 열 때 그 시각이 3분보다 오래됐으면(= 모든 창이 닫혀 있었음) 로그아웃
//   휴대폰·태블릿은 그대로 (기사님이 매번 로그인하지 않게)
import { API_MODE } from '../api/index.js';
import { APP_HEADER, APPS, DEVICE_HEADER, isPcDevice } from '../api/sessionSlots.js';

const KEY = 'vb.pcAlive';
const STALE = 3 * 60 * 1000;
const enabled = () => API_MODE === 'server' && isPcDevice();

// 이 화면을 연 순간의 기록 (아래 startPcHeartbeat 가 시각을 새로 쓰기 전에 읽어 둠)
let lastAtStart = null;
try {
  lastAtStart = Number(localStorage.getItem(KEY)) || 0;
} catch {
  lastAtStart = null; // 저장 안 되는 브라우저 — 쿠키만으로 처리
}
let checked = false;

function beat() {
  try {
    localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // 저장 안 되는 브라우저 — 쿠키만으로 처리
  }
}

// 화면을 처음 열 때(로그인 확인 전) 한 번: 모든 창이 닫혀 있었으면 일반·상담실장·기사 로그인 모두 정리
export async function endStalePcLogin() {
  if (!enabled() || checked || lastAtStart === null) return;
  checked = true; // 처음 한 번만 (화면 안에서 다시 확인할 때는 건너뜀)
  beat();
  if (Date.now() - lastAtStart < STALE) return; // 다른 창이 열려 있었거나 방금 새로고침 → 그대로
  // 한 쿠키에 세 칸이 같이 들어 있어서, 동시에 보내면 서로의 결과를 덮어씀 → 차례대로
  for (const app of APPS) {
    await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [APP_HEADER]: app, [DEVICE_HEADER]: 'pc' },
      credentials: 'same-origin',
      body: JSON.stringify({ service: 'auth', method: 'logout', args: [] }),
    }).catch(() => {});
  }
}

export function startPcHeartbeat() {
  if (!enabled()) return;
  beat();
  setInterval(beat, 30 * 1000);
  document.addEventListener('visibilitychange', beat);
}
