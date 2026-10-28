import { useEffect } from 'react';

// 브라우저 탭 이름 · 휴대폰 '홈 화면에 추가' 이름을 화면마다 다르게
//   title: 탭에 보이는 이름 (예: '계약관리 · 더좋은집 VerityBase')
//   short: 홈 화면 아이콘 아래 이름 (예: '더좋은집 기사') — 없으면 'VerityBase'
export function usePageTitle(title, short) {
  useEffect(() => {
    if (!title) return;
    document.title = title;
    const meta = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (meta) meta.setAttribute('content', short || 'VerityBase');
  }, [title, short]);
}
