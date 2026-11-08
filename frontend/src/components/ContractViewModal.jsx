import React, { useEffect, useState } from 'react';
import { contracts as contractApi } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ESIGN_STATUS } from '../constants.js';
import ContractDocument from './ContractDocument.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import KakaoModal from './KakaoModal.jsx';
import OnSiteSign from './OnSiteSign.jsx';
import { backdrop } from '../utils/backdrop.js';

// 계약서 보기 + 전자서명 요청
export default function ContractViewModal({ contractId, onClose, onChanged }) {
  const { company, can, handleError } = useAuth();
  const [list, setList] = useState(null); // 고객에게 한 장으로 가는 계약들 (줄눈·청소 등)
  const [signUrl, setSignUrl] = useState('');
  const [kakaoOpen, setKakaoOpen] = useState(false);
  const [signHere, setSignHere] = useState(false); // [지금 이 기기에서 서명받기]

  const load = () =>
    contractApi.signBundle(Number(contractId)).then((b) => {
      setList(b.contracts);
      setSignUrl(b.token ? `${location.origin}/sign/${b.token}` : '');
    });

  useEffect(() => {
    load().catch((e) => {
      handleError(e);
      onClose();
    });
  }, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  const requestSign = async () => {
    try {
      await contractApi.requestSign(contractId);
      await load();
      onChanged?.();
    } catch (e) {
      handleError(e);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(signUrl);
      alert('서명 링크가 복사되었습니다.');
    } catch {
      prompt('아래 링크를 복사해 주세요.', signUrl);
    }
  };

  if (!list) return null;
  // 이 기기에서 서명받는 동안에는 계약서 보기 창을 숨기고 서명 화면만 (끝나면 다시 계약서 보기)
  if (signHere) {
    return (
      <OnSiteSign
        ids={list.map((c) => c.id)}
        first={signUrl ? { token: signUrl.split('/sign/')[1], ids: list.map((c) => c.id) } : null}
        onClose={async () => {
          setSignHere(false);
          await load().catch(() => {});
          onChanged?.();
        }}
      />
    );
  }
  const contract = list.find((c) => c.id === Number(contractId)) || list[0];
  const status = contract.esign?.status;
  const together = list.length > 1 ? list.map((c) => c.category).join('·') : '';

  return (
    <>
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="customer-reg-modal wide printable" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top-bar no-print">
          <h3>&gt; 계약서 보기 — {status}</h3>
          <button type="button" className="modal-close-x" onClick={onClose}>
            &times;
          </button>
        </div>

        <ErrorBoundary title="계약서를 보여 주는 중 오류가 났습니다." onClose={onClose}>
          <ContractDocument contract={contract} contracts={list} company={company} />
        </ErrorBoundary>

        {/* 서명 전: 이 기기(태블릿 등)에서 바로 서명받기 — 등록 때 서명을 건너뛰었거나 고친 뒤 다시 띄운 경우 */}
        {(can('esign.send') || can('contract.create')) && !contract.readOnly && status !== ESIGN_STATUS.SIGNED && !contract.deletedAt && (
          <div className="sign-here-box no-print">
            <button type="button" className="btn-confirm big" onClick={() => setSignHere(true)}>
              ✍ 지금 이 기기에서 서명받기{together && ` (${together} 한 장으로)`}
            </button>
            <span className="sub-text">고객이 이 화면에서 바로 확인하고 서명합니다. 서명이 끝나면 계약완료 알림톡을 보낼 수 있습니다.</span>
          </div>
        )}

        {can('esign.send') && !contract.readOnly && status !== ESIGN_STATUS.SIGNED && (
          <div className="esign-box no-print">
            {signUrl ? (
              <>
                <p>고객 서명 링크 (고객이 이 링크에서 계약서를 확인하고 서명합니다{together && ` — ${together} 한 장으로 한 번에 서명`})</p>
                <div className="inline-fields">
                  <input className="input-text full" readOnly value={signUrl} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn-dark-sm" onClick={copy}>링크 복사</button>
                  <a className="btn-dark-sm" href={signUrl} target="_blank" rel="noreferrer">열기</a>
                  <button type="button" className="btn-kakao-talk" onClick={() => setKakaoOpen(true)}>알림톡으로 보내기</button>
                </div>
              </>
            ) : (
              <button type="button" className="btn-confirm" onClick={requestSign}>
                ✍ 고객 전자서명 요청하기{together && ` (${together} 한 장으로)`}
              </button>
            )}
          </div>
        )}

        <div className="form-bottom-btns no-print">
          <button type="button" className="btn-dark-lg" onClick={() => window.print()}>인쇄 / PDF 저장</button>
          <button type="button" className="btn-dark-lg cancel" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>

    {kakaoOpen && (
      <KakaoModal contract={contract} initialTemplate="서명요청" signUrl={signUrl} onClose={() => setKakaoOpen(false)} />
    )}
    </>
  );
}
