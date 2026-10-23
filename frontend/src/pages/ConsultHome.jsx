import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { navigateForward } from '../router.js';
import { ESIGN_STATUS } from '../constants.js';
import { cachedContractRows, fetchContractRows } from './ContractPage.jsx';

// 상담홈 — /업체주소/t (상담실장)로 로그인했을 때 첫 화면. 태블릿에서 손가락으로 쓰기 좋게
//   [+ 계약 등록] · 고객 찾기(이름·전화·아파트) · 계약 카드 → 누르면 계약 상세, [상담내역]은 상담내역 탭으로 바로
//   목록은 계약관리와 같은 기억을 씀 (서버에는 바뀐 게 있는지만 물어봐 트래픽 절약)
const SHOW_MAX = 40;
const ESIGN_CLASS = { [ESIGN_STATUS.NONE]: 'es-none', [ESIGN_STATUS.WAITING]: 'es-wait', [ESIGN_STATUS.SIGNED]: 'es-done' };

export default function ConsultHome() {
  const { user, can, handleError } = useAuth();
  const [rows, setRows] = useState(() => cachedContractRows(user.id));
  const [q, setQ] = useState('');
  const [mine, setMine] = useState(true);
  const [waitingOnly, setWaitingOnly] = useState(false);

  useEffect(() => {
    fetchContractRows(user.id).then(setRows).catch(handleError);
  }, [user.id, handleError]);

  const myCount = useMemo(() => (rows || []).filter((c) => c.ownerId === user.id).length, [rows, user.id]);
  const list = useMemo(() => {
    const text = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (rows || [])
      .filter((c) => !mine || c.ownerId === user.id)
      .filter((c) => !waitingOnly || c.esign?.status === ESIGN_STATUS.WAITING)
      .filter((c) => {
        if (!text) return true;
        const hay = [c.customerName, c.aptName, c.dong && `${c.dong}동`, c.ho && `${c.ho}호`].filter(Boolean).join(' ').toLowerCase();
        if (hay.includes(text)) return true;
        return digits.length >= 3 && [c.customerPhone, c.customerPhone2].some((p) => String(p || '').replace(/\D/g, '').includes(digits));
      })
      .sort((a, b) => b.id - a.id);
  }, [rows, q, mine, waitingOnly, user.id]);

  const open = (c, tab) => navigateForward(`/contracts/${c.id}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`);
  const stop = (fn) => (e) => {
    e.stopPropagation();
    fn();
  };

  return (
    <div className="page-card consult-home">
      <div className="consult-top">
        <h2>상담홈</h2>
        {can('contract.create') && (
          <button type="button" className="consult-new" onClick={() => navigateForward('/contracts/new')}>
            + 계약 등록
          </button>
        )}
      </div>

      <input className="consult-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="고객 찾기 — 이름 · 전화번호 · 아파트" />

      <div className="consult-filters">
        <button type="button" className={mine ? 'on' : ''} onClick={() => setMine(true)}>
          내 계약 {rows ? myCount : ''}
        </button>
        <button type="button" className={!mine ? 'on' : ''} onClick={() => setMine(false)}>
          전체 {rows ? rows.length : ''}
        </button>
        <button type="button" className={waitingOnly ? 'on' : ''} onClick={() => setWaitingOnly((v) => !v)}>
          서명대기만
        </button>
      </div>

      {!rows && <p className="no-data">불러오는 중...</p>}
      {rows && list.length === 0 && (
        <p className="no-data">{mine && !q && !waitingOnly ? '내가 담당한 계약이 없습니다. [전체]를 눌러 보세요.' : '찾는 계약이 없습니다.'}</p>
      )}

      <div className="consult-cards">
        {list.slice(0, SHOW_MAX).map((c) => (
          <div key={c.id} className="consult-card" role="button" tabIndex={0} onClick={() => open(c)} onKeyDown={(e) => e.key === 'Enter' && open(c)}>
            <div className="consult-card-head">
              <b>{c.customerName}</b>
              {c.category && <span className="consult-chip">{c.category}</span>}
              {c.esign?.status && <span className={`esign-chip ${ESIGN_CLASS[c.esign.status] || ''}`}>{c.esign.status}</span>}
            </div>
            <div className="consult-card-site">{[c.aptName, c.dong && `${c.dong}동`, c.ho && `${c.ho}호`].filter(Boolean).join(' ') || '현장 미입력'}</div>
            <div className="sub-text">
              {[c.brand, c.contractDate && `계약일 ${c.contractDate}`, c.status, !mine && c.ownerName && `담당 ${c.ownerName}`].filter(Boolean).join(' · ')}
            </div>
            <div className="consult-card-actions">
              {c.customerPhone && (
                <a href={`tel:${String(c.customerPhone).replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}>
                  📞 {c.customerPhone}
                </a>
              )}
              <button type="button" onClick={stop(() => open(c, '상담내역'))}>
                💬 상담내역
              </button>
            </div>
          </div>
        ))}
      </div>
      {list.length > SHOW_MAX && <p className="sub-text consult-more">최근 {SHOW_MAX}건만 보여 줍니다. 이름·전화번호로 찾아 주세요. (전체 목록은 [계약관리])</p>}
    </div>
  );
}
