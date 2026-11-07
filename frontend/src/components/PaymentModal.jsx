import React, { useEffect, useState } from 'react';
import PhotoPickButton from './CameraButton.jsx';
import { PAYMENT_KINDS, PAYMENT_METHODS, RECEIPT_TYPES } from '../constants.js';
import { today } from '../utils/date.js';
import { backdrop } from '../utils/backdrop.js';
import { compressImage } from '../utils/image.js';
import { contracts as contractApi } from '../api/index.js';
import MoneyInput from './MoneyInput.jsx';

const MAX_PHOTOS = 5; // 입금 1건당 영수증 사진 최대 장수 (서버와 같음)

// 입금 등록/수정 창 (계약 상세 > 입금등록)
export default function PaymentModal({ contract, payment, onSave, onClose }) {
  const [form, setForm] = useState(() =>
    payment
      ? { ...payment }
      : {
          date: today(),
          kind: (contract.payments || []).some((p) => p.kind === '계약금') ? '잔금' : '계약금',
          method: '계좌이체',
          amount: '',
          payerName: contract.customerName,
          approvalNo: '',
          bankOrCard: '',
          cardLast4: '',
          receipt: '미발행',
          memo: '',
        },
  );
  const [saving, setSaving] = useState(false);
  // 영수증 사진 (여러 장): saved — 이미 저장된 사진 [{id, image}], added — 새로 고른 사진(data URL), removed — 지울 사진 번호
  const [saved, setSaved] = useState([]);
  const [added, setAdded] = useState([]);
  const [removed, setRemoved] = useState([]);
  const [loadingPhotos, setLoadingPhotos] = useState(!!payment?.hasReceipt);
  const [preview, setPreview] = useState(null);
  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    if (!payment?.hasReceipt) return;
    contractApi
      .receipt(contract.id, payment.id)
      .then((r) => setSaved(r.images || [{ id: null, image: r.image }]))
      .catch(() => {})
      .finally(() => setLoadingPhotos(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const keptSaved = saved.filter((r) => !removed.includes(r.id));
  const photoCount = keptSaved.length + added.length;

  const pickReceipt = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const room = MAX_PHOTOS - photoCount;
    if (files.length > room) alert(`영수증 사진은 입금 1건당 ${MAX_PHOTOS}장까지 첨부할 수 있습니다. 앞의 ${Math.max(room, 0)}장만 추가합니다.`);
    try {
      const list = [];
      for (const f of files.slice(0, Math.max(room, 0))) list.push(await compressImage(f));
      setAdded((prev) => [...prev, ...list]);
    } catch (err) {
      alert(err.message);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({ ...form, receiptImages: added, removeReceiptIds: removed.filter((id) => id != null) });
    } finally {
      setSaving(false);
    }
  };

  const isCard = form.method === '카드';

  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="customer-reg-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top-bar">
          <h3>
            &gt; {payment ? '입금 수정' : '입금 등록'} — {contract.category} ({contract.customerName})
          </h3>
          <button type="button" className="modal-close-x" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit} className="reg-table-form">
          <table className="form-grid-table">
            <tbody>
              <tr>
                <td className="label-col">입금일 / 항목<span className="star">*</span></td>
                <td className="input-col inline-fields">
                  <input type="date" className="input-text" value={form.date} onChange={(e) => set('date', e.target.value)} required />
                  <select className="input-text" value={form.kind} onChange={(e) => set('kind', e.target.value)}>
                    {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  {form.kind === '환불' && <span className="text-red sub-text">고객에게 돌려준 금액으로 기록됩니다.</span>}
                </td>
              </tr>
              <tr>
                <td className="label-col">결제수단 / 금액<span className="star">*</span></td>
                <td className="input-col inline-fields">
                  <select className="input-text" value={form.method} onChange={(e) => set('method', e.target.value)}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <MoneyInput value={form.amount} onChange={(v) => set('amount', v)} placeholder="금액" required />
                </td>
              </tr>
              <tr>
                <td className="label-col">입금자명</td>
                <td className="input-col">
                  <input className="input-text" value={form.payerName} onChange={(e) => set('payerName', e.target.value)} />
                </td>
              </tr>
              <tr>
                <td className="label-col">{isCard ? '카드사' : '은행명'}</td>
                <td className="input-col inline-fields">
                  <input className="input-text" value={form.bankOrCard} onChange={(e) => set('bankOrCard', e.target.value)} placeholder={isCard ? '예: 신한카드' : '예: 국민은행'} />
                  {isCard && (
                    <>
                      <input className="input-text" value={form.approvalNo} onChange={(e) => set('approvalNo', e.target.value)} placeholder="승인번호" />
                      <input
                        className="input-text"
                        style={{ width: 90 }}
                        value={form.cardLast4}
                        onChange={(e) => set('cardLast4', e.target.value.replace(/\D/g, '').slice(-4))}
                        placeholder="카드 끝 4자리"
                        inputMode="numeric"
                      />
                      <span className="sub-text">보안상 카드번호는 끝 4자리만 저장합니다.</span>
                    </>
                  )}
                </td>
              </tr>
              <tr>
                <td className="label-col">영수증</td>
                <td className="input-col">
                  <select className="input-text" value={form.receipt} onChange={(e) => set('receipt', e.target.value)}>
                    {RECEIPT_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
              </tr>
              <tr className={isCard ? 'receipt-row card' : 'receipt-row'}>
                <td className="label-col">영수증 사진</td>
                <td className="input-col">
                  <div className="receipt-thumbs">
                    {keptSaved.map((r) => (
                      <div key={`s${r.id}`} className="receipt-thumb">
                        <img src={r.image} alt="영수증 사진" onClick={() => setPreview(r.image)} />
                        <button type="button" className="receipt-thumb-x" title="사진 삭제" onClick={() => setRemoved((prev) => [...prev, r.id])}>×</button>
                      </div>
                    ))}
                    {added.map((img, i) => (
                      <div key={`a${i}`} className="receipt-thumb new">
                        <img src={img} alt="새 영수증 사진" onClick={() => setPreview(img)} />
                        <button type="button" className="receipt-thumb-x" title="사진 빼기" onClick={() => setAdded((prev) => prev.filter((_, j) => j !== i))}>×</button>
                      </div>
                    ))}
                    {photoCount < MAX_PHOTOS && (
                      <PhotoPickButton className="receipt-add" title="사진 추가" onChange={pickReceipt}>
                        <span className="plus">+</span>
                        <span>사진 추가</span>
                      </PhotoPickButton>
                    )}
                  </div>
                  {loadingPhotos && <div className="sub-text">저장된 사진 불러오는 중...</div>}
                  {removed.length > 0 && <div className="sub-text text-red">저장하면 지운 사진 {removed.length}장이 삭제됩니다.</div>}
                  <div className="sub-text">
                    {isCard ? '카드 결제는 카드 영수증을 찍어 첨부해 두세요.' : '영수증·이체 확인 화면 등을 첨부할 수 있습니다.'} (최대 {MAX_PHOTOS}장, 사진을 누르면 크게 보기)
                  </div>
                  {preview && (
                    <div className="receipt-preview-wrap" onClick={() => setPreview(null)}>
                      <img className="receipt-preview" src={preview} alt="영수증 사진 크게 보기" />
                      <div className="sub-text">사진을 누르면 닫힙니다.</div>
                    </div>
                  )}
                </td>
              </tr>
              <tr>
                <td className="label-col">비고</td>
                <td className="input-col">
                  <input className="input-text full" value={form.memo} onChange={(e) => set('memo', e.target.value)} />
                </td>
              </tr>
            </tbody>
          </table>
          <div className="form-bottom-btns">
            <button type="submit" className="btn-dark-lg" disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
            <button type="button" className="btn-dark-lg cancel" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
