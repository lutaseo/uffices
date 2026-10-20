import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { auth } from '../api/index.js';
import { can } from './permissions.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, company: null, loading: true });

  const refresh = useCallback(async () => {
    try {
      const { user, company } = await auth.me();
      setState({ user, company, loading: false });
    } catch {
      setState({ user: null, company: null, loading: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // kind 'engineer': 기사모바일(/업체주소/m) 로그인 — 기사 계정만
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
