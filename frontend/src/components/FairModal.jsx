import React, { useEffect, useState } from 'react';
import { fairs as fairApi, users as userApi } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { backdrop } from '../utils/backdrop.js';
import { today } from '../utils/date.js';
import { ROLES } from '../auth/permissions.js';

// 박람회 일정 등록 팝업 (계약관리 위 [박람회 일정 등록], 일정관리 달력의 박람회 [수정])
//   날짜(여러 날이면 끝나는 날짜도) · 장소 · 가는 실장 → 일정관리 달력에 실장 이름이 초록색으로
//   fair: 고칠 박람회 (없으면 새로 등록), initialDate: 새로 등록할 때 처음 날짜, onSaved: 저장·삭제 뒤
//   오류는 창 안에 표시 (카카오톡 등 앱 안 브라우저는 alert 창을 막기도 함)
export default function FairModal({ fair = null, initialDate, onSaved, onClose }) {
  const { user, handleError } = useAuth();
  const [form, setForm] = useState({
    date: fair?.date || initialDate || today(),
    endDate: fair?.endDate || '',
    place: fair?.place || '',
    staffIds: fair?.staffIds || (user.role === ROLES.MANAGER ? [user.id] : []),
  });
  const [staff, setStaff] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [editing, setEditing] = useState(fair);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const loadUpcoming = () =>
    fairApi
      .list({ from: today() })
      .then(setUpcoming)
      .catch(() => {});
  useEffect(() => {
    userApi
      .staffOptions()
      .then((list) => setStaff(list.filter((u) => u.role !== ROLES.ENGINEER)))
      .catch(() => {});
    loadUpcoming();
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStaff = (id) => set('staffIds', form.staffIds.includes(id) ? form.staffIds.filter((x) => x !== id) : [...form.staffIds, id]);
  const startEdit = (f) => {
    setEditing(f);
    setError('');
    setForm({ date: f.date, endDate: f.endDate || '', place: f.place, staffIds: f.staffIds || [] });
  };
  const startNew = () => {
    setEditing(null);
    setError('');
    setForm({ date: initialDate || today(), endDate: '', place: '', staffIds: user.role === ROLES.MANAGER ? [user.id] : [] });
  };

  const run = async (fn) => {
    setSaving(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (e?.code === 'UNAUTHORIZED') handleError(e);
      else setError(e?.message || '처리 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  const save = (e) => {
    e.preventDefault();
    run(async () => {
      await fairApi.save({ ...form, id: editing?.id });
      onSaved?.();
      onClose();
    });
  };

  const remove = (f) => {
    if (!window.confirm(`${f.date} ${f.place} 박람회 일정을 삭제하시겠습니까?`)) return;
    run(async () => {
      await fairApi.remove(f.id);
      if (editing?.id === f.id) startNew();
      await loadUpcoming();
      onSaved?.();
    });
  };

  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="customer-reg-modal discount-modal fair-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top-bar">
          <h3>&gt; 박람회 일정 {editing ? '수정' : '등록'}</h3>
          <button type="button" className="modal-close-x" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={save} className="reg-table-form">
          <table className="form-grid-table">
            <tbody>
              <tr>
                <td className="label-col">날짜<span className="star">*</span></td>
                <td className="input-col inline-fields">
                  <input type="date" className="input-text" value={form.date} onChange={(e) => set('date', e.target.value)} required />
                  <span>~</span>
                  <input type="date" className="input-text" value={form.endDate} min={form.date} onChange={(e) => set('endDate', e.target.value)} />
                  <span className="sub-text">하루면 끝나는 날짜는 비워 두세요</span>
                </td>
              </tr>
              <tr>
                <td className="label-col">장소<span className="star">*</span></td>
                <td className="input-col">
                  <input
                    className="input-text full"
                    value={form.place}
                    onChange={(e) => set('place', e.target.value)}
                    placeholder="예: 지제역 필해링턴 - 장소 수원"
                    maxLength={100}
                    autoFocus={!editing}
                  />
                </td>
              </tr>
              <tr>
                <td className="label-col">가는 실장<span className="star">*</span></td>
                <td className="input-col">
                  <div className="fair-staff">
                    {staff.map((u) => (
                      <label key={u.id} className={`fair-staff-chip ${form.staffIds.includes(u.id) ? 'on' : ''}`}>
                        <input type="checkbox" checked={form.staffIds.includes(u.id)} onChange={() => toggleStaff(u.id)} /> {u.name}
                      </label>
                    ))}
                  </div>
                  <div className="sub-text">일정관리 달력에 고른 실장 이름이 초록색으로 표시됩니다.</div>
                </td>
              </tr>
            </tbody>
          </table>
          {error && <p className="off-error">{error}</p>}
          <div className="form-bottom-btns">
            <button type="submit" className="btn-dark-lg sm" disabled={saving}>{saving ? '저장 중...' : editing ? '수정 저장' : '박람회 일정 등록'}</button>
            {editing && (
              <button type="button" className="btn-dark-lg sm cancel" onClick={startNew}>새로 등록하기</button>
            )}
            <button type="button" className="btn-dark-lg sm cancel" onClick={onClose}>닫기</button>
          </div>
        </form>

        {upcoming.length > 0 && (
          <div className="fair-upcoming">
            <h4>등록된 박람회 일정 (오늘부터)</h4>
            {upcoming.map((f) => (
              <div key={f.id} className={`fair-row ${editing?.id === f.id ? 'editing' : ''}`}>
                <span className="fair-date">{f.endDate ? `${f.date} ~ ${f.endDate}` : f.date}</span>
                <span className="fair-place">{f.place}</span>
                <span className="fair-names">{f.staff.map((s) => s.name).join(', ')}</span>
                <span className="fair-actions">
                  <button type="button" className="btn-link" onClick={() => startEdit(f)}>수정</button>
                  <button type="button" className="btn-link text-red" onClick={() => remove(f)}>삭제</button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
