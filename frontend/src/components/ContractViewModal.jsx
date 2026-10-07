import React, { useEffect, useState } from 'react';
import { contracts as contractApi } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ESIGN_STATUS } from '../constants.js';
import ContractDocument from './ContractDocument.jsx';
import KakaoModal from './KakaoModal.jsx';
import { backdrop } from '../utils/backdrop.js';

// 계약서 보기 + 전자서명 요청
export default function ContractViewModal({ contractId, onClose, onChanged }) {
  const { company, can, handleError } = useAuth();
  const [list, setList] = useState(null); // 고객에게 한 장으로 가는 계약들 (줄눈·청소 등)
  const [signUrl, setSignUrl] = useState('');
  const [kakaoOpen, setKakaoOpen] = useState(false);

  const load = () =>
    contractApi.signBundle(contractId).then((b) => {
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

        <ContractDocument contract={contract} contracts={list} company={company} />

        {can('esign.send') && status !== ESIGN_STATUS.SIGNED && (
          <div className="esign-box no-print">
            {signUrl ? (
              <>
                <p>고객 서명 링크 (고객이 이 링크에서 계약서를 확인하고 서명합니다{together && ` — ${together} 한 장으로 한 번에 서명`})</p>
                <div className="inline-fields">
                  <input className="input-text full" readOnly value={signUrl} onFocus={(e) => e.target.select()} />
                  <button type="button" className="btn-dark-sm" onClick={copy}>링크 복사</button>
                  <a className="btn-dark-sm" href={signUrl} target="_blank" rel="noreferrer">열기</a>
                  {can('notify.send') && (
                    <button type="button" className="btn-kakao-talk" onClick={() => setKakaoOpen(true)}>알림톡으로 보내기</button>
                  )}
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
