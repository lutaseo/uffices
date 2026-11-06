// 브라우저 데모 모드 저장소 (localStorage). 서버 연결 시에는 사용되지 않습니다.

import { buildSeed, migrate } from './seed.js';
import { mergeSession, tabApp, viewSession } from './sessionSlots.js';

const DB_KEY = 'uffice.db.v1';
const SESSION_KEY = 'uffice.session';
function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}
function writeSession(full) {
  if (full) localStorage.setItem(SESSION_KEY, JSON.stringify(full));
  else localStorage.removeItem(SESSION_KEY);
}

async function sha256(password) {
  const text = `uffice:${password}`;
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // http(비보안 컨텍스트) 접속 시 대체용 — 데모 전용
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `weak-${h}`;
}

const hashMode = () => (globalThis.crypto?.subtle ? 'sha256' : 'weak');

// 매 요청마다 저장된 값을 새로 읽어 사본을 돌려줌 → 처리 중 오류가 나면 변경이 저장되지 않음 (서버의 트랜잭션 롤백과 동일)
function readDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export const browserAdapter = {
  async loadDb() {
    const existing = readDb();
    if (existing) {
      if (migrate(existing)) writeDb(existing);
      // 비밀번호 해시 방식이 바뀐 환경(http↔https)에서 데모 계정 로그인이 막히지 않도록 재생성
      if (existing.hashMode === hashMode()) return existing;
    }
    const db = await buildSeed(sha256);
    db.hashMode = hashMode();
    writeDb(db);
    return db;
  },
  saveDb: writeDb,
  hashPassword: sha256,
  verifyPassword: async (password, hash) => !!hash && (await sha256(password)) === hash,
  // 이 탭(일반 / 상담실장 / 기사모바일)의 로그인 칸만 보고 바꿈 (sessionSlots.js)
  getSession() {
    return viewSession(readSession(), tabApp());
  },
  setSession(data) {
    writeSession(mergeSession(readSession(), tabApp(), data));
  },
  clearSession() {
    writeSession(mergeSession(readSession(), tabApp(), null));
  },
  publicBaseUrl: () => location.origin,
  clientInfo: () => ({ userAgent: navigator.userAgent }),
  async resetDemoData() {
    localStorage.removeItem(DB_KEY);
    return browserAdapter.loadDb();
  },
};
