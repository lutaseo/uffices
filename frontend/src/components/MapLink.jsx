import React from 'react';
import { currentHasFeature } from '../constants.js';

// [지도] 버튼: 현장 이름(아파트·주소)으로 카카오맵을 엶 — 휴대폰은 카카오맵 앱, 없으면 웹 지도 (비용·키 없음)
//   name: 아파트 이름 또는 도로명 주소 (동·호는 빼야 검색이 잘 됨)
export default function MapLink({ name }) {
  const q = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim(); // 끝의 (동네, 건물명) 덧붙임은 빼고 검색
  if (!q || !currentHasFeature('addressMap')) return null;
  return (
    <a className="btn-map" href={`https://map.kakao.com/link/search/${encodeURIComponent(q)}`} target="_blank" rel="noreferrer" title="카카오맵에서 위치 · 길찾기">
      🗺 지도
    </a>
  );
}
