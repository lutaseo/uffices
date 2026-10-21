import React, { useEffect, useRef, useState } from 'react';
import { backdrop } from '../utils/backdrop.js';

// 사진 크게 보기 — 여러 장이면 좌우로 넘김 (PC: 화살표 버튼·키보드 ←→, 휴대폰: 옆으로 밀기)
//   images: [data URL 또는 주소], start: 처음 보여줄 번호
export default function PhotoViewer({ images, start = 0, title = '사진', onClose }) {
  const [i, setI] = useState(start);
  const touch = useRef(null);
  const n = images.length;
  const go = (d) => setI((x) => (x + d + n) % n);

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!n) return null;
  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div
        className="customer-reg-modal receipt-modal photo-viewer"
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null || n < 2) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
          touch.current = null;
        }}
      >
        <div className="photo-viewer-head">
          <b>{title}</b>
          {n > 1 && <span className="sub-text"> {i + 1} / {n}</span>}
        </div>
        <div className="photo-viewer-body">
          {n > 1 && (
            <button type="button" className="photo-nav prev" onClick={() => go(-1)} aria-label="이전 사진">
              ‹
            </button>
          )}
          <img className="receipt-full" src={images[i]} alt={`${title} ${i + 1}`} />
          {n > 1 && (
            <button type="button" className="photo-nav next" onClick={() => go(1)} aria-label="다음 사진">
              ›
            </button>
          )}
        </div>
        <div className="form-bottom-btns">
          <a className="btn-dark-lg sm" href={images[i]} download={`${title}-${i + 1}.jpg`}>
            내려받기
          </a>
          <button type="button" className="btn-dark-lg sm cancel" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
