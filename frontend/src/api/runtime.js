// ============================================================
// 실행 환경 어댑터
//
// 업무 로직(core/contracts/schedule/index.js)은 이 파일의 함수만 사용하고,
// 실제 저장·세션·암호화 방식은 실행 환경이 주입합니다.
//   - 브라우저 데모 모드: browserAdapter.js (localStorage)
//   - 서버:              server/adapter.js (PostgreSQL + 쿠키 세션 + scrypt)
// 그래서 같은 권한 검사/휴무 규칙 코드가 브라우저와 서버에서 똑같이 동작합니다.
// ============================================================

import { browserAdapter } from './browserAdapter.js';

let adapter = browserAdapter;

export function setRuntimeAdapter(next) {
  adapter = next;
}

export const loadDb = () => adapter.loadDb();
export const saveDb = (db) => adapter.saveDb(db);
export const hashPassword = (password) => adapter.hashPassword(password);
export const verifyPassword = (password, hash) => adapter.verifyPassword(password, hash);
export const getSession = () => adapter.getSession();
export const setSession = (data) => adapter.setSession(data);
export const clearSession = () => adapter.clearSession();
export const publicBaseUrl = () => adapter.publicBaseUrl();
export const clientInfo = () => adapter.clientInfo();
export const resetDemoData = () => adapter.resetDemoData();
// 알림톡 발송(비즈고) — 서버에서만. 브라우저 데모 모드는 '연결 안 됨'
export const alimtalkGateway = () => adapter.alimtalk || null;

export { nextId } from './seed.js';
