import React, { useState } from 'react';
import { contracts as contractApi } from '../api/index.js';
import { compressImage } from '../utils/image.js';
import PhotoViewer from './PhotoViewer.jsx';

export const PAPER_MAX = 10; // 계약 1건당 실물 계약서 사진 최대 장수 (서버와 같음)

// 실물(종이) 계약서 사진: [📄 저장된 사진 n장] [작은 사진들] [+ 실물 계약서 사진]
//   value = { saved: null | [{id, image}], add: [data URL], remove: [id] }
//     saved 는 [사진 n장]을 누를 때만 불러옴 (트래픽 절약), add/remove 는 계약 저장 뒤 올라감
//   savedCount: 이미 저장된 장수 (계약의 paperPhotoCount)
//   readOnly: 계약 상세 — 보기만
export default function PaperPhotos({ contractId, savedCount = 0, value, onChange, readOnly = false }) {
  const v = value || { saved: null, add: [], remove: [] };
  const [view, setView] = useState(null);
  const [loading, setLoading] = useState(false);
  const saved = (v.saved || []).filter((r) => !v.remove.includes(r.id));
  const storedCount = v.saved ? saved.length : Math.max(0, savedCount - v.remove.length);
  const total = storedCount + v.add.length;

  const loadSaved = async () => {
    setLoading(true);
    try {
      onChange({ ...v, saved: await contractApi.paperPhotos(contractId) });
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
    const room = PAPER_MAX - total;
    if (files.length > room) alert(`실물 계약서 사진은 계약 1건당 ${PAPER_MAX}장까지 올릴 수 있습니다. 앞의 ${Math.max(room, 0)}장만 추가합니다.`);
    try {
      const list = [];
      // 손글씨가 읽히도록 영수증보다 크게 (긴 변 2000px)
      for (const f of files.slice(0, Math.max(room, 0))) list.push(await compressImage(f, { maxSize: 2000, quality: 0.85 }));
      onChange({ ...v, add: [...v.add, ...list] });
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <span className="pay-photos paper-photos">
      {savedCount > 0 && !v.saved && (
        <button type="button" className="btn-receipt" disabled={loading} onClick={loadSaved} title="저장된 실물 계약서 사진 보기">
          📄 {loading ? '불러오는 중' : `실물 계약서 ${storedCount}장`}
        </button>
      )}
      {saved.map((r) => (
        <span key={`s${r.id}`} className="pay-thumb">
          <img src={r.image} alt="실물 계약서 사진" onClick={() => setView(saved.indexOf(r))} />
          {!readOnly && (
            <button type="button" title="사진 삭제" onClick={() => onChange({ ...v, remove: [...v.remove, r.id] })}>
              ×
            </button>
          )}
        </span>
      ))}
      {v.add.map((img, i) => (
        <span key={`a${i}`} className="pay-thumb new">
          <img src={img} alt="새 실물 계약서 사진" onClick={() => setView(saved.length + i)} />
          <button type="button" title="사진 빼기" onClick={() => onChange({ ...v, add: v.add.filter((_, j) => j !== i) })}>
            ×
          </button>
        </span>
      ))}
      {!readOnly && total < PAPER_MAX && (
        <label className="btn-pay-photo" title="종이에 쓴 계약서를 찍어서 올립니다 (여러 장 선택 가능)">
          📷 실물 계약서 사진
          <input type="file" accept="image/*" multiple onChange={pick} hidden />
        </label>
      )}
      {view != null && <PhotoViewer images={[...saved.map((r) => r.image), ...v.add]} start={view} title="실물 계약서" onClose={() => setView(null)} />}
    </span>
  );
}
