import React from 'react';

// [📷 사진 찍기] — 카메라를 바로 엶 (capture="environment": 뒤쪽 카메라)
//   네이버 웨일(휴대폰·태블릿)은 사진 칸을 누르면 카메라 선택 없이 앨범만 열어서, 웨일에서만 찍기 버튼을 따로 둠
//   다른 브라우저(크롬·사파리·삼성인터넷 등)는 원래대로 한 버튼에서 '사진 찍기/앨범'을 고를 수 있어 그대로
//   웨일이 아니거나 PC(마우스)면 이 버튼은 안 보이고, 옆의 원래 버튼 글자도 그대로
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
const TOUCH = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
export const NEED_CAMERA_BUTTON = /Whale/i.test(UA) && TOUCH;

// 앨범 버튼 글자: 웨일(휴대폰·태블릿)이면 '앨범', 그 외는 원래 글자
export const albumLabel = (pcText, touchText = '🖼 앨범에서 선택') => (NEED_CAMERA_BUTTON ? touchText : pcText);

export default function CameraButton({ className = 'btn-pay-photo', label = '📷 사진 찍기', onChange, disabled = false }) {
  if (!NEED_CAMERA_BUTTON) return null;
  return (
    <label className={className} title="카메라로 바로 찍어서 올립니다">
      {label}
      <input type="file" accept="image/*" capture="environment" onChange={onChange} hidden disabled={disabled} />
    </label>
  );
}
