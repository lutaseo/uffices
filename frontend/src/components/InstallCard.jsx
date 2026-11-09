import React, { useState } from 'react';
import { appUrl, deviceType, useInstall } from '../utils/install.js';

// 내 정보(일반 화면·상담실장)·기사모바일 휴무 설정 탭 아래: 이 화면을 앱으로 설치 / 브라우저처럼 열리는 바로가기 주소
//   app: 'staff' | 'manager' | 'engineer' — 그 화면만 설치됨 (다른 화면 주소는 보여 주지 않음)
const LABEL = { staff: '일반 화면', manager: '상담실장 화면', engineer: '기사모바일' };

export default function InstallCard({ code, app }) {
  const { canPrompt, installed, standalone, prompt } = useInstall();
  const [copied, setCopied] = useState(false);
  const device = deviceType();
  if (!code) return null;
  const webUrl = appUrl(code, app, true);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(webUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('아래 주소를 복사해 주세요.', webUrl);
    }
  };

  return (
    <div className="install-card">
      <h3 className="section-title">앱 설치 · 바로가기</h3>
      {standalone ? (
        <p className="install-ok">✔ 지금 {LABEL[app]}을(를) 앱으로 쓰고 계십니다.</p>
      ) : installed ? (
        <p className="install-ok">✔ 설치되었습니다. 바탕화면(홈 화면)의 VerityBase 아이콘으로 여세요.</p>
      ) : (
        <>
          <p className="sub-text">설치하면 바탕화면·작업표시줄(휴대폰은 홈 화면)에 아이콘이 생기고, 누르면 주소창 없는 <b>앱 창</b>으로 {LABEL[app]}이 열립니다.</p>
          {canPrompt ? (
            <button type="button" className="btn-install" onClick={prompt}>
              📲 {LABEL[app]} 앱으로 설치하기
            </button>
          ) : (
            <div className="install-howto">
              {device === 'ios' && <>사파리 아래쪽 <b>공유 버튼</b>(네모에 위쪽 화살표) → <b>홈 화면에 추가</b>를 누르세요.</>}
              {device === 'samsung' && <>아래쪽 <b>메뉴(≡)</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 누르세요.</>}
              {device === 'android' && <>오른쪽 위 <b>메뉴(⋮)</b> → <b>앱 설치</b>(또는 홈 화면에 추가)를 누르세요.</>}
              {device === 'pc' && <>크롬·엣지 주소창 오른쪽의 <b>설치 아이콘</b>(⊕ 또는 화면 모양)이나, 오른쪽 위 메뉴(⋮) → <b>앱 설치</b>(엣지: 앱 → 이 사이트를 앱으로 설치)를 누르세요.</>}
            </div>
          )}
        </>
      )}
      <details className="install-web">
        <summary>앱 창 말고 <b>브라우저처럼</b> 열리는 바로가기를 원하시면</summary>
        <ol>
          <li>
            아래 주소를 복사해 브라우저에서 엽니다. <code>{webUrl}</code>{' '}
            <button type="button" className="btn-link" onClick={copy}>{copied ? '복사됨' : '주소 복사'}</button>
          </li>
          <li>
            그 화면에서 바로가기를 만듭니다.{' '}
            {device === 'pc'
              ? '크롬: 메뉴(⋮) → 저장 및 공유 → 바로가기 만들기 ( "창으로 열기"는 끄기 )'
              : device === 'ios'
                ? '사파리: 공유 버튼 → 홈 화면에 추가'
                : '메뉴 → 홈 화면에 추가 (설치 대신 바로가기 만들기를 고르세요)'}
          </li>
        </ol>
        <p className="sub-text">이 바로가기는 지금처럼 브라우저 안(주소창 있는 화면)에서 열립니다.</p>
      </details>
    </div>
  );
}
