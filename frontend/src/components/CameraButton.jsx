import React, { useState } from 'react';

// 사진 고르기 버튼 (입금 영수증·AS 사진·실물 계약서 공통)
//   네이버 웨일(휴대폰·태블릿)은 사진 칸을 누르면 카메라 선택 없이 앨범만 열려서,
//   웨일에서는 버튼을 누르면 [📷 사진 찍기 / 🖼 앨범에서 선택] 팝업을 띄움 (사진 찍기 = capture: 카메라 바로 열기)
//   다른 브라우저(크롬·사파리·삼성인터넷 등)·PC는 원래대로 바로 고르는 창이 열림 (거기서 찍기/앨범 선택 가능)
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
const TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
export const NEED_CAMERA_CHOICE = /Whale/i.test(UA) && TOUCH;

// className·title: 버튼 모양, children: 버튼 글자, multiple: 앨범에서 여러 장, onChange(e): input 의 onChange 그대로
export default function PhotoPickButton({ className = 'btn-pay-photo', title, children, onChange, multiple = true, disabled = false }) {
  const [open, setOpen] = useState(false);

  if (!NEED_CAMERA_CHOICE) {
    return (
      <label className={className} title={title}>
        {children}
        <input type="file" accept="image/*" multiple={multiple} onChange={onChange} hidden disabled={disabled} />
      </label>
    );
  }

  const picked = (e) => {
    setOpen(false);
    onChange?.(e);
  };
  return (
    <>
      <button type="button" className={className} title={title} disabled={disabled} onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && (
        <div className="photo-choice-overlay" onClick={() => setOpen(false)}>
          <div className="photo-choice" onClick={(e) => e.stopPropagation()}>
            <label className="photo-choice-btn">
              📷 사진 찍기
              <input type="file" accept="image/*" capture="environment" onChange={picked} hidden />
            </label>
            <label className="photo-choice-btn">
              🖼 앨범에서 선택
              <input type="file" accept="image/*" multiple={multiple} onChange={picked} hidden />
            </label>
            <button type="button" className="photo-choice-cancel" onClick={() => setOpen(false)}>
              취소
            </button>
          </div>
        </div>
      )}
    </>
  );
}
