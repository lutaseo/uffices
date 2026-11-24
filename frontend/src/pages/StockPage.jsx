import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { stocks } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { currentPurchaseCategories } from '../constants.js';
import { today } from '../utils/date.js';
import { downloadExcel } from '../utils/excel.js';

// 통계정보 > 재고체크: 페인트·자재 품목별 현재고, 입고 / 사용 / 실사(실제로 세어 본 수량) 기록
const MOVE_TYPES = [
  ['입고', '들어온 수량 (+)'],
  ['사용', '쓴 수량 (−)'],
  ['실사', '실제로 세어 본 남은 수량 (그 수량으로 맞춤)'],
];
const num = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const cleanQty = (v) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
const low = (r) => r.minQty > 0 && r.qty <= r.minQty;

const emptyItem = () => ({ name: '', category: '공통', spec: '', unit: '통', minQty: '', startQty: '', memo: '' });
const emptyMove = () => ({ itemId: '', date: today(), type: '사용', qty: '', memo: '' });

// 기록마다 그 시점의 재고 (최근 기록이 위로)
function withBalance(moves = []) {
  let q = 0;
  return [...moves]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
    .map((m) => {
      q = m.type === '실사' ? m.qty : m.type === '입고' ? q + m.qty : q - m.qty;
      return { ...m, after: Math.round(q * 100) / 100 };
    })
    .reverse();
}

