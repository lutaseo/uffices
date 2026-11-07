import React, { useState } from 'react';
import { backdrop } from '../utils/backdrop.js';
import { won } from '../utils/format.js';
import MoneyInput from './MoneyInput.jsx';

// 할인 적용 창 (계약 상세 > 시공별 계약금액 > 할인 적용)
//  할인은 금액으로 직접 입력 (예: 10000 → 10,000원)
export default function DiscountModal({ contract, onSave, onClose }) {
  const total = Number(contract.totalAmount) || 0;
  const [discount, setDiscount] = useState(String(contract.discount || ''));
  const [voucher, setVoucher] = useState(String(contract.voucher || ''));
  const [reason, setReason] = useState(contract.discountReason || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const discountValue = Number(discount) || 0;
  const voucherValue = Number(voucher) || 0;
  const actual = total - discountValue - voucherValue;

  const submit = async (e) => {
    e.preventDefault();
    if (actual < 0) return setError('할인/상품권 금액이 시공금액보다 큽니다.');
    setSaving(true);
    setError('');
    try {
      await onSave({ discount: discountValue, voucher: voucherValue, discountReason: reason });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="customer-reg-modal discount-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top-bar">
          <h3>&gt; 할인 적용 — {contract.category} ({contract.customerName})</h3>
          <button type="button" className="modal-close-x" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={submit} className="reg-table-form">
          <table className="form-grid-table">
            <tbody>
              <tr>
                <td className="label-col">시공금액</td>
                <td className="input-col"><b>{won(total)}원</b></td>
              </tr>
              <tr>
                <td className="label-col">할인</td>
                <td className="input-col">
                  <MoneyInput value={discount} onChange={setDiscount} placeholder="할인 금액 (예: 10000)" autoFocus />
                </td>
              </tr>
              <tr>
                <td className="label-col">상품권</td>
                <td className="input-col">
                  <MoneyInput value={voucher} onChange={setVoucher} placeholder="상품권 금액" />
                </td>
              </tr>
              <tr>
                <td className="label-col">할인 사유</td>
                <td className="input-col">
                  <input className="input-text full" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 잔금 현금 결제 할인, 후기 작성 할인" maxLength={100} />
                </td>
              </tr>
              <tr>
                <td className="label-col">적용 후 실계약금</td>
                <td className="input-col">
                  <b className={actual < 0 ? 'text-red' : ''}>{won(actual)}원</b>
                  <span className="sub-text"> (현재 {won(total - (Number(contract.discount) || 0) - (Number(contract.voucher) || 0))}원)</span>
                </td>
              </tr>
            </tbody>
          </table>
          {error && <p className="off-error">{error}</p>}
          <div className="form-bottom-btns">
            <button type="submit" className="btn-dark-lg sm" disabled={saving}>{saving ? '저장 중...' : '적용'}</button>
            <button type="button" className="btn-dark-lg sm cancel" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
