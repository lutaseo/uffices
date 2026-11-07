// 새 버전 자동 반영
//   휴대폰·태블릿 브라우저와 홈 화면 바로가기는 탭을 닫지 않으면 며칠씩 예전 화면을 그대로 보여 줌
//   → 새로 배포해도 새 기능(예: 박람회 일정)이 안 보이는 일이 생김
//   그래서 화면으로 돌아올 때·5분마다 배포된 index.html 의 화면 파일 이름을 확인하고, 바뀌었으면
//     - 입력 중이 아닐 때(등록·수정 화면, 열린 창, 서명 화면이 아닐 때): 바로 새로고침
//     - 입력 중일 때: 위쪽에 [새 버전이 나왔습니다 · 새로고침] 띠만 보여 줌 (적던 내용이 날아가지 않게)

const ASSET = /\/assets\/index-[\w-]+\.js/;
const CHECK_EVERY = 5 * 60 * 1000;

const currentAsset = () => {
  const s = [...document.querySelectorAll('script[type="module"][src]')].map((x) => new URL(x.src, location.href).pathname).find((p) => ASSET.test(p));
  return s || null; // 개발 화면(vite dev)에는 없음 → 확인 안 함
};

// 지금 무언가 입력 중인지 (새로고침하면 적던 내용이 사라지는 화면)
const busy = () =>
  /\/(new|edit)(\/|$)/.test(location.pathname) ||
  /^\/(e|sign)(\/|$)/.test(location.pathname) ||
  !!document.querySelector('.modal-overlay, .onsite-sign, canvas');

function showBanner() {
  if (document.getElementById('vb-update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'vb-update-banner';
  bar.className = 'update-banner';
  bar.innerHTML = '새 버전이 나왔습니다. 입력을 마친 뒤 <button type="button">새로고침</button> 을 눌러 주세요.';
  bar.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(bar);
}

export function startUpdateCheck() {
  const mine = currentAsset();
  if (!mine || typeof fetch !== 'function') return;
  let pending = false;
  let checking = false;

  let target = '';
  // 같은 새 버전으로는 한 번만 새로고침 (혹시 새로고침해도 예전 화면이 오면 반복하지 않고 안내 띠만)
  const apply = () => {
    let done = '';
    try {
      done = sessionStorage.getItem('vb.reloadedFor') || '';
    } catch {
      // 저장 안 되는 브라우저
    }
    if (busy() || done === target) return showBanner();
    try {
      sessionStorage.setItem('vb.reloadedFor', target);
    } catch {
      return showBanner(); // 기록을 못 남기면 반복될 수 있으니 안내 띠만
    }
    location.reload();
  };

  const check = async () => {
    if (checking) return;
    if (pending) return apply();
    checking = true;
    try {
      const r = await fetch(`/index.html?v=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const found = (await r.text()).match(ASSET)?.[0];
      if (found && found !== mine) {
        target = found;
        pending = true;
        apply();
      }
    } catch {
      // 인터넷이 잠깐 끊겨도 다음에 다시 확인
    } finally {
      checking = false;
    }
  };

  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
  window.addEventListener('focus', check);
  window.addEventListener('pageshow', (e) => e.persisted && check()); // 뒤로가기로 예전 화면이 그대로 돌아왔을 때
  setInterval(() => document.visibilityState === 'visible' && check(), CHECK_EVERY);
  check();
}
