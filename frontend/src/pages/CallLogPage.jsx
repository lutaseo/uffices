import React, { useCallback, useEffect, useState } from 'react';
import { callLogs } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import PhoneInput from '../components/PhoneInput.jsx';

// 상담내역 (상단 메뉴): 전화번호별 통화 메모
//   위: 전화번호 검색 (가운데 4자리·뒷자리 4자리 등 아무 자리나, 이름·메모 글자도 가능)
//   가운데: 통화내역 입력 (전화번호 · 이름 · 메모)
//   아래 (줄 아래): 작성된 상담내역 — 검색어에 맞는 것만
const emptyForm = () => ({ phone: '', name: '', memo: '' });
const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

export default function CallLogPage() {
  const { handleError } = useAuth();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback((query) => callLogs.list({ q: query }).then(setRows).catch(handleError), [handleError]);
  // 글자를 칠 때마다 바로 찾기 (조금 기다렸다가)
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await callLogs.save(form);
      setForm(emptyForm());
      await load(q);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`${r.phone} 상담내역을 삭제할까요?`)) return;
    try {
      await callLogs.remove(r.id);
      if (form.id === r.id) setForm(emptyForm());
      await load(q);
    } catch (err) {
      handleError(err);
    }
  };

  return (
    <div className="page-card call-log-page">
      <h2>상담내역</h2>

      <div className="call-search">
        <input
          className="input-text"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 전화번호 검색 (가운데 4자리 또는 뒷자리 4자리) · 이름 · 메모"
          inputMode="search"
        />
        {q && (
          <button type="button" className="btn-dark-sm" onClick={() => setQ('')}>
            지우기
          </button>
        )}
      </div>

      <form className="call-form" onSubmit={submit}>
        <div className="call-form-row">
          <label>
            <span>전화번호</span>
            <PhoneInput value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} required />
          </label>
          <label>
            <span>이름 (선택)</span>
            <input className="input-text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="고객 이름" />
          </label>
        </div>
        <label className="call-memo">
          <span>통화 메모</span>
          <textarea
            className="input-text full"
            rows={3}
            value={form.memo}
            onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
            placeholder="통화 내용 (예: 줄눈 견적 문의, 다음 주 화요일 다시 연락)"
            required
          />
        </label>
        <div className="call-form-actions">
          <button type="submit" className="btn-dark-lg sm" disabled={saving}>
            {form.id ? '수정 저장' : '+ 통화내역 입력'}
          </button>
          {form.id && (
            <button type="button" className="btn-dark-lg sm cancel" onClick={() => setForm(emptyForm())}>
              취소
            </button>
          )}
        </div>
      </form>

      <hr className="call-divider" />

      <div className="call-list-head">
        {q ? `'${q}' 검색 결과 ${rows.length}건` : `최근 상담내역 ${rows.length}건`}
      </div>
      {rows.length === 0 && <p className="no-data">{q ? '검색어에 맞는 상담내역이 없습니다.' : '아직 작성된 상담내역이 없습니다.'}</p>}
      <ul className="call-list">
        {rows.map((r) => (
          <li key={r.id} className={form.id === r.id ? 'editing' : ''}>
            <div className="call-item-head">
              <strong>{r.phone}</strong>
              {r.name && <span>{r.name}</span>}
              <span className="sub-text">
                {when(r.createdAt)}
                {r.writerName ? ` · ${r.writerName}` : ''}
                {r.updatedAt ? ' · 수정됨' : ''}
              </span>
              <span className="call-item-btns">
                <button type="button" className="btn-link" onClick={() => setForm({ id: r.id, phone: r.phone, name: r.name || '', memo: r.memo })}>
                  수정
                </button>
                <button type="button" className="btn-text-danger" onClick={() => remove(r)}>
                  삭제
                </button>
              </span>
            </div>
            <div className="call-item-memo">{r.memo}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
