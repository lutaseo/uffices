import React, { useEffect, useState } from 'react';
import { companies as companyApi, customerApp } from '../api/index.js';
import { timeLabel } from '../utils/contract.js';
import { formatPhone, won } from '../utils/format.js';
import { formatKoreanDate } from '../utils/date.js';
import { navigate } from '../router.js';

// 고객모바일 (/{업체}/c, 알림톡 링크 /{업체}/c/{고유값})
//   - 링크로 들어오면 입력 없이 바로 로그인
//   - 직접 들어오면 이름 + 휴대폰번호 (아이디저장 / 자동로그인은 이 기기에만 저장)
const CIRCLED = ['①', '②', '③'];
const memKey = (code) => `vb.customer.${code}`;
const readMem = (code) => {
  try {
    return JSON.parse(localStorage.getItem(memKey(code)) || '{}');
  } catch {
    return {};
  }
};
const writeMem = (code, v) => {
  try {
    if (v) localStorage.setItem(memKey(code), JSON.stringify(v));
    else localStorage.removeItem(memKey(code));
  } catch {
    /* 저장 안 되는 브라우저는 무시 */
  }
};

export default function CustomerApp({ companyCode, token }) {
  const [data, setData] = useState(null);
  const [checking, setChecking] = useState(true);
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    companyApi
      .publicInfo(companyCode)
      .then((c) => setCompanyName(c?.name || ''))
      .catch(() => {});
  }, [companyCode]);

  useEffect(() => {
    let alive = true;
    const done = (d) => alive && (setData(d), setChecking(false));
    const fail = (e) => alive && (setError(e?.message || ''), setChecking(false));
    (async () => {
      if (token) {
        try {
          const d = await customerApp.linkLogin(token);
          navigate('/c', { replace: true }); // 주소창에 고유값이 남지 않게
          return done(d);
        } catch (e) {
          navigate('/c', { replace: true });
          return fail(e);
        }
      }
      try {
        return done(await customerApp.me());
      } catch {
        const mem = readMem(companyCode);
        if (mem.auto && mem.name && mem.phone) {
          try {
            return done(await customerApp.login(companyCode, mem.name, mem.phone));
          } catch {
            /* 자동로그인 실패 → 입력 화면 */
          }
        }
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [companyCode, token]);

  const logout = async () => {
    await customerApp.logout().catch(() => {});
    const mem = readMem(companyCode);
    writeMem(companyCode, mem.saveName ? { saveName: true, name: mem.name } : null);
    setData(null);
  };

  const title = companyName || data?.company.name || '';
  if (checking) return <div className="page-loading">불러오는 중...</div>;
  return (
    <div className="cust-app">
      <header className="cust-head">
        <span className="logo-box">VB</span>
        <div>
          <strong>{title}</strong>
          <div>고객모바일</div>
        </div>
        {data && (
          <button type="button" className="btn-logout" onClick={logout}>
            로그아웃
          </button>
        )}
      </header>
      {data ? <MyContracts data={data} /> : <CustomerLogin companyCode={companyCode} notice={error} onLogin={setData} />}
      <footer className="cust-foot">ⓒ VerityBase. ALL RIGHTS RESERVED</footer>
    </div>
  );
}

function CustomerLogin({ companyCode, notice, onLogin }) {
  const mem = readMem(companyCode);
  const [name, setName] = useState(mem.saveName || mem.auto ? mem.name || '' : '');
  const [phone, setPhone] = useState('');
  const [saveName, setSaveName] = useState(!!mem.saveName);
  const [auto, setAuto] = useState(!!mem.auto);
  const [error, setError] = useState(notice);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await customerApp.login(companyCode, name, phone);
      writeMem(companyCode, auto ? { auto: true, saveName, name, phone } : saveName ? { saveName: true, name } : null);
      onLogin(d);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="cust-login" onSubmit={submit}>
      <input className="input-text" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
      <input
        className="input-text"
        placeholder="휴대폰번호"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(formatPhone(e.target.value))}
        autoComplete="tel"
        required
      />
      <div className="cust-checks">
        <label>
          <input type="checkbox" checked={saveName} onChange={(e) => setSaveName(e.target.checked)} /> 아이디저장
        </label>
        <label>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 자동로그인
        </label>
      </div>
      {error && <p className="login-error">{error}</p>}
      <button type="submit" className="btn-confirm big" disabled={busy}>
        {busy ? '확인 중...' : '로그인'}
      </button>
      <p className="sub-text">계약하신 분의 이름과 휴대폰번호로 확인합니다. 카카오 알림톡의 버튼을 누르면 입력 없이 바로 들어옵니다.</p>
    </form>
  );
}

const STEP_LABEL = (c) => (c.status === '취소' ? '취소' : c.status === '시공완료' ? '시공완료' : c.schedules.some((s) => s.assigneeName) ? '기사배정' : '접수');

function MyContracts({ data }) {
  if (!data.contracts.length) return <p className="no-data">확인할 계약이 없습니다.</p>;
  return (
    <div className="cust-body">
      <p className="cust-hello">
        <b>{data.customer.name}</b>님의 계약 {data.contracts.length}건
      </p>
      {data.contracts.map((c) => (
        <section key={c.id} className="cust-card">
          <div className="cust-card-top">
            <span className="status-chip st-blue">{c.category}{c.workType && c.workType !== '시공' ? ` · ${c.workType}` : ''}</span>
            <span className="sub-text">{c.brand} · 계약일 {c.contractDate}</span>
            <span className={`cust-step ${c.status === '취소' ? 'canceled' : c.status === '시공완료' ? 'done' : ''}`}>{STEP_LABEL(c)}</span>
          </div>
          <div className="bold-text">{c.address}</div>

          <table className="cust-table">
            <tbody>
              {c.schedules.map((s, i) => (
                <tr key={i}>
                  <th>{CIRCLED[i] || `${i + 1}`} 시공</th>
                  <td>
                    {s.date ? `${formatKoreanDate(s.date)} ${timeLabel(s) || ''}` : '일정 협의 중'}
                    {s.assigneeName && <div className="sub-text">담당 기사 {s.assigneeName}</div>}
                  </td>
                  <td className="nowrap">{s.done ? <span className="text-done">완료</span> : ''}</td>
                </tr>
              ))}
              <tr>
                <th>시공 내용</th>
                <td colSpan={2}>
                  {c.lineItems.map((l, i) => (
                    <div key={i}>
                      {l.name}
                      {l.qty > 1 && ` x${l.qty}`}
                    </div>
                  ))}
                  {c.items && <div className="pre-wrap sub-text">{c.items}</div>}
                </td>
              </tr>
              <tr>
                <th>계약금액</th>
                <td colSpan={2}>
                  <b>{won(c.amounts.actual)}원</b>
                  {c.amounts.discount > 0 && <span className="sub-text"> (할인 {won(c.amounts.discount)}원)</span>}
                </td>
              </tr>
              <tr>
                <th>결제</th>
                <td colSpan={2}>
                  {c.amounts.deposit > 0 && <div>계약금 {won(c.amounts.deposit)}원</div>}
                  <div className={c.amounts.balance > 0 ? 'text-red bold-text' : 'text-done'}>
                    {c.amounts.balance > 0 ? `남은 잔금 ${won(c.amounts.balance)}원` : '완납'}
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {c.customerNote && (
            <div className="doc-customer-note">
              <h4>안내사항</h4>
              <p className="pre-wrap">{c.customerNote}</p>
            </div>
          )}

          <div className="cust-actions">
            {c.esign.token ? (
              <a className={`btn-confirm ${c.esign.status === '서명완료' ? 'outline' : ''}`} href={`/sign/${c.esign.token}`}>
                {c.esign.status === '서명완료' ? '계약서 보기 (서명완료)' : '✍ 계약서 확인 · 서명하기'}
              </a>
            ) : (
              <span className="sub-text">계약서는 준비되면 알림톡으로 보내드립니다.</span>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
