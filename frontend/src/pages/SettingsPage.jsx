import React, { useState } from 'react';
import { API_MODE, auth } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE_LABELS } from '../auth/permissions.js';

// 설정 > 내 정보 (비밀번호 변경)
export default function SettingsPage() {
  const { user, company, handleError, logout } = useAuth();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  const changePassword = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) {
      alert('새 비밀번호가 일치하지 않습니다.');
      return;
    }
    try {
      await auth.changePassword(pw.current, pw.next);
      alert('비밀번호가 변경되었습니다.');
      setPw({ current: '', next: '', confirm: '' });
    } catch (err) {
      handleError(err);
    }
  };

  const resetDemo = async () => {
    if (!window.confirm('모든 데이터를 샘플 데이터로 초기화합니다. 계속하시겠습니까?')) return;
    await auth.resetDemoData();
    logout();
  };

  return (
    <div className="page-card">
      <h2>설정</h2>

      <h3 className="section-title">내 정보</h3>
      <table className="form-grid-table narrow-table">
        <tbody>
          <tr><td className="label-col">아이디</td><td className="input-col">{user.loginId}</td></tr>
          <tr><td className="label-col">이름</td><td className="input-col">{user.name} ({ROLE_LABELS[user.role]})</td></tr>
          {company && (
            <>
              <tr><td className="label-col">업체</td><td className="input-col">{company.name} · 대표 {company.ceo} · {company.bizNo}</td></tr>
              <tr><td className="label-col">이용기간</td><td className="input-col">{company.periodStart} ~ {company.periodEnd}</td></tr>
            </>
          )}
        </tbody>
      </table>

      <h3 className="section-title">비밀번호 변경</h3>
      <form onSubmit={changePassword} className="inline-fields">
        <input type="password" className="input-text" placeholder="현재 비밀번호" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required />
        <input type="password" className="input-text" placeholder="새 비밀번호" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required />
        <input type="password" className="input-text" placeholder="새 비밀번호 확인" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" required />
        <button type="submit" className="btn-dark-lg sm">변경</button>
      </form>

      <p className="sub-text" style={{ marginTop: 30 }}>
        브랜드·구분 코드, 알림톡 템플릿 관리는 추후 설정 메뉴에 추가됩니다.
      </p>

      {API_MODE === 'demo' && (
        <button type="button" className="btn-text-danger" style={{ marginTop: 10 }} onClick={resetDemo}>
          [개발용] 샘플 데이터 초기화
        </button>
      )}
    </div>
  );
}
