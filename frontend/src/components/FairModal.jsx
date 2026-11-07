import React, { useEffect, useState } from 'react';
import { engineers as engineerApi, fairs as fairApi } from '../api/index.js';
import EngineerPicker from './EngineerPicker.jsx';
import { useAuth } from '../auth/AuthContext.jsx';
import { backdrop } from '../utils/backdrop.js';
import { today } from '../utils/date.js';

// 박람회 일정 등록 팝업 (계약관리 위 [박람회 일정 등록], 일정관리 달력의 박람회 [수정])
//   날짜(여러 날이면 끝나는 날짜도) · 박람회 이름 · 장소 · 가는 기사(검색해서 추가) → 일정관리 달력에 기사 이름이 초록색으로
//   fair: 고칠 박람회 (없으면 새로 등록), initialDate: 새로 등록할 때 처음 날짜, onSaved: 저장·삭제 뒤
//   오류는 창 안에 표시 (카카오톡 등 앱 안 브라우저는 alert 창을 막기도 함)
export default function FairModal({ fair = null, initialDate, onSaved, onClose }) {
  const { handleError } = useAuth();
  const [form, setForm] = useState({
    date: fair?.date || initialDate || today(),
    endDate: fair?.endDate || '',
    name: fair?.name || '',
    place: fair?.place || '',
    staffIds: fair?.staffIds || [], // 예전에 고른 실장 (지금은 기사만 고름 — 고쳐 저장해도 그대로 둠)
    engineerIds: fair?.engineerIds || [],
  });
  const [engineerList, setEngineerList] = useState([]);
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
    engineerApi
      .list()
      .then((list) => setEngineerList(list.filter((e) => e.active !== false)))
      .catch(() => {});
    loadUpcoming();
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const startEdit = (f) => {
    setEditing(f);
    setError('');
    setForm({ date: f.date, endDate: f.endDate || '', name: f.name || '', place: f.place || '', staffIds: f.staffIds || [], engineerIds: f.engineerIds || [] });
  };
  const startNew = () => {
    setEditing(null);
    setError('');
    setForm({ date: initialDate || today(), endDate: '', name: '', place: '', staffIds: [], engineerIds: [] });
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
    if (!window.confirm(`${f.date} ${f.label} 박람회 일정을 삭제하시겠습니까?`)) return;
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
                <td className="label-col">박람회 이름<span className="star">*</span></td>
                <td className="input-col">
                  <input
                    className="input-text full"
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    placeholder="예: 지제역 필해링턴"
                    maxLength={60}
                    autoFocus={!editing}
                  />
                </td>
              </tr>
              <tr>
                <td className="label-col">장소</td>
                <td className="input-col">
                  <input className="input-text full" value={form.place} onChange={(e) => set('place', e.target.value)} placeholder="예: 수원" maxLength={60} />
                </td>
              </tr>
              <tr>
                <td className="label-col">가는 기사<span className="star">*</span></td>
                <td className="input-col">
                  {/* 이름(또는 전화번호 뒷자리)으로 검색해서 고르면 아래 목록에 쌓임 */}
                  <EngineerPicker
                    key={form.engineerIds.join(',')}
                    value=""
                    engineers={engineerList.filter((e) => !form.engineerIds.includes(e.id))}
                    onChange={(id) => id && set('engineerIds', [...form.engineerIds, Number(id)])}
                    placeholder="기사 이름 검색해서 추가"
                  />
                  {form.engineerIds.length > 0 && (
                    <ul className="fair-picked">
                      {form.engineerIds.map((id) => (
                        <li key={id}>
                          <span className="fair-name">{engineerList.find((e) => e.id === id)?.name || '(사용 안 하는 기사)'}</span>
                          <button type="button" className="btn-link text-red" onClick={() => set('engineerIds', form.engineerIds.filter((x) => x !== id))}>
                            빼기
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="sub-text">고른 기사 이름이 일정관리 달력에 초록색으로 표시되고, 그 기사의 기사모바일에는 <b>본인이 포함된 박람회만</b> 보입니다.</div>
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
                <span className="fair-place">{f.label}</span>
                <span className="fair-names">{[...f.staff, ...(f.engineers || [])].map((s) => s.name).join(', ')}</span>
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
