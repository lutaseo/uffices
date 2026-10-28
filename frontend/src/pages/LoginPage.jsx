import React, { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { API_MODE, companies } from '../api/index.js';
import { usePageTitle } from '../utils/title.js';

// companyCode: 업체 주소(veritybase.vercel.app/업체주소)로 들어오면 그 업체 로그인 화면
// kind: 로그인 주소별 화면
//   'engineer' /업체주소/m  기사모바일 (기사 계정만)
//   'manager'  /업체주소/t  상담실장 (직원 계정만, 로그인 뒤 화면은 일반화면과 같음)
//   'staff'    /업체주소    일반화면 (관리자·실장, 없으면 기사)
//   기사 아이디와 직원 아이디가 같아도 로그인하는 주소로 구분됨
const KINDS = {
  engineer: { label: '기사모바일', sub: '시공기사 전용 · 내 일정 확인과 완료 보고' },
  manager: { label: '상담실장', sub: '상담 실장 전용 · 계약 등록과 상담 관리' },
  staff: { label: '일반화면', sub: '전자계약 · 시공일정 관리 (관리자 · 실장)' },
};
// 예전에 기억해 두던 아이디는 지움 (아이디 자동 저장 기능 없앰 — 같은 기기를 여럿이 쓰는 경우)
try {
  ['lastLoginId', 'lastLoginId.engineer'].forEach((k) => localStorage.removeItem(k));
} catch {
  // 저장소를 못 쓰는 브라우저면 지울 것도 없음
}
const ENTRY_KEY = 'loginEntry';
// 마지막으로 로그인한 주소 종류 (로그아웃 뒤 같은 로그인 화면으로 돌아가기용)
export function loginEntry() {
  try {
    return localStorage.getItem(ENTRY_KEY) || 'staff';
  } catch {
    return 'staff';
  }
}

export default function LoginPage({ companyCode = '', kind = 'staff' }) {
  const { label, sub: subText } = KINDS[kind] || KINDS.staff;
  const { login } = useAuth();
  const [company, setCompany] = useState(undefined); // undefined: 확인 중, null: 없는 주소
  useEffect(() => {
    if (!companyCode) return;
    companies.publicInfo(companyCode).then(setCompany).catch(() => setCompany(null));
  }, [companyCode]);
  // 탭 이름: 업체 주소 없으면 운영자 로그인
  const shortName = !companyCode ? 'VerityBase 운영자' : `${company?.name || ''} ${kind === 'engineer' ? '기사' : kind === 'manager' ? '상담' : ''}`.trim();
  usePageTitle(companyCode ? `${label} 로그인 · ${company?.name ? `${company.name} ` : ''}VerityBase` : 'VerityBase 운영자 로그인', shortName);
  const [loginId, setLoginId] = useState('');
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
      await login(loginId, password, companyCode, kind);
      try {
        localStorage.setItem(ENTRY_KEY, kind);
      } catch {
        // 저장 안 되는 브라우저면 로그아웃 뒤 일반 로그인 화면으로
      }
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">
        <div className="login-left">
          <span className="logo-box large">VB</span>
          <h1>{company ? `${company.name} VerityBase` : 'VerityBase'}</h1>
          <p className="login-kind">{label}</p>
          <p className="login-sub">{subText}</p>
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
          ⓘ 계정 발급 및 이용기간 문의는 운영자에게 연락해 주세요. &nbsp; ⓒ VerityBase. ALL RIGHTS RESERVED
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
