import React, { useState } from 'react';
import { contracts as contractApi } from '../api/index.js';
import PhotoViewer from './PhotoViewer.jsx';

// 계약 목록의 [📄 실물 n장] — 누르면 상세로 넘어가지 않고 그 자리에서 사진을 크게 봄
export default function PaperChip({ contract }) {
  const [images, setImages] = useState(null);
  const [loading, setLoading] = useState(false);
  if (!(contract.paperPhotoCount > 0)) return null;

  const open = async (e) => {
    e.stopPropagation();
    setLoading(true);
    try {
      setImages((await contractApi.paperPhotos(contract.id)).map((r) => r.image));
    } catch (err) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button type="button" className="paper-chip" onClick={open} disabled={loading} title="실물 계약서 사진 보기">
        📄 {loading ? '…' : `실물 ${contract.paperPhotoCount}장`}
      </button>
      {images && (
        <span onClick={(e) => e.stopPropagation()}>
          <PhotoViewer images={images} title={`${contract.customerName} 실물 계약서`} onClose={() => setImages(null)} />
        </span>
      )}
    </>
  );
}
