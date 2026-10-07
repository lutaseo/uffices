import React, { useEffect, useMemo, useState } from 'react';
import { engineers as engineerApi, reports } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { DATE_TYPES } from '../constants.js';
import { calcAmounts, firstScheduleDate } from '../utils/contract.js';
import { presetRange, isoToDateKey } from '../utils/date.js';
import { won } from '../utils/format.js';
import { downloadExcel } from '../utils/excel.js';
import { withBase } from '../router.js';

const GROUPS = [
  { key: 'month', label: '월별', fn: null },
  { key: 'category', label: '구분별', fn: (c) => c.category },
  { key: 'brand', label: '브랜드별', fn: (c) => c.brand },
  { key: 'receptionType', label: '접수형태별', fn: (c) => c.receptionType },
  { key: 'owner', label: '작성자별', fn: (c) => c.ownerName || '-' },
  { key: 'engineer', label: '시공기사별' }, // 시공 회차 날짜 기준 (아래 EngineerStats)
];
const CATEGORY_ORDER = ['줄눈', '청소', '탄성', '새집증후군', '나노코팅', '기타'];
// 시공기사별 금액 칸 (관리자: '회사 매출 합계 보기' 권한일 때만 서버가 보내줌)
const MONEY = [
  ['total', '총금액'],
  ['discount', '할인'],
  ['deposit', '계약금'],
  ['paid', '입금'],
  ['balance', '잔액'],
];
const moneyCells = (m, cls = '') => MONEY.map(([k]) => <td key={k} className={`text-right nowrap ${k === 'balance' && m?.[k] > 0 ? 'text-red' : ''} ${cls}`}>{m ? won(m[k]) : ''}</td>);
const moneyExcel = (m) => (m ? Object.fromEntries(MONEY.map(([k, label]) => [label, m[k]])) : {});

const dateOf = (c, dateType) =>
  dateType === 'scheduleDate'
    ? firstScheduleDate(c)
    : dateType === 'createdAt'
      ? isoToDateKey(c.createdAt)
      : c[dateType] || '';

