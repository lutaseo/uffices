import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { API_MODE, companies } from '../api/index.js';

// companyCode: 업체 주소(uffices.vercel.app/thegood)로 들어오면 그 업체 로그인 화면
export default function LoginPage({ companyCode = '' }) {
  const { login } = useAuth();
  const [company, setCompany] = useState(undefined); // undefined: 확인 중, null: 없는 주소
  useEffect(() => {
    if (!companyCode) return;
    companies.publicInfo(companyCode).then(setCompany).catch(() => setCompany(null));
  }, [companyCode]);
  const [loginId, setLoginId] = useState(() => localStorage.getItem('lastLoginId') || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!loginId.trim() || !password) {
      setError('아이디와 비밀번호를 입력해 주세요.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await login(loginId, password, companyCode);
      localStorage.setItem('lastLoginId', loginId.trim());
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-left">
          <span className="logo-box large">V</span>
          <h1>{company ? `${company.name} VerityBase` : 'VerityBase'}</h1>
          <p className="login-sub">전자계약 · 시공일정 관리</p>
          {companyCode && company === null && <p className="login-error">존재하지 않는 업체 주소입니다 ({companyCode}). 주소를 확인해 주세요.</p>}
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="아이디 입력"
            value={loginId}
            onChange={(e) => setLoginId(e.target.value)}
            autoComplete="username"
            autoFocus
          />
          <input
            type="password"
            placeholder="비밀번호 입력"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <button type="submit" disabled={submitting}>
            {submitting ? '로그인 중...' : '로그인'}
          </button>
          {error && <p className="login-error">{error}</p>}
        </form>

        <div className="login-footer">
          ⓘ 계정 발급 및 이용기간 문의는 운영자에게 연락해 주세요. &nbsp; ⓒ VerityBase. ALL RIGHTS RESERVEDD
        </div>

        {API_MODE === 'demo' && (
          <div className="login-demo">
            테스트 계정 — 운영자: super / super1234 · 관리자: admin / admin1234 · 실장: manager / manager1234 · 기사: gong / gong1234
            <br />
            ⚠ 데모 모드: 입력한 내용이 이 기기에만 저장됩니다. 서버 연결 상태는 <a href="/api/rpc" target="_blank" rel="noreferrer">/api/rpc</a> 에서 확인하세요.
          </div>
        )}
      </div>
    </div>
  );
}
