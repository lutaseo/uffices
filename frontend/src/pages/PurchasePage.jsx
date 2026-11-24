import React, { useCallback, useEffect, useState } from 'react';
import { purchases, stocks } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { currentHasFeature, currentPurchaseCategories } from '../constants.js';
import { presetRange, today } from '../utils/date.js';
import { won } from '../utils/format.js';
import { downloadExcel } from '../utils/excel.js';

// 통계정보 > 매입관리: 자재·인건비 등 쓴 비용을 적어 두면 통계정보에서 매출과 비교 (차액)
const emptyForm = () => ({ date: today(), category: '공통', vendor: '', item: '', amount: '', memo: '', stockItemId: '', stockQty: '' });

export default function PurchasePage() {
  const { can, handleError } = useAuth();
  const [range, setRange] = useState(() => presetRange('month'));
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const canStock = can('stock.manage') && currentHasFeature('stocks'); // 매입하면서 재고 입고도 함께 (재고체크 기능이 켜진 업체)
  const [stockItems, setStockItems] = useState([]);
  const loadStocks = useCallback(() => (canStock ? stocks.list().then(setStockItems).catch(handleError) : Promise.resolve()), [canStock, handleError]);
  useEffect(() => {
    loadStocks();
  }, [loadStocks]);
  const stockName = (id) => {
    const it = stockItems.find((x) => x.id === id);
    return it ? `${it.name}${it.spec ? ` (${it.spec})` : ''}` : '재고';
  };
  const stockUnit = (id) => stockItems.find((x) => x.id === Number(id))?.unit || '';

  const load = useCallback(() => purchases.list({ from: range[0], to: range[1] }).then(setRows).catch(handleError), [range, handleError]);
  useEffect(() => {
    load();
  }, [load]);

  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await purchases.save({ ...form, amount: String(form.amount).replace(/,/g, '') });
      setForm((f) => ({ ...emptyForm(), date: f.id ? today() : f.date, category: f.category })); // 연달아 적기 쉽게 날짜·구분 유지
      await Promise.all([load(), loadStocks()]);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`${r.date} ${r.item} (${won(r.amount)}원) 매입 내역을 삭제할까요?`)) return;
    try {
      await purchases.remove(r.id);
      if (form.id === r.id) setForm(emptyForm());
      await Promise.all([load(), loadStocks()]);
    } catch (err) {
      handleError(err);
    }
  };

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byCategory = currentPurchaseCategories().map((k) => [k, rows.filter((r) => r.category === k).reduce((s, r) => s + r.amount, 0)]).filter(([, v]) => v);

  return (
    <div className="page-card">
      <h2>매입관리</h2>
      <ul className="notice-list">
        <li>자재비·인건비 등 매입(쓴 비용)을 날짜별로 입력합니다.</li>
        <li>입력한 매입은 [통계정보]에서 같은 기간의 매출과 함께 합계·차액(매출 − 매입)으로 보여집니다.</li>
        {canStock && <li>페인트 등 재고 품목을 사면 [재고 입고]에서 품목과 수량을 고르세요. [재고체크]에 입고가 함께 기록됩니다.</li>}
      </ul>

      <form className="purchase-form" onSubmit={submit}>
        <label>
          <span>매입일</span>
          <input type="date" className="input-date" value={form.date} onChange={(e) => setField('date', e.target.value)} required />
        </label>
        <label>
          <span>구분</span>
          <select className="input-select" value={form.category} onChange={(e) => setField('category', e.target.value)}>
            {currentPurchaseCategories().map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          <span>거래처</span>
          <input className="input-text" value={form.vendor} onChange={(e) => setField('vendor', e.target.value)} placeholder="예: ○○자재" />
        </label>
        <label className="wide">
          <span>품목·내용</span>
          <input className="input-text" value={form.item} onChange={(e) => setField('item', e.target.value)} placeholder="예: 줄눈재 20박스" required />
        </label>
        <label>
          <span>금액(원)</span>
          <input
            className="input-text text-right"
            inputMode="numeric"
            value={form.amount === '' ? '' : won(String(form.amount).replace(/[^\d]/g, ''))}
            onChange={(e) => setField('amount', e.target.value.replace(/[^\d]/g, ''))}
            placeholder="0"
            required
          />
        </label>
        <label className="wide">
          <span>메모</span>
          <input className="input-text" value={form.memo} onChange={(e) => setField('memo', e.target.value)} />
        </label>
        {canStock && (
          <>
            <label>
              <span>재고 입고 (선택)</span>
              <select className="input-select" value={form.stockItemId || ''} onChange={(e) => setField('stockItemId', e.target.value ? Number(e.target.value) : '')}>
                <option value="">재고에 넣지 않음</option>
                {stockItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                    {it.spec ? ` (${it.spec})` : ''}
                  </option>
                ))}
              </select>
            </label>
            {form.stockItemId && (
              <label>
                <span>입고 수량({stockUnit(form.stockItemId)})</span>
                <input
                  className="input-text text-right"
                  inputMode="decimal"
                  value={form.stockQty}
                  onChange={(e) => setField('stockQty', e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0"
                  required
                />
              </label>
            )}
          </>
        )}
        <div className="purchase-form-actions">
          <button type="submit" className="btn-dark-lg sm" disabled={saving}>
            {form.id ? '수정 저장' : '+ 매입 등록'}
          </button>
          {form.id && (
            <button type="button" className="btn-dark-lg sm cancel" onClick={() => setForm(emptyForm())}>
              취소
            </button>
          )}
        </div>
      </form>

      <div className="filter-row">
        <input type="date" className="input-date" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
        <span>~</span>
        <input type="date" className="input-date" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
        {['month', 'lastMonth', '3months'].map((p) => (
          <button key={p} type="button" className="btn-preset" onClick={() => setRange(presetRange(p))}>
            {{ month: '이번달', lastMonth: '지난달', '3months': '3개월' }[p]}
          </button>
        ))}
        {can('excel.export') && (
          <button
            type="button"
            className="btn-dark-lg sm"
            style={{ marginLeft: 'auto' }}
            onClick={() =>
              downloadExcel(
                rows.map((r) => ({ 매입일: r.date, 구분: r.category, 거래처: r.vendor, 품목: r.item, 금액: r.amount, 메모: r.memo })),
                '매입',
                `매입_${range[0]}_${range[1]}`,
              )
            }
          >
            📄 엑셀다운로드
          </button>
        )}
      </div>

      <div className="amount-cards">
        <div className="amount-card">
          <span>매입 합계</span>
          <b>{won(total)}원</b>
          <small>{rows.length}건</small>
        </div>
        {byCategory.map(([k, v]) => (
          <div key={k} className="amount-card">
            <span>{k}</span>
            <b>{won(v)}원</b>
          </div>
        ))}
      </div>

      <div className="table-responsive">
        <table className="customer-table">
          <thead>
            <tr>
              <th>매입일</th>
              <th>구분</th>
              <th>거래처</th>
              <th>품목·내용</th>
              <th>금액</th>
              <th>메모</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="no-data">해당 기간에 매입 내역이 없습니다.</td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={form.id === r.id ? 'selected-row' : ''}>
                <td className="nowrap">{r.date}</td>
                <td className="nowrap">{r.category}</td>
                <td>{r.vendor || '-'}</td>
                <td className="text-left">
                  {r.item}
                  {r.stockItemId && (
                    <div className="sub-text">
                      재고 입고: {stockName(r.stockItemId)} +{r.stockQty}
                    </div>
                  )}
                </td>
                <td className="text-right nowrap">{won(r.amount)}</td>
                <td className="text-left">{r.memo}</td>
                <td className="nowrap">
                  <button type="button" className="btn-link" onClick={() => setForm({ ...r, amount: String(r.amount), stockItemId: r.stockItemId || '', stockQty: r.stockQty ? String(r.stockQty) : '' })}>
                    수정
                  </button>{' '}
                  <button type="button" className="btn-text-danger" onClick={() => remove(r)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="total-row">
                <td colSpan={4}>합계</td>
                <td className="text-right nowrap">{won(total)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
