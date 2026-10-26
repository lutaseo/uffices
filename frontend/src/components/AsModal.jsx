import React, { useState } from 'react';
import { backdrop } from '../utils/backdrop.js';
import { today } from '../utils/date.js';

// AS 접수 창 — 계약을 AS관리로 옮길 때 접수일·요청 내용을 받음
//   title: 대상 설명 (예: '줄눈 · 홍길동' 또는 '3건'), onSave({ date, request })
export default function AsModal({ title, onSave, onClose }) {
  const [date, setDate] = useState(today());
  const [request, setRequest] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!request.trim()) return setError('AS 요청 내용을 적어 주세요.');
    setSaving(true);
    setError('');
    try {
      await onSave({ date, request: request.trim() });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="customer-reg-modal discount-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top-bar">
          <h3>&gt; AS 접수 — {title}</h3>
          <button type="button" className="modal-close-x" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit} className="reg-table-form">
          <table className="form-grid-table">
            <tbody>
              <tr>
                <td className="label-col">접수일</td>
                <td className="input-col">
                  <input type="date" className="input-text" value={date} onChange={(e) => setDate(e.target.value)} required />
                </td>
              </tr>
              <tr>
                <td className="label-col">AS 요청 내용</td>
                <td className="input-col">
                  <textarea
                    className="input-text full"
                    rows={4}
                    value={request}
                    onChange={(e) => setRequest(e.target.value)}
                    placeholder="예: 안방 욕실 바닥 줄눈 들뜸, 현관 쪽 변색"
                    maxLength={500}
                    autoFocus
                  />
                </td>
              </tr>
            </tbody>
          </table>
          {error && <p className="off-error">{error}</p>}
          <div className="form-bottom-btns">
            <button type="submit" className="btn-dark-lg sm" disabled={saving}>{saving ? '옮기는 중...' : 'AS관리로 옮기기'}</button>
            <button type="button" className="btn-dark-lg sm cancel" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
