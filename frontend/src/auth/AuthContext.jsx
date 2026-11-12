import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { API_MODE, auth, imports } from '../api/index.js';
import { can } from './permissions.js';
import { setAppManifest } from '../utils/install.js';
import { endStalePcLogin } from '../utils/pcSession.js';
import { tabApp } from '../api/sessionSlots.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, company: null, loading: true });

  const refresh = useCallback(async () => {
    try {
      await endStalePcLogin(); // PC 에서 창을 모두 닫았다가 다시 열었으면 먼저 로그아웃
      const { user, company } = await auth.me();
      setState({ user, company, loading: false });
    } catch {
      setState({ user: null, company: null, loading: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 화면으로 돌아오면 내 계정 정보(권한)를 다시 읽음 — 관리자가 권한을 바꾸면 다시 로그인하지 않아도 반영
  //   (10초에 한 번까지, 로그인 상태일 때만 · 실패하면 그대로 둠 — 로그아웃시키지 않음)
  useEffect(() => {
    let last = Date.now();
    const onShow = async () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 10000) return;
      last = Date.now();
      try {
        const { user, company } = await auth.me();
        setState((prev) => (prev.user ? { user, company, loading: false } : prev));
      } catch {
        // 연결이 잠깐 끊긴 경우 등 — 다음 요청에서 처리
      }
    };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
    };
  }, []);

  // 앱 설치 정보(manifest)를 로그인한 업체·화면(일반 / 상담실장 / 기사모바일)에 맞춤
  useEffect(() => {
    if (API_MODE === 'server' && state.company?.code) setAppManifest(state.company.code, tabApp()); // 데모(서버 없음)는 기본 앱 정보 그대로
  }, [state.company?.code, state.user?.id]);

  // [임시] 관리자가 로그인하면 한 번: 예전 프로그램 계약의 계약담당을 실장님별로 맞춤 (끝나면 업체 정보에 기록 → 다시 안 함)
  const ownerFixTried = useRef(false);
  useEffect(() => {
    if (state.user?.role !== 'ADMIN' || state.company?.ownerFix?.done || ownerFixTried.current) return;
    ownerFixTried.current = true;
    imports.ownerFixAuto().catch(() => {
      ownerFixTried.current = false; // 실패하면 다음 화면 이동 때 다시
    });
  }, [state.user, state.company]);

  // kind 'engineer': 기사모바일(/업체주소/m) 로그인 — 기사 계정만, 'manager': 상담실장(/업체주소/t) — 직원 계정만
  const login = useCallback(async (loginId, password, companyCode, kind) => {
    const { user, company } = await auth.login(loginId, password, companyCode, kind);
    setState({ user, company, loading: false });
  }, []);

  const logout = useCallback(async () => {
    try {
      await auth.logout();
    } catch {
      // 서버 연결이 끊겨도 화면은 로그아웃 처리
    }
    setState({ user: null, company: null, loading: false });
  }, []);

  // 모든 화면 공통 에러 처리: 세션 만료/이용기간 만료면 로그인 화면으로
  const handleError = useCallback(
    (e) => {
      alert(e?.message || '처리 중 오류가 발생했습니다.');
      if (e?.code === 'UNAUTHORIZED') logout();
    },
    [logout],
  );

  const value = useMemo(
    () => ({ ...state, login, logout, refresh, handleError, can: (p) => can(state.user, p) }),
    [state, login, logout, refresh, handleError],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
