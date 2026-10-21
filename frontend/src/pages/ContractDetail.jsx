import React, { useCallback, useEffect, useState } from 'react';
import { contracts as contractApi } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { BRANDS, CATEGORIES } from '../constants.js';

const TALK_BRAND_ORDER = ['더스타트', '더좋은집'];
import { calcAmounts, isRefund, kindBreakdown, sumAmounts, timeLabel } from '../utils/contract.js';
import { formatAddress, won } from '../utils/format.js';
import KakaoModal from '../components/KakaoModal.jsx';
import PaymentModal from '../components/PaymentModal.jsx';
import DiscountModal from '../components/DiscountModal.jsx';
import { backdrop } from '../utils/backdrop.js';
import ContractViewModal from '../components/ContractViewModal.jsx';
import { PAPER_MAX } from '../components/PaperPhotos.jsx';
import PhotoViewer from '../components/PhotoViewer.jsx';
import { compressImage } from '../utils/image.js';

const CIRCLED = ['①', '②', '③'];
const TABS = ['계약정보', '계약자', '시공관리', '상담내역'];

const siteText = (c) =>
  [c.aptName, c.dong && `${c.dong}동`, c.ho && `${c.ho}호`, c.aptType && `타입 : ${c.aptType}`, c.area && `평 : ${c.area}`]
    .filter(Boolean)
    .join(' ');

const scheduleLine = (s) => (s?.date ? `${s.date}(${timeLabel(s) || '무관'})` : '');

