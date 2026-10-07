// 서버 모드: 화면의 서비스 호출을 서버(/api/rpc)로 전달합니다.
// 서버는 같은 services.js 코드를 실행하므로 함수 이름/인자/결과가 데모 모드와 동일합니다.

import { ApiError } from './core.js';

async function call(service, method, args) {
  let res;
  // 서버가 응답하지 않으면 '불러오는 중...'에 머물지 않도록 70초에서 끊고 안내 (서버 제한 60초 + 여유)
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), 70000);
  try {
    res = await fetch('/api/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ service, method, args }),
      signal: ctrl?.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new ApiError('서버 응답이 너무 늦습니다. 잠시 후 새로고침해 주세요.', 'NETWORK');
    throw new ApiError('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.', 'NETWORK');
  } finally {
    if (timer) clearTimeout(timer);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok || !data) {
    throw new ApiError(data?.error?.message || `서버 오류가 발생했습니다. (${res.status})`, data?.error?.code || 'SERVER');
  }
  return data.result;
}

const proxy = (service) =>
  new Proxy(
    {},
    {
      get: (_, method) => (typeof method === 'string' ? (...args) => call(service, method, args) : undefined),
    },
  );

export const SERVICE_NAMES = [
  'auth',
  'companies',
  'users',
  'engineers',
  'teams',
  'products',
  'apartments',
  'customers',
  'contracts',
  'esign',
  'notifications',
  'reports',
  'schedules',
  'engineerOffs',
  'engineerApp',
  'scheduleSettings',
  'imports',
];

export const remoteServices = Object.fromEntries(SERVICE_NAMES.map((name) => [name, proxy(name)]));
