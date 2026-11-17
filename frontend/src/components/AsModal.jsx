import React, { useState } from 'react';
import PhotoPickButton from './CameraButton.jsx';
import { backdrop } from '../utils/backdrop.js';
import { today } from '../utils/date.js';
import { compressImage } from '../utils/image.js';
import { currentHasFeature } from '../constants.js';
import PhotoViewer from './PhotoViewer.jsx';

export const AS_PHOTOS_MAX = 10; // AS 한 회차 사진 최대 장수 (서버와 같음, 5장씩 나눠 보냄)
export const AS_PHOTOS_PER_SEND = 5;

// AS 접수 창 — 계약을 AS관리로 옮길 때 접수일·요청 내용을 받음
//   title: 대상 설명 (예: '줄눈 · 홍길동' 또는 '3건'), onSave({ date, request, photos, engineerId })
//   photos: 하자 부위 등 사진 (선택, 최대 10장)
//   engineers: 기사 목록 · defaultEngineerId: 시공등록①의 기사 (여러 건이면 undefined → 계약마다 자동)
//   engineerId: undefined = 계약마다 시공등록① 기사 자동, '' = 담당 없음, 숫자 = 그 기사
// AS 접수 보내기: 사진이 5장 넘으면 나머지는 이어서 (한 번 요청 용량 한도 때문)
export async function sendAs(api, ids, info) {
  const photos = info.photos || [];
  await api.setAs(ids, true, { ...info, photos: photos.slice(0, AS_PHOTOS_PER_SEND) });
  for (let i = AS_PHOTOS_PER_SEND; i < photos.length; i += AS_PHOTOS_PER_SEND) {
    for (const id of ids) await api.addAsPhotos(id, null, photos.slice(i, i + AS_PHOTOS_PER_SEND));
  }
}

export default function AsModal({ title, onSave, onClose, engineers = [], defaultEngineerId, bulk = false }) {
  const pickEngineer = currentHasFeature('asEngineer');
  const [engineerId, setEngineerId] = useState(bulk ? 'auto' : defaultEngineerId ? String(defaultEngineerId) : '');
  const [date, setDate] = useState(today());
  const [request, setRequest] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [view, setView] = useState(null);

  const pick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const room = AS_PHOTOS_MAX - photos.length;
    if (files.length > room) alert(`AS 사진은 ${AS_PHOTOS_MAX}장까지 올릴 수 있습니다. 앞의 ${Math.max(room, 0)}장만 추가합니다.`);
    try {
      const list = [];
      for (const f of files.slice(0, Math.max(room, 0))) list.push(await compressImage(f));
      setPhotos((x) => [...x, ...list]);
    } catch (err) {
      alert(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!request.trim()) return setError('AS 요청 내용을 적어 주세요.');
    setSaving(true);
    setError('');
    try {
      await onSave({ date, request: request.trim(), photos, ...(pickEngineer && engineerId !== 'auto' ? { engineerId: engineerId ? Number(engineerId) : '' } : {}) });
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
              {pickEngineer && (
                <tr>
                  <td className="label-col">AS 담당 기사</td>
                  <td className="input-col">
                    <select className="input-text" value={engineerId} onChange={(e) => setEngineerId(e.target.value)}>
                      {bulk && <option value="auto">계약마다 시공등록① 기사 (자동)</option>}
                      <option value="">담당 없음</option>
                      {engineers
                        .filter((e) => e.active !== false || String(e.id) === engineerId)
                        .map((e) => (
                          <option key={e.id} value={String(e.id)}>
                            {e.name}
                            {!bulk && String(e.id) === String(defaultEngineerId || '') ? ' (시공등록①)' : ''}
                          </option>
                        ))}
                    </select>
                    <div className="sub-text">담당 기사의 기사모바일에 'AS 발생' 알림이 뜨고, 기사가 AS 방문일을 등록합니다. 퇴사 등으로 다른 기사가 맡으면 바꿔 주세요.</div>
                  </td>
                </tr>
              )}
              <tr>
                <td className="label-col">사진 (선택)</td>
                <td className="input-col">
                  <span className="pay-photos">
                    {photos.map((img, i) => (
                      <span key={i} className="pay-thumb new">
                        <img src={img} alt="AS 사진" onClick={() => setView(i)} />
                        <button type="button" title="사진 빼기" onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))}>
                          ×
                        </button>
                      </span>
                    ))}
                    {photos.length < AS_PHOTOS_MAX && (
                      <PhotoPickButton title="하자 부위 등을 찍어서 올립니다 (여러 장 선택 가능)" onChange={pick}>
                        📷 사진 첨부
                      </PhotoPickButton>
                    )}
                  </span>
                  <div className="sub-text">하자 부위 사진 등 최대 {AS_PHOTOS_MAX}장</div>
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
        {view != null && <PhotoViewer images={photos} start={view} title="AS 사진" onClose={() => setView(null)} />}
      </div>
    </div>
  );
}