export default function StockPage() {
  const { can, handleError } = useAuth();
  const [rows, setRows] = useState([]);
  const [item, setItem] = useState(emptyItem);
  const [pickedId, setPickedId] = useState(null);
  const [move, setMove] = useState(emptyMove);
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState('use'); // 위쪽 입력창: 'use' 물품 사용(입고·실사) / 'item' 물품 등록
  const topRef = useRef(null);
  const qtyRef = useRef(null);

  const load = useCallback(
    () =>
      stocks
        .list({ includeInactive: true })
        .then((list) => {
          setRows(list);
          return list;
        })
        .catch(handleError),
    [handleError],
  );
  useEffect(() => {
    load().then((list) => {
      if (list && !list.some((r) => r.active !== false)) setMode('item'); // 품목이 없으면 등록부터
    });
  }, [load]);

  const run = async (fn) => {
    setSaving(true);
    try {
      await fn();
      await load();
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const shown = useMemo(() => {
    const q = query.trim();
    return rows.filter(
      (r) =>
        (showInactive || r.active !== false) &&
        (!cat || r.category === cat) &&
        (!lowOnly || low(r)) &&
        (!q || `${r.name} ${r.spec} ${r.memo}`.includes(q)),
    );
  }, [rows, query, cat, lowOnly, showInactive]);
  const picked = rows.find((r) => r.id === pickedId);
  const activeRows = rows.filter((r) => r.active !== false);
  const moveItem = rows.find((r) => r.id === Number(move.itemId));

  // 품목 줄의 [사용]/[입고]/[실사] → 위쪽 '물품 사용' 창에 그 품목·종류를 넣고 수량 칸으로
  const startMove = (r, type) => {
    setMode('use');
    setMove((m) => ({ ...m, itemId: r.id, type, qty: '' }));
    setPickedId(r.id);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => qtyRef.current?.focus(), 300);
  };
  const lowCount = rows.filter((r) => r.active !== false && low(r)).length;

  const saveItem = (e) => {
    e.preventDefault();
    run(async () => {
      const saved = await stocks.saveItem(item);
      setItem(emptyItem());
      if (!item.id) {
        setPickedId(saved.id);
        setMove((m) => ({ ...m, itemId: saved.id }));
      }
    });
  };

  const removeItem = (r) => {
    const msg = r.moves?.length ? `[${r.name}] 입출고 기록이 있어 '사용 안 함'으로 바꿉니다. 계속할까요?` : `[${r.name}] 품목을 삭제할까요?`;
    if (!window.confirm(msg)) return;
    run(async () => {
      await stocks.removeItem(r.id);
      if (pickedId === r.id) setPickedId(null);
    });
  };

  const addMove = (e) => {
    e.preventDefault();
    run(async () => {
      await stocks.addMove(moveItem.id, move);
      setPickedId(moveItem.id); // 아래에 그 품목 기록이 보이게
      setMove((m) => ({ ...emptyMove(), itemId: m.itemId, date: m.date, type: m.type }));
    });
  };

  const removeMove = (m) => {
    if (!window.confirm(`${m.date} ${m.type} ${num(m.qty)}${picked.unit} 기록을 삭제할까요?`)) return;
    run(() => stocks.removeMove(picked.id, m.id));
  };

  return (
    <div className="page-card">
      <h2>재고체크</h2>
      <ul className="notice-list">
        <li>[물품 등록]으로 페인트·자재 품목을 만들고, [물품 사용]이나 목록의 [사용] 버튼으로 쓴 수량을 적으면 현재고가 자동으로 계산됩니다.</li>
        <li>실사: 창고에서 실제로 세어 본 남은 수량을 적으면 그 수량으로 맞춰집니다.</li>
        <li>[매입관리]에서 매입을 등록할 때 재고 품목을 고르면 입고가 함께 기록됩니다.</li>
        <li>부족 알림 수량을 정해 두면 그 이하로 남았을 때 빨간색으로 표시됩니다.</li>
      </ul>

      <div className="stock-mode" ref={topRef}>
        <button type="button" className={mode === 'use' ? 'active' : ''} onClick={() => setMode('use')}>
          ✏️ 물품 사용
        </button>
        <button type="button" className={mode === 'item' ? 'active' : ''} onClick={() => setMode('item')}>
          📦 물품 등록
        </button>
      </div>

      {mode === 'use' && (
        <form className="purchase-form" onSubmit={addMove}>
          <label className="wide">
            <span>품목</span>
            <select className="input-select" value={move.itemId} onChange={(e) => setMove({ ...move, itemId: e.target.value ? Number(e.target.value) : '' })} required>
              <option value="">품목을 고르세요</option>
              {activeRows.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.spec ? ` (${r.spec})` : ''} — 현재 {num(r.qty)}
                  {r.unit}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>날짜</span>
            <input type="date" className="input-date" value={move.date} onChange={(e) => setMove({ ...move, date: e.target.value })} required />
          </label>
          <div className="stock-move-types">
            {MOVE_TYPES.map(([t, help]) => (
              <label key={t} className={`radio-tag ${move.type === t ? 'selected' : ''}`} title={help}>
                <input type="radio" checked={move.type === t} onChange={() => setMove({ ...move, type: t })} />
                {t}
              </label>
            ))}
          </div>
          <label>
            <span>{move.type === '실사' ? '실제 남은 수량' : '수량'}{moveItem ? `(${moveItem.unit})` : ''}</span>
            <input ref={qtyRef} className="input-text text-right" inputMode="decimal" value={move.qty} onChange={(e) => setMove({ ...move, qty: cleanQty(e.target.value) })} placeholder="0" required />
          </label>
          <label className="wide">
            <span>메모</span>
            <input className="input-text" value={move.memo} onChange={(e) => setMove({ ...move, memo: e.target.value })} placeholder="예: ○○아파트 현장 사용" />
          </label>
          <div className="purchase-form-actions">
            <button type="submit" className="btn-dark-lg sm" disabled={saving || !moveItem}>
              {move.type} 기록
            </button>
          </div>
          <p className="sub-text stock-move-help">{MOVE_TYPES.find(([t]) => t === move.type)[1]}</p>
        </form>
      )}

      {mode === 'item' && (
      <form className="purchase-form" onSubmit={saveItem}>
        <label className="wide">
          <span>품목명</span>
          <input className="input-text" value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} placeholder="예: 탄성코트 페인트" required />
        </label>
        <label>
          <span>구분</span>
          <select className="input-select" value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value })}>
            {currentPurchaseCategories().map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          <span>색상·규격</span>
          <input className="input-text" value={item.spec} onChange={(e) => setItem({ ...item, spec: e.target.value })} placeholder="예: 화이트 18L" />
        </label>
        <label>
          <span>단위</span>
          <input className="input-text" value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} placeholder="통 / 개 / 박스" />
        </label>
        <label>
          <span>부족 알림 수량</span>
          <input className="input-text text-right" inputMode="decimal" value={item.minQty} onChange={(e) => setItem({ ...item, minQty: cleanQty(e.target.value) })} placeholder="0" />
        </label>
        {!item.id && (
          <label>
            <span>지금 남은 수량</span>
            <input className="input-text text-right" inputMode="decimal" value={item.startQty} onChange={(e) => setItem({ ...item, startQty: cleanQty(e.target.value) })} placeholder="0" />
          </label>
        )}
        <label className="wide">
          <span>메모</span>
          <input className="input-text" value={item.memo} onChange={(e) => setItem({ ...item, memo: e.target.value })} />
        </label>
        <div className="purchase-form-actions">
          <button type="submit" className="btn-dark-lg sm" disabled={saving}>
            {item.id ? '품목 수정 저장' : '+ 품목 등록'}
          </button>
          {item.id && (
            <button type="button" className="btn-dark-lg sm cancel" onClick={() => setItem(emptyItem())}>
              취소
            </button>
          )}
        </div>
      </form>
      )}

      <div className="filter-row">
        <input className="input-text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="품목·규격 검색" style={{ maxWidth: 200 }} />
        <select className="input-select" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">전체 구분</option>
          {currentPurchaseCategories().map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <label className="eng-done-only">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> 부족만 보기
        </label>
        <label className="eng-done-only">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> 사용 안 함 포함
        </label>
        {can('excel.export') && (
          <button
            type="button"
            className="btn-dark-lg sm"
            style={{ marginLeft: 'auto' }}
            onClick={() =>
              downloadExcel(
                shown.map((r) => ({ 품목: r.name, 구분: r.category, 색상규격: r.spec, 현재고: r.qty, 단위: r.unit, 부족알림: r.minQty, 상태: low(r) ? '부족' : '', 메모: r.memo })),
                '재고',
                `재고_${today()}`,
              )
            }
          >
            📄 엑셀다운로드
          </button>
        )}
      </div>

      <div className="amount-cards">
        <div className="amount-card">
          <span>품목</span>
          <b>{rows.filter((r) => r.active !== false).length}개</b>
        </div>
        <div className={`amount-card ${lowCount ? 'due' : 'done'}`}>
          <span>부족 품목</span>
          <b>{lowCount}개</b>
          <small>부족 알림 수량 이하</small>
        </div>
      </div>

      <div className="table-responsive">
        <table className="customer-table">
          <thead>
            <tr>
              <th>품목</th>
              <th>구분</th>
              <th>색상·규격</th>
              <th>현재고</th>
              <th>부족 알림</th>
              <th>최근 기록</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="no-data">등록된 재고 품목이 없습니다. 위에서 품목을 등록해 주세요.</td>
              </tr>
            )}
            {shown.map((r) => {
              const last = withBalance(r.moves)[0];
              return (
                <tr key={r.id} className={`clickable-row ${pickedId === r.id ? 'selected-row' : ''}`} onClick={() => setPickedId(r.id)}>
                  <td className="bold-text text-left">
                    {r.name}
                    {r.active === false && <span className="sub-text"> (사용 안 함)</span>}
                  </td>
                  <td className="nowrap">{r.category}</td>
                  <td>{r.spec || '-'}</td>
                  <td className={`text-right nowrap bold-text ${low(r) ? 'text-red' : ''}`}>
                    {num(r.qty)} {r.unit}
                    {low(r) && ' · 부족'}
                  </td>
                  <td className="text-right nowrap">{r.minQty ? `${num(r.minQty)} ${r.unit}` : '-'}</td>
                  <td className="nowrap sub-text">{last ? `${last.date} ${last.type} ${num(last.qty)}` : '-'}</td>
                  <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                    {r.active !== false && (
                      <>
                        <button type="button" className="btn-dark-sm" onClick={() => startMove(r, '사용')}>
                          사용
                        </button>{' '}
                        <button type="button" className="btn-link" onClick={() => startMove(r, '입고')}>
                          입고
                        </button>{' '}
                        <button type="button" className="btn-link" onClick={() => startMove(r, '실사')}>
                          실사
                        </button>{' '}
                      </>
                    )}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => {
                        setItem({ ...r, minQty: String(r.minQty || '') });
                        setMode('item');
                        topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }}
                    >
                      수정
                    </button>{' '}
                    <button type="button" className="btn-text-danger" onClick={() => removeItem(r)}>
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {picked && (
        <div className="stock-panel">
          <h3>
            {picked.name}
            {picked.spec ? ` (${picked.spec})` : ''} — 현재고{' '}
            <span className={low(picked) ? 'text-red' : ''}>
              {num(picked.qty)} {picked.unit}
            </span>
            {picked.active !== false && (
              <button type="button" className="btn-dark-sm" style={{ marginLeft: 12 }} onClick={() => startMove(picked, '사용')}>
                사용 기록하기
              </button>
            )}
            <button type="button" className="btn-link" style={{ marginLeft: 8 }} onClick={() => setPickedId(null)}>
              닫기
            </button>
          </h3>
          <div className="table-responsive">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>날짜</th>
                  <th>종류</th>
                  <th>수량</th>
                  <th>기록 후 재고</th>
                  <th>메모</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {!picked.moves?.length && (
                  <tr>
                    <td colSpan={6} className="no-data">아직 기록이 없습니다.</td>
                  </tr>
                )}
                {withBalance(picked.moves).map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{m.date}</td>
                    <td className={`nowrap ${m.type === '입고' ? 'text-done' : m.type === '사용' ? 'text-red' : ''}`}>{m.type}</td>
                    <td className="text-right nowrap">
                      {m.type === '입고' ? '+' : m.type === '사용' ? '−' : '='}
                      {num(m.qty)}
                    </td>
                    <td className="text-right nowrap">{num(m.after)} {picked.unit}</td>
                    <td className="text-left">{m.memo}</td>
                    <td className="nowrap">
                      {m.purchaseId ? (
                        <span className="sub-text">매입 연결</span>
                      ) : (
                        <button type="button" className="btn-text-danger" onClick={() => removeMove(m)}>
                          삭제
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