// 계약 상세: 같은 계약자·같은 현장의 시공들을 한 화면에서 관리
//   onEdit(contract)          시공 수정 (계약서 작성 화면)
//   onNewWork(contract)       같은 현장에 시공 추가
//   onOpenGroup(contractId)   다른 현장 계약으로 이동 (계약자 탭)
export default function ContractDetail({ contractId, onBack, onEdit, onNewWork, onOpenGroup }) {
  const { company, can, handleError } = useAuth();
  const showAmount = can('contract.amount');
  const brands = company?.brands?.length ? company.brands : BRANDS;
  // 알림톡 버튼: 왼쪽 계약완료 / 오른쪽 기사배정, 위 더스타트 / 아래 더좋은집 (신화홈케어 등 다른 브랜드는 제외)
  const talkBrands = TALK_BRAND_ORDER.filter((b) => brands.includes(b)).length ? TALK_BRAND_ORDER.filter((b) => brands.includes(b)) : brands;
  const [tab, setTab] = useState('시공관리');
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(contractId);
  const [payTargetId, setPayTargetId] = useState(null);
  const [paymentModal, setPaymentModal] = useState(null); // { contract, payment? }
  const [discountTarget, setDiscountTarget] = useState(null);
  const [receiptView, setReceiptView] = useState(null); // { images: [{id, image}], title }
  const [kakao, setKakao] = useState(null); // { contract, template, brand }
  const [viewId, setViewId] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [noteTarget, setNoteTarget] = useState(contractId);

  const load = useCallback(async () => {
    try {
      const d = await contractApi.group(contractId);
      setData(d);
      setSelectedId((prev) => (d.contracts.some((c) => c.id === prev) ? prev : d.selectedId));
      setPayTargetId((prev) => (d.contracts.some((c) => c.id === prev) ? prev : d.selectedId));
    } catch (e) {
      handleError(e);
      onBack();
    }
  }, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return <div className="page-card page-loading">불러오는 중...</div>;

  const list = data.contracts;
  const selected = list.find((c) => c.id === selectedId) || list[0];
  const head = selected;
  const a = calcAmounts(selected);

  const run = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) alert(okMsg);
      await load();
    } catch (e) {
      handleError(e);
    }
  };

  const removeWork = (c) => {
    if (!window.confirm(`[${c.category}] 시공(No.${c.no})을 휴지통으로 이동하시겠습니까?`)) return;
    run(async () => {
      await contractApi.moveToTrash([c.id]);
      if (list.length === 1) onBack();
    });
  };

  const savePayment = async (form) => {
    const { contract, payment } = paymentModal;
    try {
      if (payment) await contractApi.updatePayment(contract.id, payment.id, form);
      else await contractApi.addPayment(contract.id, form);
      setPaymentModal(null);
      await load();
    } catch (e) {
      handleError(e);
    }
  };

  // 할인 적용: 오류는 창 안에 표시되도록 그대로 던짐
  const saveDiscount = async (form) => {
    await contractApi.setDiscount(discountTarget.id, form);
    setDiscountTarget(null);
    await load();
  };

  const openReceipt = async (contract, p) => {
    try {
      const r = await contractApi.receipt(contract.id, p.id);
      setReceiptView({ images: r.images || [{ id: 0, image: r.image }], title: `${p.date} ${contract.category} ${p.kind} ${won(p.amount)}원 (${p.method})` });
    } catch (e) {
      handleError(e);
    }
  };

  const removePayment = (contract, p) => {
    if (!window.confirm(`${p.date} ${p.kind} ${won(p.amount)}원 입금 내역을 삭제하시겠습니까?`)) return;
    run(() => contractApi.removePayment(contract.id, p.id));
  };

  const payments = list
    .flatMap((c) => (c.payments || []).map((p) => ({ ...p, contract: c })))
    .sort((x, y) => y.date.localeCompare(x.date) || (y.createdAt || '').localeCompare(x.createdAt || ''));

  const progress = list.flatMap((c) =>
    c.schedules
      .map((s, i) => ({ c, s, i }))
      .filter(({ s }) => s.mobileStatus || (c.status === '시공완료' && s.date)),
  );

  // ---------------- 탭별 화면 ----------------
  const basicInfo = (
    <>
      <h3 className="form-section-title">&gt; 계약정보</h3>
      <table className="info-grid">
        <tbody>
          <tr>
            <th>고객명</th>
            <td>{head.customerName}</td>
            <th>전화번호</th>
            <td>
              {head.customerPhone}
              {head.customerPhone2 && <div className="sub-text">{head.customerPhone2}</div>}
            </td>
            <th>브랜드</th>
            <td>{head.brand}</td>
          </tr>
          <tr>
            <th>계약일</th>
            <td>{head.contractDate}</td>
            <th>계약담당</th>
            <td>{head.ownerName}</td>
            <th>현장</th>
            <td>{siteText(head)}</td>
          </tr>
          <tr>
            <th>입주예정일</th>
            <td>{head.moveInDate}</td>
            <th>세금계산서</th>
            <td>{head.taxInvoice}</td>
            <th>현금영수증</th>
            <td>{head.cashReceipt}</td>
          </tr>
          <tr>
            <th>계약승인</th>
            <td>{head.approval}</td>
            <th>기타사항</th>
            <td colSpan={3} className="pre-wrap">{head.memo}</td>
          </tr>
          <tr>
            <th>고객 참고사항</th>
            <td colSpan={5} className="pre-wrap">
              {selected.customerNote}
              {selected.customerNote && <span className="sub-text"> (계약서에 고객에게 표시됨)</span>}
            </td>
          </tr>
          <tr>
            <th>실물 계약서</th>
            <td colSpan={5}>
              <PaperPanel key={`${selected.id}:${selected.paperPhotoCount || 0}`} contract={selected} canEdit={can('contract.edit') && !selected.deletedAt} onChanged={load} />
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );

  const workInfo = (
    <>
      <h3 className="form-section-title">&gt; 시공정보 — No.{selected.no ?? '-'} {selected.category}</h3>
      <table className="info-grid">
        <tbody>
          <tr>
            <th>구분</th>
            <td>
              {selected.category}({selected.receptionType})
            </td>
            <th>시공종류</th>
            <td>{selected.workType}</td>
            <th>시공상태</th>
            <td>
              {selected.status}
              {selected.status === '시공완료' && selected.completedDate && ` (${selected.completedDate})`}
              {selected.status === '취소' && ` (${selected.canceledDate} ${selected.cancelReason})`}
            </td>
          </tr>
          <tr>
            <th>시공 등록</th>
            <td colSpan={2}>
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  {CIRCLED[i]} : {scheduleLine(selected.schedules[i])}
                </div>
              ))}
            </td>
            <th>시공담당</th>
            <td colSpan={2}>
              {[0, 1, 2].map((i) => (
                <div key={i}>
                  {CIRCLED[i]} : {selected.schedules[i]?.assigneeName || ''}
                  {selected.schedules[i]?.mobileStatus && <span className="mobile-chip">{selected.schedules[i].mobileStatus}</span>}
                </div>
              ))}
            </td>
          </tr>
          <tr>
            <th>패키지</th>
            <td colSpan={3}>
              {(selected.lineItems || []).map((l, i) => (
                <div key={i}>
                  {l.name}
                  {l.qty > 1 && ` x${l.qty}`}
                  {l.detail && <span className="sub-text"> — {l.detail}</span>}
                </div>
              ))}
            </td>
            <th>추가시공품목</th>
            <td className="pre-wrap">{selected.items}</td>
          </tr>
          {showAmount && (
            <tr>
              <th>계약금액</th>
              <td colSpan={5}>
                <div className="amount-line">
                  <span>실계약금 <b>{won(a.actual - a.canceled)}원</b></span>
                  <span>입금 <b>{won(a.paid - a.refund)}원</b>{kindBreakdown(a.byKind, won) && <small> ({kindBreakdown(a.byKind, won)})</small>}</span>
                  <span className={a.balance > 0 ? 'text-red' : 'text-done'}>남은 잔금 <b>{won(a.balance)}원</b></span>
                </div>
                <div className="sub-text">
                  시공금액 {won(a.total)}원 · 할인 {won(a.discount)}원 · 상품권 {won(a.voucher)}원
                  {selected.discountReason && ` (할인사유: ${selected.discountReason})`}
                  {a.canceled > 0 && ` · 매출취소 ${won(a.canceled)}원`}
                  {a.refund > 0 && ` · 환불 ${won(a.refund)}원`}
                </div>
              </td>
            </tr>
          )}
          <tr>
            <th>기사전달사항</th>
            <td colSpan={5} className="pre-wrap">{selected.engineerNote}</td>
          </tr>
          <tr>
            <th>상담내역</th>
            <td colSpan={5}>
              {data.notes.slice(0, 3).map((n) => (
                <div key={`${n.contractId}-${n.id}`}>
                  <span className="sub-text">{new Date(n.at).toLocaleDateString('ko-KR')} {n.byName}</span> {n.text}
                </div>
              ))}
            </td>
          </tr>
          <tr>
            <th>고객상담</th>
            <td colSpan={5} className="pre-wrap">{selected.happyCallMemo}</td>
          </tr>
        </tbody>
      </table>
    </>
  );

  const workList = (
    <>
      <h3 className="form-section-title">&gt; 상세시공</h3>
      <div className="table-responsive">
        <table className="detail-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>구분</th>
              <th>패키지</th>
              <th>추가시공품목</th>
              <th>시공 등록</th>
              <th>시공기사</th>
              {can('notify.send') && <th>알림톡</th>}
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr
                key={c.id}
                className={`selectable-row ${c.id === selected.id ? 'selected-row' : ''}`}
                onClick={() => setSelectedId(c.id)}
                title="누르면 위 시공정보에 표시됩니다"
              >
                <td>{c.no ?? '-'}</td>
                <td className="nowrap">
                  {c.category} - {c.workType}
                  {c.status === '취소' && <div className="text-red sub-text">취소</div>}
                </td>
                <td className="text-left">
                  {(c.lineItems || []).map((l, i) => (
                    <div key={i}>{l.name}</div>
                  ))}
                </td>
                <td className="text-left pre-wrap items-cell">{c.items}</td>
                <td className="text-left nowrap">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      {CIRCLED[i]} {scheduleLine(c.schedules[i])}
                    </div>
                  ))}
                </td>
                <td className="text-left nowrap">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      {CIRCLED[i]} : {c.schedules[i]?.assigneeName || ''}
                    </div>
                  ))}
                </td>
                {can('notify.send') && (
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="talk-btn-grid">
                      {talkBrands.map((b) =>
                        ['계약완료', '기사배정'].map((t) => (
                          <button key={t + b} type="button" className="btn-talk-sm" onClick={() => setKakao({ contract: c, template: t, brand: b })}>
                            💬 {t}({b})
                          </button>
                        )),
                      )}
                    </div>
                  </td>
                )}
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row-actions">
                    {can('contract.edit') && (
                      <button type="button" className="btn-dark-action" onClick={() => onEdit(c)}>수정</button>
                    )}
                    {can('contract.delete') && (
                      <button type="button" className="btn-dark-action" onClick={() => removeWork(c)}>삭제</button>
                    )}
                    <button type="button" className="btn-outline-action" onClick={() => setViewId(c.id)}>계약서</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {can('contract.create') && (
        <div className="section-actions">
          <span className="add-work-label">시공등록</span>
          {CATEGORIES.filter((c) => c !== '기타').map((cat) => (
            <button key={cat} type="button" className="btn-dark-lg sm add-work-btn" onClick={() => onNewWork(head, cat)}>
              + {cat}
            </button>
          ))}
        </div>
      )}
    </>
  );

  const sum = sumAmounts(list);
  const amountSection = showAmount && (
    <>
      <h3 className="form-section-title">&gt; 시공내역 · 금액</h3>
      <div className="amount-cards">
        <div className="amount-card">
          <span>총 계약금액</span>
          <b>{won(sum.actual - sum.canceled)}원</b>
          <small>{list.length}개 시공{sum.discount + sum.voucher > 0 ? ` · 할인 ${won(sum.discount + sum.voucher)}원` : ''}</small>
        </div>
        <div className="amount-card">
          <span>입금</span>
          <b>{won(sum.paid - sum.refund)}원</b>
          <small>{kindBreakdown(sum.byKind, won) || '입금 없음'}{sum.refund > 0 ? ` · 환불 ${won(sum.refund)}` : ''}</small>
        </div>
        <div className={`amount-card ${sum.balance > 0 ? 'due' : 'done'}`}>
          <span>남은 잔금</span>
          <b>{won(sum.balance)}원</b>
          <small>{sum.balance > 0 ? '시공 전·후 받을 금액' : '완납'}</small>
        </div>
      </div>
      <div className="table-responsive">
        <table className="detail-table amount-table">
          <thead>
            <tr>
              <th>선택</th>
              <th>구분</th>
              <th>실계약금액</th>
              <th>계약금</th>
              <th>중도금</th>
              <th>잔금</th>
              <th>입금 합계</th>
              <th>남은 잔금</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const x = calcAmounts(c);
              return (
                <tr key={c.id} className={`selectable-row ${payTargetId === c.id ? 'selected' : ''}`} onClick={() => setPayTargetId(c.id)}>
                  <td>
                    <input type="radio" name="payTarget" checked={payTargetId === c.id} onChange={() => setPayTargetId(c.id)} />
                  </td>
                  <td>
                    <b>{c.category}</b>
                    {c.status === '취소' && <div className="text-red sub-text">취소</div>}
                  </td>
                  <td className="text-right">
                    <b>{won(x.actual - x.canceled)}원</b>
                    {(x.discount > 0 || x.voucher > 0 || x.canceled > 0) && (
                      <div className="sub-text">
                        시공금액 {won(x.total)}
                        {x.discount > 0 && ` · 할인 ${won(x.discount)}`}
                        {x.voucher > 0 && ` · 상품권 ${won(x.voucher)}`}
                        {x.canceled > 0 && ` · 취소 ${won(x.canceled)}`}
                      </div>
                    )}
                    {c.discountReason && <div className="sub-text discount-reason">할인사유: {c.discountReason}</div>}
                  </td>
                  <td className="text-right">{x.byKind['계약금'] ? `${won(x.byKind['계약금'])}원` : '-'}</td>
                  <td className="text-right">{x.byKind['중도금'] ? `${won(x.byKind['중도금'])}원` : '-'}</td>
                  <td className="text-right">{x.byKind['잔금'] || x.byKind['추가금'] ? `${won((x.byKind['잔금'] || 0) + (x.byKind['추가금'] || 0))}원` : '-'}</td>
                  <td className="text-right">
                    {won(x.paid - x.refund)}원{x.refund > 0 && <div className="sub-text">환불 {won(x.refund)}</div>}
                  </td>
                  <td className={`text-right ${x.balance > 0 ? 'text-red' : 'text-done'}`}>
                    <b>{x.balance > 0 ? `${won(x.balance)}원` : x.balance < 0 ? `초과 ${won(-x.balance)}원` : '완납'}</b>
                  </td>
                </tr>
              );
            })}
            {list.length > 1 && (
              <tr className="sum-row">
                <td />
                <td><b>합계</b></td>
                <td className="text-right"><b>{won(sum.actual - sum.canceled)}원</b></td>
                <td className="text-right">{won(sum.byKind['계약금'] || 0)}원</td>
                <td className="text-right">{won(sum.byKind['중도금'] || 0)}원</td>
                <td className="text-right">{won((sum.byKind['잔금'] || 0) + (sum.byKind['추가금'] || 0))}원</td>
                <td className="text-right">{won(sum.paid - sum.refund)}원</td>
                <td className={`text-right ${sum.balance > 0 ? 'text-red' : 'text-done'}`}><b>{won(sum.balance)}원</b></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {can('contract.edit') && (
        <div className="section-actions">
          <button
            type="button"
            className="btn-dark-lg sm"
            onClick={() => setPaymentModal({ contract: list.find((c) => c.id === payTargetId) || selected })}
          >
            + 입금등록
          </button>
          <button type="button" className="btn-dark-lg sm discount-btn" onClick={() => setDiscountTarget(list.find((c) => c.id === payTargetId) || selected)}>
            할인 적용
          </button>
          <span className="sub-text" style={{ marginLeft: 8 }}>위 표에서 입금·할인할 시공을 선택하세요.</span>
        </div>
      )}

      <h3 className="form-section-title">&gt; 입금</h3>
      <div className="table-responsive">
        <table className="detail-table payment-table">
          <thead>
            <tr>
              <th>입금일</th>
              <th>구분</th>
              <th>항목</th>
              <th>카드/계좌이체/현금</th>
              <th>입금액</th>
              <th>입금자명</th>
              <th>승인번호</th>
              <th>카드명/은행명</th>
              <th>카드번호</th>
              <th>영수증</th>
              <th>비고</th>
              {can('contract.edit') && <th>관리</th>}
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={12} className="no-data">등록된 입금 내역이 없습니다.</td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={`${p.contract.id}-${p.id}`}>
                <td>{p.date}</td>
                <td>{p.contract.category}</td>
                <td className={isRefund(p) ? 'text-red' : ''}>{p.kind}</td>
                <td>{p.method}</td>
                <td className={isRefund(p) ? 'text-red' : ''}>
                  {isRefund(p) ? '-' : ''}
                  {won(p.amount)}원
                </td>
                <td>{p.payerName}</td>
                <td>{p.approvalNo}</td>
                <td>{p.bankOrCard}</td>
                <td>{p.cardLast4 ? `****-${p.cardLast4}` : ''}</td>
                <td>
                  {p.receipt === '미발행' ? '' : p.receipt}
                  {p.hasReceipt && (
                    <button type="button" className="btn-receipt" title="영수증 사진 보기" onClick={() => openReceipt(p.contract, p)}>
                      📎 사진{p.receiptCount > 1 ? ` ${p.receiptCount}장` : ''}
                    </button>
                  )}
                </td>
                <td className="sub-text">
                  {p.memo}
                  {p.createdAt && <div>{new Date(p.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>}
                </td>
                {can('contract.edit') && (
                  <td>
                    <div className="table-action-btns">
                      <button type="button" className="btn-edit-icon" title="수정" onClick={() => setPaymentModal({ contract: p.contract, payment: p })}>✏️</button>
                      <button type="button" className="btn-delete-icon" title="삭제" onClick={() => removePayment(p.contract, p)}>🗑️</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const progressSection = (
    <>
      <h3 className="form-section-title">&gt; 진행상황</h3>
      <div className="table-responsive">
        <table className="detail-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>등록일</th>
              <th>구분</th>
              <th>계약자</th>
              <th>아파트명</th>
              <th>시공완료일</th>
              <th>작성자</th>
              <th>시공담당</th>
              <th>기사메모</th>
            </tr>
          </thead>
          <tbody>
            {progress.length === 0 && (
              <tr>
                <td colSpan={9} className="no-data">등록된 데이터가 없습니다.</td>
              </tr>
            )}
            {progress.map(({ c, s, i }) => (
              <tr key={`${c.id}-${i}`}>
                <td>{c.no ?? '-'}</td>
                <td>{s.reportedAt ? new Date(s.reportedAt).toLocaleDateString('ko-KR') : '-'}</td>
                <td>
                  {c.category} {i + 1}차{s.mobileStatus && <div className="sub-text">{s.mobileStatus}</div>}
                </td>
                <td>{c.customerName}</td>
                <td>{formatAddress(c)}</td>
                <td>{c.completedDate}</td>
                <td>{s.reportedBy || '-'}</td>
                <td>{s.assigneeName}</td>
                <td className="text-left">{s.mobileMemo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );

  const addNote = async () => {
    if (!noteText.trim()) return;
    await run(() => contractApi.addNote(noteTarget, noteText));
    setNoteText('');
  };

  return (
    <div className="page-card contract-detail">
      <div className="page-title-row">
        <h2>계약관리</h2>
        <button type="button" className="btn-outline-action" style={{ marginLeft: 'auto' }} onClick={onBack}>
          ← 목록으로
        </button>
      </div>

      <div className="detail-tabs">
        {TABS.map((t) => (
          <button key={t} type="button" className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === '시공관리' && (
        <>
          {/* 계약 등록 화면과 같은 순서: 계약정보 → 시공내역·금액 → 시공정보 */}
          {basicInfo}
          {amountSection}
          {workInfo}
          {workList}
          {progressSection}
        </>
      )}

      {tab === '계약정보' && (
        <>
          {basicInfo}
          {can('contract.edit') && (
            <div className="section-actions">
              <button type="button" className="btn-dark-lg sm" onClick={() => onEdit(selected)}>계약정보 수정</button>
            </div>
          )}
          <h3 className="form-section-title">&gt; 변경이력</h3>
          <div className="table-responsive">
            <table className="detail-table history-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>구분</th>
                  <th>변경자</th>
                  <th>내용</th>
                  <th>변경사항</th>
                </tr>
              </thead>
              <tbody>
                {list
                  .flatMap((c) => (c.history || []).map((h) => ({ ...h, category: c.category })))
                  .sort((x, y) => y.at.localeCompare(x.at))
                  .slice(0, 100)
                  .map((h, i) => (
                    <tr key={i}>
                      <td className="nowrap">{new Date(h.at).toLocaleString('ko-KR')}</td>
                      <td>{h.category}</td>
                      <td>{h.byName}</td>
                      <td>{h.action}</td>
                      <td className="text-left">
                        {h.changes?.map((ch, j) => (
                          <div key={j}>
                            <strong>{ch.label}</strong>: {ch.from} → {ch.to}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === '계약자' && (
        <>
          <h3 className="form-section-title">&gt; 계약자 정보</h3>
          <table className="info-grid">
            <tbody>
              <tr>
                <th>이름</th>
                <td>{head.customerName}</td>
                <th>유형</th>
                <td>{data.customer?.userType || '-'}</td>
              </tr>
              <tr>
                <th>연락처 ①</th>
                <td>{head.customerPhone}</td>
                <th>연락처 ②</th>
                <td>{head.customerPhone2 || data.customer?.phone2 || '-'}</td>
              </tr>
              <tr>
                <th>이메일</th>
                <td>{data.customer?.email || '-'}</td>
                <th>주소</th>
                <td>{[data.customer?.address1, data.customer?.address2].filter(Boolean).join(' ') || '-'}</td>
              </tr>
            </tbody>
          </table>
          <h3 className="form-section-title">&gt; 이 계약자의 다른 현장 계약</h3>
          <div className="table-responsive">
            <table className="detail-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>계약일</th>
                  <th>구분</th>
                  <th>현장</th>
                  <th>시공상태</th>
                </tr>
              </thead>
              <tbody>
                {data.otherContracts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="no-data">다른 현장 계약이 없습니다.</td>
                  </tr>
                )}
                {data.otherContracts.map((c) => (
                  <tr key={c.id} className="selectable-row" onClick={() => onOpenGroup(c.id)}>
                    <td>{c.no}</td>
                    <td>{c.contractDate}</td>
                    <td>{c.category}</td>
                    <td>{formatAddress(c)}</td>
                    <td>{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === '상담내역' && (
        <>
          <h3 className="form-section-title">&gt; 상담내역</h3>
          <div className="inline-fields" style={{ marginBottom: 10 }}>
            <select className="input-text" value={noteTarget} onChange={(e) => setNoteTarget(Number(e.target.value))}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  No.{c.no} {c.category}
                </option>
              ))}
            </select>
            <input
              className="input-text full"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addNote()}
              placeholder="상담 내용 입력 (Enter 로 등록)"
            />
            <button type="button" className="btn-dark-lg sm" onClick={addNote}>등록</button>
          </div>
          {data.notes.length === 0 && <p className="no-data">등록된 상담내역이 없습니다.</p>}
          {data.notes.map((n) => (
            <div key={`${n.contractId}-${n.id}`} className="note-item">
              <div className="note-meta">
                {new Date(n.at).toLocaleString('ko-KR')} · {n.byName} · {n.category}
              </div>
              <div className="pre-wrap">{n.text}</div>
            </div>
          ))}
        </>
      )}

      {receiptView && (
        <div className="modal-overlay" {...backdrop(() => setReceiptView(null))}>
          <div className="customer-reg-modal receipt-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top-bar">
              <h3>&gt; 영수증 사진 — {receiptView.title}</h3>
              <button type="button" className="modal-close-x" onClick={() => setReceiptView(null)}>&times;</button>
            </div>
            <div className="receipt-full-list">
              {receiptView.images.map((r, i) => (
                <div key={r.id ?? i} className="receipt-full-item">
                  {receiptView.images.length > 1 && <div className="sub-text">{i + 1} / {receiptView.images.length}</div>}
                  <img className="receipt-full" src={r.image} alt={`영수증 사진 ${i + 1}`} />
                  <a className="btn-outline-action" href={r.image} download={`영수증_${i + 1}.jpg`}>내려받기</a>
                </div>
              ))}
            </div>
            <div className="form-bottom-btns">
              <button type="button" className="btn-dark-lg sm cancel" onClick={() => setReceiptView(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
      {discountTarget && <DiscountModal contract={discountTarget} onSave={saveDiscount} onClose={() => setDiscountTarget(null)} />}
      {paymentModal && (
        <PaymentModal contract={paymentModal.contract} payment={paymentModal.payment} onSave={savePayment} onClose={() => setPaymentModal(null)} />
      )}
      {kakao && (
        <KakaoModal
          contract={kakao.contract}
          initialTemplate={kakao.template}
          initialBrand={kakao.brand}
          initialTarget={kakao.template === '기사배정' ? '기사' : '고객'}
          onClose={() => setKakao(null)}
        />
      )}
      {viewId && <ContractViewModal contractId={viewId} onClose={() => setViewId(null)} onChanged={load} />}
    </div>
  );
}

// 계약 상세: 실물 계약서 사진 — 작성한 사람이 다시 확인하는 용도라 들어오자마자 작은 사진이 보이고, 여기서 바로 추가·삭제
function PaperPanel({ contract, canEdit, onChanged }) {
  const count = contract.paperPhotoCount || 0;
  const [photos, setPhotos] = useState(count ? null : []);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!count) return;
    contractApi
      .paperPhotos(contract.id)
      .then(setPhotos)
      .catch(() => setPhotos([]));
  }, [contract.id, count]);

  const add = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const room = PAPER_MAX - count;
    if (files.length > room) alert(`실물 계약서 사진은 계약 1건당 ${PAPER_MAX}장까지 올릴 수 있습니다. 앞의 ${Math.max(room, 0)}장만 올립니다.`);
    setBusy(true);
    try {
      for (const f of files.slice(0, Math.max(room, 0))) {
        const img = await compressImage(f, { maxSize: 2000, quality: 0.85 });
        await contractApi.setPaperPhotos(contract.id, { add: [img] }); // 용량 한도 때문에 한 장씩
      }
      onChanged();
    } catch (err) {
      alert(err.message);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    if (!window.confirm('이 사진을 지울까요?')) return;
    try {
      await contractApi.setPaperPhotos(contract.id, { remove: [id] });
      onChanged();
    } catch (err) {
      alert(err.message);
    }
  };

  return (
    <div className="paper-panel">
      {count === 0 && <span className="sub-text">올린 사진이 없습니다.</span>}
      {count > 0 && !photos && <span className="sub-text">사진 불러오는 중...</span>}
      {(photos || []).map((r, i) => (
        <span key={r.id} className="paper-thumb">
          <img src={r.image} alt={`실물 계약서 ${i + 1}`} onClick={() => setView(i)} />
          {canEdit && (
            <button type="button" title="사진 삭제" onClick={() => remove(r.id)}>
              ×
            </button>
          )}
        </span>
      ))}
      {canEdit && count < PAPER_MAX && (
        <label className={`paper-add ${busy ? 'busy' : ''}`}>
          {busy ? '올리는 중...' : '📷 사진 추가'}
          <input type="file" accept="image/*" multiple onChange={add} hidden disabled={busy} />
        </label>
      )}
      {view != null && photos && <PhotoViewer images={photos.map((r) => r.image)} start={view} title={`${contract.customerName} 실물 계약서`} onClose={() => setView(null)} />}
    </div>
  );
}