export default function StatsPage() {
  const { can, handleError } = useAuth();
  const showAmount = can('sales.total'); // 매출 금액은 '회사 매출 합계 보기' 권한이 있는 계정만
  const [dateType, setDateType] = useState('contractDate');
  const [range, setRange] = useState(() => presetRange('3months'));
  const [group, setGroup] = useState('month');
  const [rows, setRows] = useState([]);
  const [engRows, setEngRows] = useState([]);
  const [engNames, setEngNames] = useState([]);
  const [engPick, setEngPick] = useState(''); // '' = 전체 기사
  const byEngineer = group === 'engineer';

  useEffect(() => {
    if (byEngineer && !engNames.length) engineerApi.list().then((l) => setEngNames(l.filter((e) => e.active !== false).map((e) => e.name))).catch(() => {});
  }, [byEngineer]); // eslint-disable-line react-hooks/exhaustive-deps
  const engOptions = [...new Set([...engNames, ...engRows.map((r) => r.name)])].sort((a, b) => a.localeCompare(b));
  const engPicked = engRows.find((r) => r.name === engPick) || (engPick ? { name: engPick, assigned: 0, done: 0, postponed: 0, unable: 0, byCategory: {}, jobs: [] } : null);

  useEffect(() => {
    if (byEngineer) reports.engineers({ from: range[0], to: range[1] }).then(setEngRows).catch(handleError);
    else reports.contracts({ dateType, from: range[0], to: range[1] }).then(setRows).catch(handleError);
  }, [byEngineer, dateType, range, handleError]);

  const table = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group);
    if (!g.fn && g.key !== 'month') return [];
    const keyFn = g.fn || ((c) => dateOf(c, dateType).slice(0, 7) || '미정');
    const map = {};
    rows.forEach((c) => {
      const k = keyFn(c);
      const r = (map[k] = map[k] || { key: k, count: 0, done: 0, canceled: 0, actual: 0, paid: 0, balance: 0 });
      r.count += 1;
      if (c.status === '시공완료') r.done += 1;
      if (c.status === '취소') {
        r.canceled += 1;
        return;
      }
      const a = calcAmounts(c);
      r.actual += a.actual;
      r.paid += a.paid;
      r.balance += a.balance;
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [rows, group, dateType]);

  const total = table.reduce(
    (s, r) => ({
      count: s.count + r.count,
      done: s.done + r.done,
      canceled: s.canceled + r.canceled,
      actual: s.actual + r.actual,
      paid: s.paid + r.paid,
      balance: s.balance + r.balance,
    }),
    { count: 0, done: 0, canceled: 0, actual: 0, paid: 0, balance: 0 },
  );
  const maxCount = Math.max(1, ...table.map((r) => r.count));

  return (
    <div className="page-card">
      <h2>통계정보</h2>
      <div className="filter-row">
        {byEngineer ? (
          <>
            <select className="input-select eng-pick" value={engPick} onChange={(e) => setEngPick(e.target.value)} aria-label="시공기사 선택">
              <option value="">전체 기사 보기</option>
              {engOptions.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <span className="stats-basis">시공일(①②③) 기준</span>
          </>
        ) : (
          <select className="input-select" value={dateType} onChange={(e) => setDateType(e.target.value)}>
            {DATE_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label} 기준</option>)}
          </select>
        )}
        <input type="date" className="input-date" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
        <span>~</span>
        <input type="date" className="input-date" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
        {['month', 'lastMonth', '3months'].map((p) => (
          <button key={p} type="button" className="btn-preset" onClick={() => setRange(presetRange(p))}>
            {{ month: '이번달', lastMonth: '지난달', '3months': '3개월' }[p]}
          </button>
        ))}
        <div className="radio-btn-group" style={{ marginLeft: 12 }}>
          {GROUPS.map((g) => (
            <label key={g.key} className={`radio-tag ${group === g.key ? 'selected' : ''}`}>
              <input type="radio" checked={group === g.key} onChange={() => setGroup(g.key)} />
              {g.label}
            </label>
          ))}
        </div>
        {can('excel.export') && (
          <button
            type="button"
            className="btn-dark-lg sm"
            style={{ marginLeft: 'auto' }}
            onClick={() =>
              byEngineer && engPicked
                ? downloadExcel(
                    engPicked.jobs.map((j) => ({ 시공일: j.date, 번호: j.no, 구분: j.category, 회차: `${j.step}차`, 고객: j.customerName, 현장: j.site, 상태: j.done ? '시공완료' : j.mobileStatus || '미완료', ...moneyExcel(j.money) })),
                    '시공목록',
                    `${engPicked.name}_${range[0]}_${range[1]}`,
                  )
                : byEngineer
                ? downloadExcel(
                    engRows.map((r) => ({
                      시공기사: r.name,
                      배정: r.assigned,
                      시공완료: r.done,
                      ...Object.fromEntries(CATEGORY_ORDER.map((k) => [`완료_${k}`, r.byCategory[k] || 0])),
                      연기요청: r.postponed,
                      시공불가: r.unable,
                      ...moneyExcel(r.amounts),
                    })),
                    '시공기사별',
                    `시공기사별_${range[0]}_${range[1]}`,
                  )
                : downloadExcel(
                table.map((r) => ({
                  구분: r.key,
                  계약건수: r.count,
                  시공완료: r.done,
                  취소: r.canceled,
                  ...(showAmount ? { 실계약금: r.actual, 입금: r.paid, 잔액: r.balance } : {}),
                })),
                '통계',
                '통계정보',
              )
            }
          >
            📄 엑셀다운로드
          </button>
        )}
      </div>

      {byEngineer ? (
        engPicked ? <EngineerDetail r={engPicked} /> : <EngineerStats rows={engRows} onPick={setEngPick} />
      ) : (
      <div className="table-responsive">
        <table className="customer-table">
          <thead>
            <tr>
              <th>{GROUPS.find((g) => g.key === group).label.replace('별', '')}</th>
              <th>계약건수</th>
              <th style={{ width: '25%' }} />
              <th>시공완료</th>
              <th>취소</th>
              {showAmount && (
                <>
                  <th>실계약금(취소제외)</th>
                  <th>입금</th>
                  <th>잔액</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {table.length === 0 && (
              <tr>
                <td colSpan={showAmount ? 8 : 5} className="no-data">해당 기간에 데이터가 없습니다.</td>
              </tr>
            )}
            {table.map((r) => (
              <tr key={r.key}>
                <td className="bold-text">{r.key}</td>
                <td>{r.count}</td>
                <td>
                  <div className="bar" style={{ width: `${(r.count / maxCount) * 100}%` }} />
                </td>
                <td>{r.done}</td>
                <td>{r.canceled}</td>
                {showAmount && (
                  <>
                    <td className="text-right">{won(r.actual)}</td>
                    <td className="text-right">{won(r.paid)}</td>
                    <td className="text-right">{won(r.balance)}</td>
                  </>
                )}
              </tr>
            ))}
            {table.length > 0 && (
              <tr className="total-row">
                <td>합계</td>
                <td>{total.count}</td>
                <td />
                <td>{total.done}</td>
                <td>{total.canceled}</td>
                {showAmount && (
                  <>
                    <td className="text-right">{won(total.actual)}</td>
                    <td className="text-right">{won(total.paid)}</td>
                    <td className="text-right">{won(total.balance)}</td>
                  </>
                )}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

// 시공기사별 전체: 기사마다 배정·완료 건수 + 구분별 완료 (줄을 누르면 그 기사만 보기)
function EngineerStats({ rows, onPick }) {
  const cats = CATEGORY_ORDER.filter((k) => rows.some((r) => r.byCategory[k]));
  const maxDone = Math.max(1, ...rows.map((r) => r.done));
  const sum = rows.reduce((t, r) => ({ assigned: t.assigned + r.assigned, done: t.done + r.done, postponed: t.postponed + r.postponed, unable: t.unable + r.unable }), { assigned: 0, done: 0, postponed: 0, unable: 0 });
  const money = rows.some((r) => r.amounts);
  const cols = 6 + cats.length + (money ? MONEY.length : 0);
  const moneySum = money && Object.fromEntries(MONEY.map(([k]) => [k, rows.reduce((t, r) => t + (r.amounts?.[k] || 0), 0)]));

  return (
    <div className="table-responsive">
      <p className="sub-text">위에서 시공기사를 고르거나 줄을 누르면 그 기사의 시공 목록이 보입니다. 완료 = 기사가 '시공완료' 보고했거나 계약이 시공완료 상태 (취소 계약 제외).</p>
      <table className="customer-table eng-stats">
        <thead>
          <tr>
            <th>시공기사</th>
            <th>배정</th>
            <th>시공완료</th>
            <th style={{ width: '20%' }} />
            {cats.map((k) => (
              <th key={k}>{k}</th>
            ))}
            <th>연기요청</th>
            <th>시공불가</th>
            {money && MONEY.map(([k, label]) => <th key={k}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols} className="no-data">해당 기간에 배정된 시공이 없습니다.</td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.name} className="clickable-row" onClick={() => onPick(r.name)}>
              <td className="bold-text text-left">{r.name}</td>
              <td>{r.assigned}</td>
              <td className="bold-text">{r.done}</td>
              <td>
                <div className="bar" style={{ width: `${(r.done / maxDone) * 100}%` }} />
              </td>
              {cats.map((k) => (
                <td key={k}>{r.byCategory[k] || '-'}</td>
              ))}
              <td>{r.postponed || '-'}</td>
              <td>{r.unable || '-'}</td>
              {money && moneyCells(r.amounts)}
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="total-row">
              <td>합계</td>
              <td>{sum.assigned}</td>
              <td>{sum.done}</td>
              <td />
              {cats.map((k) => (
                <td key={k}>{rows.reduce((t, r) => t + (r.byCategory[k] || 0), 0)}</td>
              ))}
              <td>{sum.postponed}</td>
              <td>{sum.unable}</td>
              {money && moneyCells(moneySum)}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// 선택한 기사 한 명: 요약 + 시공 목록 (완료만 보기 가능)
function EngineerDetail({ r }) {
  const [doneOnly, setDoneOnly] = useState(false);
  const jobs = doneOnly ? r.jobs.filter((j) => j.done) : r.jobs;
  const cats = CATEGORY_ORDER.filter((k) => r.byCategory[k]);
  const money = !!r.amounts;
  const shown = money && (doneOnly ? r.doneAmounts : r.amounts);
  return (
    <>
      <div className="amount-cards eng-summary">
        <div className="amount-card">
          <span>배정</span>
          <b>{r.assigned}건</b>
          <small>{r.name}</small>
        </div>
        <div className="amount-card done">
          <span>시공완료</span>
          <b>{r.done}건</b>
          <small>{cats.map((k) => `${k} ${r.byCategory[k]}`).join(' · ') || '완료 없음'}</small>
        </div>
        <div className={`amount-card ${r.postponed + r.unable ? 'due' : ''}`}>
          <span>연기요청 · 시공불가</span>
          <b>{r.postponed} · {r.unable}</b>
          <small>미완료 {r.assigned - r.done}건</small>
        </div>
      </div>
      {money && (
        <div className="amount-cards eng-summary money">
          {MONEY.map(([k, label]) => (
            <div key={k} className={`amount-card ${k === 'balance' && shown[k] > 0 ? 'due' : ''}`}>
              <span>{label}{doneOnly ? ' (시공완료분)' : ''}</span>
              <b>{won(shown[k])}원</b>
            </div>
          ))}
        </div>
      )}
      <label className="eng-done-only">
        <input type="checkbox" checked={doneOnly} onChange={(e) => setDoneOnly(e.target.checked)} /> 시공완료만 보기
      </label>
      <div className="table-responsive">
        <table className="customer-table eng-jobs">
          <thead>
            <tr>
              <th>시공일</th>
              <th>번호</th>
              <th>구분</th>
              <th>회차</th>
              <th>고객</th>
              <th>현장</th>
              <th>상태</th>
              {money && MONEY.map(([k, label]) => <th key={k}>{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 && (
              <tr>
                <td colSpan={7 + (money ? MONEY.length : 0)} className="no-data">해당 기간에 시공이 없습니다.</td>
              </tr>
            )}
            {jobs.map((j) => (
              <tr key={`${j.contractId}-${j.step}`}>
                <td className="nowrap">{j.date}</td>
                <td>
                  <a href={withBase(`/contracts/${j.contractId}`)} target="_blank" rel="noreferrer">{j.no ?? '-'}</a>
                </td>
                <td className="nowrap">{j.category}{j.workType && j.workType !== '시공' ? ` · ${j.workType}` : ''}</td>
                <td>{j.step}차</td>
                <td className="nowrap">{j.customerName}</td>
                <td className="text-left">{j.site}</td>
                <td className={`nowrap ${j.done ? 'text-done' : j.mobileStatus ? 'text-red' : 'sub-text'}`}>{j.done ? '시공완료' : j.mobileStatus || '미완료'}</td>
                {money && (j.money ? moneyCells(j.money) : <td colSpan={MONEY.length} className="sub-text">같은 계약 (금액은 위 회차에 포함)</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
