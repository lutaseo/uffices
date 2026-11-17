import React, { useState } from 'react';
import { appUrl, deviceType, isStandalone, useInstall } from '../utils/install.js';
import { currentHasFeature } from '../constants.js';

// 내 정보(일반 화면·상담실장)·기사모바일 휴무 설정 탭 아래: 이 화면을 앱으로 설치 / 브라우저처럼 열리는 바로가기 주소
//   app: 'staff' | 'manager' | 'engineer' — 그 화면만 설치됨 (다른 화면 주소는 보여 주지 않음)
const LABEL = { staff: '일반 화면', manager: '상담실장 화면', engineer: '기사모바일' };

// 설치 방법 (설치 버튼이 안 뜨는 브라우저)
function HowTo({ device }) {
  return (
    <div className="install-howto">
      {device === 'ios' && <>사파리 아래쪽 <b>공유 버튼</b>(네모에 위쪽 화살표) → <b>홈 화면에 추가</b>를 누르세요.</>}
      {device === 'samsung' && <>아래쪽 <b>메뉴(≡)</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>을 누르세요.</>}
      {device === 'android' && <>오른쪽 위 <b>메뉴(⋮)</b> → <b>앱 설치</b>(또는 홈 화면에 추가)를 누르세요.</>}
      {device === 'pc' && <>크롬·엣지 주소창 오른쪽의 <b>설치 아이콘</b>(⊕ 또는 화면 모양)이나, 오른쪽 위 메뉴(⋮) → <b>앱 설치</b>(엣지: 앱 → 이 사이트를 앱으로 설치)를 누르세요.</>}
    </div>
  );
}

// 다른 화면(상담실장·기사모바일) 앱 설치 — 설치 화면을 새 창으로 열거나, 그 주소를 복사해 휴대폰으로 보냄
//   한 화면에서는 그 화면 앱만 설치할 수 있어서(브라우저 규칙), 설치 전용 화면(?install=1)을 따로 엶
function OtherApps({ code, app }) {
  const [copied, setCopied] = useState('');
  const others = ['staff', 'manager', 'engineer'].filter((a) => a !== app && (a !== 'manager' || currentHasFeature('manager')));
  if (!currentHasFeature('installOthers') || !others.length) return null;
  const inApp = isStandalone(); // 설치한 앱 창 안: 새 창을 열어도 그 앱 창으로 열려 다른 앱을 설치할 수 없음
  const copy = async (a) => {
    const url = `${appUrl(code, a)}?install=1`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(a);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      window.prompt('아래 주소를 복사해 주세요.', url);
    }
  };
  return (
    <div className="install-others">
      {inApp ? (
        <p className="sub-text">지금은 <b>앱 창</b>이라 여기서는 다른 앱을 설치할 수 없습니다. <b>[주소 복사]</b> 후 크롬(아이폰은 사파리) 주소창에 붙여 넣어 열면 설치 버튼이 나옵니다.</p>
      ) : (
        <p className="sub-text">다른 화면도 앱으로 설치할 수 있습니다. <b>[설치 화면 열기]</b>를 누르면 새 창에서 설치 버튼이 나옵니다. 기사님 휴대폰처럼 다른 기기라면 <b>주소를 복사해 카톡으로 보내</b> 그 기기에서 여세요.</p>
      )}
      {others.map((a) => (
        <div key={a} className="install-other-row">
          <b>{LABEL[a]}</b>
          {!inApp && <a className="btn-install sm" href={`${appUrl(code, a)}?install=1`} target="_blank" rel="noreferrer">설치 화면 열기</a>}
          <button type="button" className="btn-link" onClick={() => copy(a)}>{copied === a ? '복사됨' : '주소 복사'}</button>
        </div>
      ))}
    </div>
  );
}

// 설치 전용 화면: /업체/t?install=1 · /업체/m?install=1 · /업체?install=1 — 로그인 없이 그 화면 앱 설치
export function InstallScreen({ code, app }) {
  const { canPrompt, installed, standalone, prompt } = useInstall();
  const device = deviceType();
  const [copied, setCopied] = useState(false);
  const url = `${appUrl(code, app)}?install=1`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('아래 주소를 복사해 주세요.', url);
    }
  };
  return (
    <div className="login-bg">
      <div className="install-screen">
        <h1>VerityBase {LABEL[app]}</h1>
        {installed ? (
          <p className="install-ok">✔ 설치되었습니다. 바탕화면(홈 화면)의 VerityBase {LABEL[app]} 아이콘으로 여세요.</p>
        ) : standalone ? (
          // 이미 설치한 다른 VerityBase 앱 창 안에서 열림 → 여기서는 설치할 수 없음 (설치된 것처럼 보이던 문제)
          <>
            <p>지금 <b>이미 설치된 다른 VerityBase 앱 창</b> 안에서 열렸습니다. 여기서는 {LABEL[app]} 앱을 설치할 수 없어요.</p>
            <p>아래 주소를 복사해 <b>크롬(아이폰은 사파리) 주소창</b>에 붙여 넣어 열면 설치 버튼이 나옵니다.</p>
            <button type="button" className="btn-install" onClick={copy}>{copied ? '복사됨 ✔' : '설치 주소 복사'}</button>
          </>
        ) : canPrompt ? (
          <>
            <p>아래 버튼을 누르면 바탕화면(휴대폰은 홈 화면)에 아이콘이 생깁니다.</p>
            <button type="button" className="btn-install" onClick={prompt}>📲 {LABEL[app]} 앱으로 설치하기</button>
          </>
        ) : (
          <>
            <p>이 브라우저에서는 아래 순서로 설치해 주세요. (설치 버튼이 잠시 뒤에 나타날 수도 있습니다)</p>
            <HowTo device={device} />
            {device !== 'ios' && (
              // 크롬 규칙: 같은 주소(veritybase.vercel.app)의 VerityBase 앱이 이미 설치돼 있으면 다른 화면 앱의 설치 버튼을 막음 (시험으로 확인)
              <p className="install-note">
                <b>설치 아이콘도 안 보이나요?</b> 이 기기에 VerityBase의 <b>다른 앱(예: 일반 화면)이 이미 설치</b>되어 있으면 크롬이 설치 버튼을 막습니다.{' '}
                {device === 'pc'
                  ? <>그럴 땐 크롬 오른쪽 위 메뉴(⋮) → <b>전송, 저장, 공유</b> → <b>페이지를 앱으로 설치</b>(또는 바로가기 만들기 → '창으로 열기' 체크)를 누르세요. 이름은 '{LABEL[app]}'처럼 바꿔 두면 구분하기 쉽습니다.</>
                  : <>그럴 땐 메뉴 → <b>홈 화면에 추가</b>에서 <b>바로가기 만들기</b>를 고르세요.</>}
              </p>
            )}
          </>
        )}
        <a className="install-screen-go" href={appUrl(code, app)}>설치하지 않고 바로 열기 →</a>
      </div>
    </div>
  );
}

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
            <HowTo device={device} />
          )}
        </>
      )}
      {app !== 'engineer' && <OtherApps code={code} app={app} />}
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
