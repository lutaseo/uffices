import React, { useState } from 'react';
import PhotoPickButton from './CameraButton.jsx';
import { contracts as contractApi } from '../api/index.js';
import { compressImage } from '../utils/image.js';
import { backdrop } from '../utils/backdrop.js';

export const MAX_PHOTOS = 5; // 입금 1건당 영수증 사진 최대 장수 (서버와 같음)

// 계약 수정 화면 입금 줄의 영수증 사진: [📎 저장된 사진] [작은 사진들] [+ 사진]
//   payment._saved   : 불러온 저장 사진 [{id, image}] (누르기 전에는 불러오지 않음 — 트래픽 절약)
//   payment._add     : 새로 고른 사진(data URL) — 계약 저장 후 올라감
//   payment._remove  : 지울 저장 사진 번호
export default function PaymentPhotos({ contractId, payment, onChange }) {
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(false);
  const saved = (payment._saved || []).filter((r) => !(payment._remove || []).includes(r.id));
  const added = payment._add || [];
  const savedCount = payment._saved ? saved.length : Math.max(0, (payment.receiptCount || (payment.hasReceipt ? 1 : 0)) - (payment._remove || []).length);
  const total = savedCount + added.length;

  const loadSaved = async () => {
    setLoading(true);
    try {
      const r = await contractApi.receipt(contractId, payment.id);
      onChange({ _saved: r.images || [{ id: null, image: r.image }] });
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const pick = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - total;
    if (files.length > room) alert(`영수증 사진은 입금 1건당 ${MAX_PHOTOS}장까지 첨부할 수 있습니다. 앞의 ${Math.max(room, 0)}장만 추가합니다.`);
    try {
      const list = [];
      for (const f of files.slice(0, Math.max(room, 0))) list.push(await compressImage(f));
      onChange({ _add: [...added, ...list] });
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <span className="pay-photos">
      {payment.hasReceipt && !payment._saved && (
        <button type="button" className="btn-receipt" disabled={loading} onClick={loadSaved} title="저장된 영수증 사진 보기·삭제">
          📎 {loading ? '불러오는 중' : `사진 ${savedCount}장`}
        </button>
      )}
      {saved.map((r) => (
        <span key={`s${r.id}`} className="pay-thumb">
          <img src={r.image} alt="영수증 사진" onClick={() => setView(r.image)} />
          <button type="button" title="사진 삭제" onClick={() => onChange({ _remove: [...(payment._remove || []), r.id] })}>×</button>
        </span>
      ))}
      {added.map((img, i) => (
        <span key={`a${i}`} className="pay-thumb new">
          <img src={img} alt="새 영수증 사진" onClick={() => setView(img)} />
          <button type="button" title="사진 빼기" onClick={() => onChange({ _add: added.filter((_, j) => j !== i) })}>×</button>
        </span>
      ))}
      {total < MAX_PHOTOS && (
        <PhotoPickButton title="영수증 사진 추가 (여러 장 선택 가능)" onChange={pick}>
          + 사진
        </PhotoPickButton>
      )}
      {view && (
        <div className="modal-overlay" {...backdrop(() => setView(null))}>
          <div className="customer-reg-modal receipt-modal" onMouseDown={(e) => e.stopPropagation()}>
            <img className="receipt-full" src={view} alt="영수증 사진" />
            <div className="form-bottom-btns">
              <button type="button" className="btn-dark-lg sm cancel" onClick={() => setView(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </span>
  );
}
