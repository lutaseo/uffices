import React from 'react';
import { calcAmounts, itemsSummary, kindBreakdown, timeLabel } from '../utils/contract.js';
import { formatAddress, won } from '../utils/format.js';
import { ESIGN_STATUS } from '../constants.js';

const CIRCLED = ['①', '②', '③'];

const STATUS_CLASS = {
  미정: 'st-gray',
  해피콜완료: 'st-blue',
  배정: 'st-blue',
  시공완료: 'st-green',
  시공연기: 'st-orange',
  취소: 'st-red',
};

const APPROVAL_CLASS = { 승인: 'ap-ok', 승인대기: 'ap-wait', 미승인: 'ap-no' };

const ESIGN_CLASS = {
  [ESIGN_STATUS.NONE]: 'es-none',
  [ESIGN_STATUS.WAITING]: 'es-wait',
  [ESIGN_STATUS.SIGNED]: 'es-done',
};

// onOpen 이 있으면 줄에 마우스를 올렸을 때 강조되고, 누르면 계약 상세로 이동
export default function ContractTable({ contracts, selectedIds, onToggle, onToggleAll, showAmount, renderActions, onOpen }) {
  const allChecked = contracts.length > 0 && contracts.every((c) => selectedIds.has(c.id));
  const colCount = showAmount ? 13 : 11;

  return (
    <div className="contract-table-container">
      <table className="contract-table">
        <thead>
          <tr>
            <th>
              <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} />
            </th>
            <th>번호</th>
            <th>브랜드</th>
            <th>구분</th>
            <th>접수형태</th>
            <th>시공상태</th>
            <th>시공 등록</th>
            <th>시공담당</th>
            <th>계약자</th>
            <th>아파트명</th>
            {showAmount && (
              <>
                <th>계약금액</th>
                <th>입금 / 잔액</th>
              </>
            )}
            <th>관리</th>
          </tr>
        </thead>
        <tbody>
          {contracts.length === 0 && (
            <tr>
              <td colSpan={colCount} className="no-data">
                조건에 맞는 계약이 없습니다.
              </td>
            </tr>
          )}
          {contracts.map((item) => {
            const a = showAmount ? calcAmounts(item) : null;
            return (
              <tr
                key={item.id}
                className={onOpen ? 'clickable-row' : ''}
                onClick={onOpen ? () => onOpen(item) : undefined}
                title={onOpen ? '누르면 계약 상세로 이동합니다' : undefined}
              >
                <td data-label="선택" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggle(item.id)} />
                </td>
                <td data-label="번호" className="nowrap-cell">{item.no ?? '-'}</td>
                <td data-label="브랜드" className="nowrap-cell">{item.brand}</td>
                <td data-label="구분" className="nowrap-cell">
                  {item.category}
                  {item.workType && item.workType !== '시공' && <div className="sub-text">{item.workType}</div>}
                </td>
                <td data-label="접수형태" className="nowrap-cell">{item.receptionType}</td>
                <td data-label="시공상태">
                  <span className={`status-chip ${STATUS_CLASS[item.status] || ''}`}>{item.status}</span>
                </td>
                <td data-label="시공 등록" className="nowrap text-left">
                  {item.schedules.map((s, i) => (
                    <div key={i}>
                      {CIRCLED[i]} {s.date ? `${s.date} ${timeLabel(s)}`.trim() : '미정'}
                    </div>
                  ))}
                </td>
                <td data-label="시공담당" className="nowrap text-left">
                  {item.schedules.map((s, i) => (
                    <div key={i}>
                      {CIRCLED[i]} {s.assigneeName || '미배정'}
                      {s.mobileStatus && <span className="mobile-chip">{s.mobileStatus}</span>}
                    </div>
                  ))}
                </td>
                <td data-label="계약자" className="nowrap">
                  <div className="bold-text">
                    {item.customerName}{' '}
                    <span className={`approval ${APPROVAL_CLASS[item.approval] || ''}`}>({item.approval})</span>
                  </div>
                  <div className="sub-text">{item.customerPhone}</div>
                  <span className={`esign-chip ${ESIGN_CLASS[item.esign?.status] || ''}`}>{item.esign?.status}</span>
                </td>
                <td data-label="아파트명" className="text-left apt-cell">
                  <div>{formatAddress(item)}</div>
                  {itemsSummary(item) && <div className="sub-text ellipsis">{itemsSummary(item)}</div>}
                  <div className="sub-text">
                    계약일 {item.contractDate} · 작성 {item.ownerName}
                  </div>
                </td>
                {showAmount && (
                  <>
                    <td data-label="계약금액" className="text-right amount-cell">
                      <div className="amount-main nowrap">{won(a.actual)}원</div>
                      {(a.discount > 0 || a.voucher > 0) && (
                        <div className="sub-text kind-break">
                          총액 {won(a.total)}
                          {a.discount > 0 && ` · 할인 ${won(a.discount)}`}
                          {a.voucher > 0 && ` · 상품권 ${won(a.voucher)}`}
                        </div>
                      )}
                      {a.canceled > 0 && <div className="text-red sub-text">취소</div>}
                    </td>
                    <td data-label="입금 / 잔액" className="text-right amount-cell">
                      {/* 입금 합계 대신 항목별(계약금 50,000 · 잔금 …)만 — 항목이 없을 때만 '입금' 합계 */}
                      {kindBreakdown(a.byKind, won) ? (
                        <div className="sub-text kind-break">{kindBreakdown(a.byKind, won)}</div>
                      ) : (
                        a.paid > 0 && <div className="sub-text nowrap">입금 {won(a.paid)}</div>
                      )}
                      {a.refund > 0 && <div className="sub-text nowrap text-red">환불 {won(a.refund)}</div>}
                      <div className={`amount-main ${a.balance > 0 ? 'text-red' : 'text-done'}`}>
                        {a.balance > 0 ? `잔액 ${won(a.balance)}원` : a.balance < 0 ? `초과입금 ${won(-a.balance)}원` : a.canceled > 0 ? '취소' : '완납'}
                      </div>
                    </td>
                  </>
                )}
                <td data-label="관리" className="action-cell" onClick={(e) => e.stopPropagation()}>
                  {renderActions(item)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
