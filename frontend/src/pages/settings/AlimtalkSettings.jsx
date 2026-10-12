import React, { useEffect, useState } from 'react';
import { notifications } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatPhone } from '../../utils/format.js';
import { ALIMTALK_TEMPLATES } from '../../utils/alimtalk.js';

// 운영자(super) > 알림톡연결: 비즈고 연결 확인 + 업체·브랜드별 템플릿 코드 + 승인된 템플릿으로 시험 발송
//   API Key 는 Vercel 환경변수(BIZGO_API_KEY)에만 — 이 화면에서는 보이지도 입력받지도 않음
const PRESETS = {
  togisa_start01: { label: '기사 작업배정 (예전 승인 템플릿)', words: { 시공일: '2026-10-20', 시간: '09:00', 주소: '시험아파트 101-1001' } },
};

export default function AlimtalkSettings() {
  const { handleError } = useAuth();
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [form, setForm] = useState({ to: '', templateCode: 'togisa_start01', channel: '', senderKey: '', words: PRESETS.togisa_start01.words });
  const [newWord, setNewWord] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [lastKey, setLastKey] = useState(''); // 마지막 시험 발송 메시지 키 → 도착 결과 확인
  const [report, setReport] = useState(null);
  const [checkingReport, setCheckingReport] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [brandCfg, setBrandCfg] = useState(null); // { 더좋은집: { channel, senderKey, codes: {…} }, … }
  const [savingCfg, setSavingCfg] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      const s = await notifications.gatewayStatus();
      setStatus(s);
      if (!brandCfg && s.companies?.length) pickCompany(s.companies[0].id, s);
      if (s.senders?.length && !form.channel) setForm((f) => ({ ...f, channel: s.senders[0].channelId || s.senders[0].channelName }));
    } catch (e) {
      handleError(e);
    } finally {
      setChecking(false);
    }
  };
  // 업체를 고르면 그 업체의 브랜드별 설정을 불러옴
  const pickCompany = (id, s = status) => {
    const comp = s?.companies?.find((c) => c.id === Number(id));
    setCompanyId(comp ? comp.id : '');
    if (!comp) return setBrandCfg(null);
    const names = comp.brandList?.length ? comp.brandList : Object.keys(comp.brands || {});
    const cfgOf = (b) => comp.brands?.[b] || {};
    setBrandCfg(Object.fromEntries(names.map((b) => [b, { channel: cfgOf(b).channel || '', senderKey: cfgOf(b).senderKey || '', codes: { ...(cfgOf(b).codes || {}) } }])));
  };
  useEffect(() => {
    check();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (e) => {
    e.preventDefault();
    if (!window.confirm(`${form.to} 번호로 실제 알림톡을 보냅니다. (요금 발생)\n계속할까요?`)) return;
    setSending(true);
    setResult(null);
    setReport(null);
    setLastKey('');
    try {
      const r = await notifications.testSend({ to: form.to, templateCode: form.templateCode, replaceWords: form.words, channel: form.channel, senderKey: form.senderKey });
      setResult({ ok: true, text: `비즈고가 접수했습니다.${r.msgKey ? ` (메시지 키 ${r.msgKey})` : ''} 접수는 '도착'이 아닙니다 — 잠시 뒤 아래 [도착 결과 확인]을 눌러 주세요.` });
      setLastKey(r.msgKey || '');
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setSending(false);
    }
  };

  const checkReport = async () => {
    setCheckingReport(true);
    try {
      setReport(await notifications.testResult(lastKey.split(',')[0]));
    } catch (err) {
      setReport({ error: err.message });
    } finally {
      setCheckingReport(false);
    }
  };

  const saveCfg = async () => {
    setSavingCfg(true);
    try {
      const saved = await notifications.saveAlimtalkSettings({ companyId, brands: brandCfg });
      setStatus((st) => ({ ...st, companies: st.companies.map((c) => (c.id === companyId ? { ...c, brands: saved.brands } : c)) }));
      alert('저장되었습니다. 이제 이 업체의 계약·일정 화면 알림톡 버튼이 이 코드로 실제 발송됩니다.');
    } catch (e) {
      handleError(e);
    } finally {
      setSavingCfg(false);
    }
  };
  const setCfg = (b, patch) => setBrandCfg((c) => ({ ...c, [b]: { ...c[b], ...patch } }));

  const setWord = (k, v) => setForm((f) => ({ ...f, words: { ...f.words, [k]: v } }));
  const removeWord = (k) => setForm((f) => ({ ...f, words: Object.fromEntries(Object.entries(f.words).filter(([x]) => x !== k)) }));

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>알림톡연결</h2>
        <ul className="notice-list">
          <li>운영자 전용 화면입니다. 비즈고(카카오 알림톡) 연결 상태를 확인하고, 업체별 템플릿 코드를 넣고, 시험 발송합니다.</li>
          <li>비즈고 API Key 는 Vercel 환경변수 <b>BIZGO_API_KEY</b> 에만 넣습니다. (이 화면·채팅에 쓰지 마세요)</li>
          <li>시험 발송은 실제로 발송되며 비즈고 요금이 나갑니다.</li>
        </ul>
      </div>

      <h3 className="section-title">1. 연결 상태</h3>
      <div className="gw-status">
        {!status ? (
          <p className="sub-text">확인 중...</p>
        ) : (
          <>
            <p>
              API Key: {status.configured ? <b className="text-done">등록됨</b> : <b className="text-red">없음</b>}
              {status.mode === 'demo' && <span className="sub-text"> (데모 모드)</span>}
            </p>
            {status.error && <p className="text-red">⚠ {status.error}</p>}
            {status.senders?.length > 0 && (
              <table className="customer-table gw-senders">
                <thead>
                  <tr>
                    <th>카카오톡 채널</th>
                    <th>채널 아이디</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {status.senders.map((s) => (
                    <tr key={s.senderKey || s.channelId}>
                      <td>{s.channelName || '-'}</td>
                      <td>{s.channelId || '-'}</td>
                      <td>{[s.status, s.profileStatus].filter(Boolean).join(' / ') || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {status.configured && !status.error && !status.senders?.length && <p className="sub-text">연결은 됐지만 등록된 카카오톡 채널이 없습니다.</p>}
          </>
        )}
        <button type="button" className="btn-dark-sm" onClick={check} disabled={checking}>
          {checking ? '확인 중...' : '다시 확인'}
        </button>
      </div>

      <h3 className="section-title">2. 템플릿 코드 (업체·브랜드별)</h3>
      {status?.companies?.length > 0 && (
        <p>
          업체{' '}
          <select className="input-text gw-company" value={companyId} onChange={(e) => pickCompany(e.target.value)}>
            {status.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </p>
      )}
      <p className="sub-text">비즈고에서 <b>승인된</b> 템플릿 코드를 넣어 주세요. 코드가 있는 알림톡만 계약·일정 화면에서 실제로 발송됩니다. (검수 중인 코드는 승인 후 넣기)</p>
      {brandCfg && (
        <div className="gw-brands">
          {Object.entries(brandCfg).map(([b, cfg]) => (
            <div key={b} className="gw-brand">
              <h4>{b}</h4>
              <table className="form-grid-table">
                <tbody>
                  <tr>
                    <td className="label-col">카카오톡 채널</td>
                    <td className="input-col">
                      {status?.senders?.length ? (
                        <select className="input-text" value={cfg.channel} onChange={(e) => setCfg(b, { channel: e.target.value })}>
                          <option value="">선택하세요</option>
                          {status.senders.map((x) => (
                            <option key={x.senderKey || x.channelId} value={x.channelId || x.channelName}>
                              {x.channelName} {x.channelId}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input className="input-text" value={cfg.channel} onChange={(e) => setCfg(b, { channel: e.target.value.trim() })} placeholder="@채널아이디" />
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="label-col">발신프로필 키</td>
                    <td className="input-col">
                      <input className="input-text" value={cfg.senderKey} onChange={(e) => setCfg(b, { senderKey: e.target.value.trim() })} placeholder="채널 목록이 안 나올 때만 (비즈고 > 카카오 발신프로필 관리에서 복사)" />
                      {cfg.senderKey && !/^[0-9A-Za-z]{30,}$/.test(cfg.senderKey) && <p className="text-red">발신프로필 키 형식이 아닙니다 (보통 40자리 영문·숫자).</p>}
                    </td>
                  </tr>
                  {Object.entries(ALIMTALK_TEMPLATES).map(([k, t]) => (
                    <tr key={k}>
                      <td className="label-col">{t.label}</td>
                      <td className="input-col">
                        <input className="input-text" value={cfg.codes[k] || ''} onChange={(e) => setCfg(b, { codes: { ...cfg.codes, [k]: e.target.value.trim() } })} placeholder="템플릿 코드" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <div className="form-bottom-btns">
        <button type="button" className="btn-dark-lg" onClick={saveCfg} disabled={savingCfg || !brandCfg || !companyId}>
          {savingCfg ? '저장 중...' : '템플릿 코드 저장'}
        </button>
      </div>

      <h3 className="section-title">3. 시험 발송</h3>
      <form onSubmit={send}>
        <table className="form-grid-table narrow-table">
          <tbody>
            <tr>
              <td className="label-col">받는 번호</td>
              <td className="input-col">
                <input className="input-text" value={form.to} onChange={(e) => setForm({ ...form, to: formatPhone(e.target.value) })} placeholder="010-0000-0000" required />
              </td>
            </tr>
            <tr>
              <td className="label-col">템플릿 코드</td>
              <td className="input-col">
                <input className="input-text" value={form.templateCode} onChange={(e) => setForm({ ...form, templateCode: e.target.value.trim() })} required />
                {PRESETS[form.templateCode] && <span className="sub-text"> {PRESETS[form.templateCode].label}</span>}
              </td>
            </tr>
            {status?.senders?.length > 1 && (
              <tr>
                <td className="label-col">보낼 채널</td>
                <td className="input-col">
                  <select className="input-text" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                    {status.senders.map((s) => (
                      <option key={s.senderKey || s.channelId} value={s.channelId || s.channelName}>{s.channelName} {s.channelId}</option>
                    ))}
                  </select>
                </td>
              </tr>
            )}
            <tr>
              <td className="label-col">발신프로필 키</td>
              <td className="input-col">
                <input className="input-text" value={form.senderKey} onChange={(e) => setForm({ ...form, senderKey: e.target.value.trim() })} placeholder="채널 목록이 안 나오면 여기에 직접 (비워 두면 자동)" />
                {form.senderKey && !/^[0-9A-Za-z]{30,}$/.test(form.senderKey) && <p className="text-red">템플릿 코드가 아닙니다. 비즈고 카카오 발신프로필 관리 화면의 긴 영문·숫자 키(보통 40자리)를 넣어 주세요.</p>}
              </td>
            </tr>
            <tr>
              <td className="label-col">빈칸 값</td>
              <td className="input-col">
                {Object.entries(form.words).map(([k, v]) => (
                  <div key={k} className="inline-fields gw-word">
                    <span className="gw-word-key">#{'{'}{k}{'}'}</span>
                    <input className="input-text" value={v} onChange={(e) => setWord(k, e.target.value)} />
                    <button type="button" className="btn-text-danger" onClick={() => removeWord(k)}>빼기</button>
                  </div>
                ))}
                <div className="inline-fields gw-word">
                  <input className="input-text" value={newWord} onChange={(e) => setNewWord(e.target.value)} placeholder="빈칸 이름 (예: 고객명)" />
                  <button
                    type="button"
                    className="btn-dark-sm"
                    onClick={() => {
                      const k = newWord.replace(/[#{}\s]/g, '');
                      if (k) setWord(k, '');
                      setNewWord('');
                    }}
                  >
                    + 빈칸 추가
                  </button>
                </div>
                <p className="sub-text">템플릿 문구의 #{'{'}이름{'}'} 칸에 들어갈 값입니다. 문구·버튼은 비즈고에 승인된 그대로 나갑니다.</p>
              </td>
            </tr>
          </tbody>
        </table>
        {result && <p className={result.ok ? 'text-done bold-text' : 'text-red bold-text'}>{result.ok ? '✅ ' : '⚠ '}{result.text}</p>}
        {lastKey && (
          <div className="gw-report">
            <button type="button" className="btn-dark-sm" onClick={checkReport} disabled={checkingReport}>
              {checkingReport ? '확인 중...' : '도착 결과 확인'}
            </button>
            {report?.error && <p className="text-red">⚠ {report.error}</p>}
            {Array.isArray(report) && !report.length && <p className="sub-text">아직 결과가 없습니다. 10초~1분 뒤 다시 눌러 주세요.</p>}
            {Array.isArray(report) &&
              report.map((x, i) => (
                <p key={i} className={x.ok ? 'text-done bold-text' : 'text-red bold-text'}>
                  {x.ok ? '✅ 카카오톡 도착 성공' : `⚠ 실패 [${x.reportCode}] ${x.reportText || ''}`}
                  <span className="sub-text"> {x.reportTime}</span>
                </p>
              ))}
          </div>
        )}
        <div className="form-bottom-btns">
          <button type="submit" className="btn-dark-lg" disabled={sending || !status?.configured}>
            {sending ? '보내는 중...' : '시험 발송'}
          </button>
        </div>
      </form>
    </div>
  );
}
