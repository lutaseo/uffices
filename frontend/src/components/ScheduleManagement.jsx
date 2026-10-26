import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  contracts as contractApi,
  engineerOffs as offApi,
  engineers as engineerApi,
  schedules as scheduleApi,
  teams as teamApi,
} from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ASSIGN_TYPES, CATEGORIES, DEFAULT_SCHEDULE_SETTINGS, OFF_LABEL, WORK_STATUS } from '../constants.js';
import { calcAmounts, offBlocks, slotOf, teamOffStatus, timeFieldsOf, timeLabel, timeOptions, timeValueOf } from '../utils/contract.js';
import { WEEKDAYS, formatKoreanDate, toDateKey, today } from '../utils/date.js';
import { formatAddress, won } from '../utils/format.js';
import { downloadExcel } from '../utils/excel.js';
import KakaoModal from './KakaoModal.jsx';
import ContractViewModal from './ContractViewModal.jsx';
import OffModal from './OffModal.jsx';
import { backdrop } from '../utils/backdrop.js';
import { navigateForward } from '../router.js';
import { useRefreshOnReturn } from '../utils/useRefreshOnReturn.js';

const CATEGORY_SHORT = { 청소: '청', 줄눈: '줄', 나노코팅: '나', 탄성: '탄', 새집증후군: '새', 기타: '기' };
const short = (category) => (CATEGORY_SHORT[category] ? `${CATEGORY_SHORT[category]})` : '');
// 이름 앞에 이미 "줄)"·"탄,줄)" 같은 표시가 있으면 구분 표시를 또 붙이지 않음 ("줄)줄)공두환" 방지)
const HAS_PREFIX = /^[가-힣,]+\)/;
const withShort = (category, name) => (HAS_PREFIX.test(name || '') ? name : `${short(category)}${name}`);

export default function ScheduleManagement() {
  const { company, can, handleError } = useAuth();
  const showAmount = can('contract.amount');
  const canEdit = can('schedule.edit');
  const settings = { ...DEFAULT_SCHEDULE_SETTINGS, ...(company?.scheduleSettings || {}) };
  const now = new Date();
  // 계약 수정 화면에 갔다가 뒤로 오면 보던 달·날짜로 복원
  const saved = window.history.state?.schedule;
  const [year, setYear] = useState(saved?.year || now.getFullYear());
  const [month, setMonth] = useState(saved?.month || now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(saved?.selectedDate || null);
  const [items, setItems] = useState([]);
  const [offs, setOffs] = useState([]);
  const [engineers, setEngineers] = useState([]);
  const [crewTeams, setCrewTeams] = useState([]);
  const [filter, setFilter] = useState({ category: '', engineerId: '', status: '', view: '' });

  const [editItem, setEditItem] = useState(null);
  const [notifyItem, setNotifyItem] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [offTarget, setOffTarget] = useState(null); // { date, engineerId }

  const monthStart = toDateKey(new Date(year, month - 1, 1));
  const monthEnd = toDateKey(new Date(year, month, 0));

  const load = useCallback(async () => {
    try {
      const { view, ...query } = filter;
      const [sch, off] = await Promise.all([
        scheduleApi.list({ from: monthStart, to: monthEnd, ...query }),
        offApi.list({ from: monthStart, to: monthEnd, engineerId: filter.engineerId === 'none' ? '' : filter.engineerId }),
      ]);
      setItems(sch);
      setOffs(off);
    } catch (e) {
      handleError(e);
    }
  }, [monthStart, monthEnd, filter, handleError]);

  useEffect(() => {
    load();
  }, [load]);
  useRefreshOnReturn(load); // 기사가 휴대폰에서 등록한 휴무도 다시 보면 반영

  useEffect(() => {
    engineerApi.list().then(setEngineers).catch(() => {});
    teamApi.list().then((t) => setCrewTeams(t.filter((x) => x.kind === '시공팀'))).catch(() => {});
  }, []);

  const moveMonth = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
    setSelectedDate(null);
  };

  const goToday = () => {
    setYear(now.getFullYear());
    setMonth(now.getMonth() + 1);
    setSelectedDate(today());
  };

  const showWork = filter.view !== 'off';
  const showOff = filter.view !== 'work';

  const byDate = useMemo(() => {
    const map = {};
    items.forEach((it) => {
      (map[it.date] = map[it.date] || []).push(it);
    });
    return map;
  }, [items]);

  const offsByDate = useMemo(() => {
    const map = {};
    offs.forEach((o) => {
      (map[o.date] = map[o.date] || []).push(o);
    });
    return map;
  }, [offs]);

  // 날짜 칸에 "줄)공두환 : 2건" 형태로 담당별 건수 표시
  const cellSummary = (list) => {
    const counts = {};
    list.forEach((it) => {
      const key = it.assigneeName
        ? it.assignType === 'team'
          ? it.teamName
          : withShort(it.contract.category, it.assigneeName)
        : '미배정';
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => (a[0] === '미배정' ? -1 : b[0] === '미배정' ? 1 : a[0].localeCompare(b[0])));
  };

  const cells = [];
  const firstDow = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(toDateKey(new Date(year, month - 1, d)));

  const details = selectedDate && showWork ? byDate[selectedDate] || [] : [];
  const dayOffs = selectedDate && showOff ? offsByDate[selectedDate] || [] : [];

  // ---------- 일정 수정 ----------
  // 계약 수정 권한이 있으면 해당 계약서 수정 화면으로 이동 (저장/취소 후 이 화면으로 돌아옴)
  // 일정 수정 권한만 있으면 기존처럼 날짜·시간·배정만 바꾸는 창
  const canEditContract = can('contract.edit');
  const editSchedule = (row) => {
    if (canEditContract) {
      window.history.replaceState({ ...window.history.state, schedule: { year, month, selectedDate } }, '');
      navigateForward(`/contracts/${row.contract.id}/edit`);
      return;
    }
    setEditItem({
      ...row,
      engineerId: row.engineerId ? String(row.engineerId) : '',
      teamId: row.teamId ? String(row.teamId) : '',
    });
  };
  const editOffOf = (engineerId) => offs.find((o) => String(o.engineerId) === String(engineerId) && o.date === editItem?.date);
  const [editOffs, setEditOffs] = useState([]); // 수정 중인 날짜가 다른 달일 수 있어 별도 조회
  useEffect(() => {
    if (!editItem?.date) {
      setEditOffs([]);
      return;
    }
    offApi.list({ from: editItem.date, to: editItem.date }).then(setEditOffs).catch(() => setEditOffs([]));
  }, [editItem?.date]);
  const offForEdit = (engineerId) =>
    editOffs.find((o) => String(o.engineerId) === String(engineerId)) || editOffOf(engineerId);

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      await contractApi.updateSchedule(editItem.contract.id, editItem.stepIndex, {
        date: editItem.date,
        time: editItem.time,
        ampm: editItem.ampm,
        assignType: editItem.assignType,
        engineerId: editItem.engineerId,
        teamId: editItem.teamId,
        memo: editItem.memo,
      });
      setEditItem(null);
      if (editItem.date !== selectedDate) setSelectedDate(editItem.date);
      load();
    } catch (err) {
      handleError(err);
    }
  };

  // ---------- 휴무 ----------
  // 오류·취소 확인은 휴무 창(OffModal) 안에 표시됩니다
  const saveOff = async ({ engineerId, period, reason }) => {
    await offApi.set({ engineerId, date: offTarget.date, period, reason });
    setOffTarget(null);
    load();
  };

  const cancelOff = async (engineerId) => {
    await offApi.remove({ engineerId, date: offTarget.date });
    setOffTarget(null);
    load();
  };

  const exportDay = () =>
    downloadExcel(
      [
        ...details.map((it) => ({
          날짜: it.date,
          시간: timeLabel(it),
          구분: it.contract.category,
          회차: `${it.stepIndex + 1}차`,
          담당: it.assigneeName || '미배정',
          계약자: it.contract.customerName,
          연락처: it.contract.customerPhone,
          현장: formatAddress(it.contract),
          모바일웹: it.mobileStatus || '입력 전',
          ...(showAmount ? { 잔액: calcAmounts(it.contract).balance } : {}),
          메모: it.memo,
        })),
        ...dayOffs.map((o) => ({ 날짜: o.date, 시간: OFF_LABEL[o.period], 구분: '휴무', 담당: o.engineerName, 메모: o.reason })),
      ],
      '일정',
      `기사일정_${selectedDate}`,
    );

  const editSlot = editItem ? slotOf(editItem, settings) : null;
  const editBlockedOff =
    editItem && editItem.assignType !== ASSIGN_TYPES.TEAM && editItem.engineerId ? offForEdit(editItem.engineerId) : null;

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>기사일정관리</h2>
        <ul className="notice-list">
          <li>계약서에 입력된 시공일정(1~3차)과 배정 기사, 기사 휴무가 날짜별로 표시됩니다.</li>
          <li>날짜를 클릭하면 우측에 상세 일정이 표시되며, 일정/기사 변경은 계약서에 바로 반영됩니다.</li>
          <li>
            휴무는 <span className="off-chip off-DAY">종일</span> <span className="off-chip off-AM">오전</span>{' '}
            <span className="off-chip off-PM">오후</span>로 표시되며, 휴무 시간대에는 일정을 배정할 수 없습니다. (오전 = {settings.amEnd} 이전 시작)
          </li>
        </ul>
      </div>

      <div className="schedule-filter-bar">
        <select className="schedule-select" value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })}>
          <option value="">전체</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="schedule-select" value={filter.engineerId} onChange={(e) => setFilter({ ...filter, engineerId: e.target.value })}>
          <option value="">기사선택</option>
          <option value="none">미배정</option>
          {engineers.map((en) => <option key={en.id} value={en.id}>{en.name}({en.category})</option>)}
        </select>
        <select className="schedule-select" value={filter.view} onChange={(e) => setFilter({ ...filter, view: e.target.value })}>
          <option value="">구분</option>
          <option value="work">시공</option>
          <option value="off">휴무</option>
        </select>
        <select className="schedule-select" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">시공상태</option>
          {WORK_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span className="sub-text" style={{ alignSelf: 'center' }}>
          이번 달 일정 {items.length}건 · 휴무 {offs.length}건
        </span>
      </div>

      <div className="schedule-split-layout">
        <div className="calendar-left-section">
          <div className="calendar-header-control">
            <button type="button" className="btn-month-nav" onClick={() => moveMonth(-1)}>&lt;</button>
            <span className="current-year-month">
              {year}. {String(month).padStart(2, '0')}
            </span>
            <button type="button" className="btn-month-nav" onClick={() => moveMonth(1)}>&gt;</button>
            <button type="button" className="btn-preset" onClick={goToday}>오늘</button>
          </div>

          <div className="calendar-grid-wrapper">
            <div className="calendar-weekdays">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`weekday ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}>{w}</div>
              ))}
            </div>
            <div className="calendar-days-grid">
              {cells.map((dateKey, idx) => {
                if (!dateKey) return <div key={idx} className="calendar-cell empty-cell" />;
                const list = showWork ? byDate[dateKey] || [] : [];
                const offList = showOff ? offsByDate[dateKey] || [] : [];
                const dow = idx % 7;
                const summary = cellSummary(list);
                return (
                  <div
                    key={dateKey}
                    className={`calendar-cell ${dateKey === selectedDate ? 'selected-cell' : ''} ${dateKey === today() ? 'today-cell' : ''}`}
                    onClick={() => setSelectedDate(dateKey)}
                  >
                    <div className={`day-number ${dow === 0 ? 'sunday' : ''} ${dow === 6 ? 'saturday' : ''}`}>
                      {Number(dateKey.slice(8))}
                      {list.length > 0 && <span className="day-total">{list.length}건</span>}
                    </div>
                    {offList.length > 0 && (
                      <div className="off-box" title={offList.map((o) => `${o.engineerName} ${OFF_LABEL[o.period]}휴무: ${o.reason}`).join('\n')}>
                        <div className="off-box-title">휴무</div>
                        {offList.map((o) => (
                          <div key={o.id} className="off-line">
                            <span className={`off-chip off-${o.period}`}>{OFF_LABEL[o.period]}</span>
                            {withShort(o.engineerCategory, o.engineerName)}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="schedule-tag-list">
                      {summary.slice(0, 6).map(([k, n]) => (
                        <div key={k} className={`schedule-badge ${k === '미배정' ? 'unassigned' : ''}`}>
                          {k} : {n}건
                        </div>
                      ))}
                      {summary.length > 6 && <div className="schedule-badge more">…</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {selectedDate && (
          <div className="detail-right-section mobile-bottom-sheet">
            <div className="detail-panel-header">
              <div className="left-title">
                <button type="button" className="btn-reload" title="새로고침" onClick={load}>🔄</button>
                <span className="selected-date-text">
                  {formatKoreanDate(selectedDate)} 상세일정 ({details.length}건)
                </span>
              </div>
              <div className="right-btn-group">
                {canEdit && (
                  <button type="button" className="btn-excel-download" onClick={() => setOffTarget({ date: selectedDate, engineerId: '' })}>
                    + 휴무 등록
                  </button>
                )}
                {can('excel.export') && (
                  <button type="button" className="btn-excel-download" onClick={exportDay}>엑셀 다운로드</button>
                )}
                <button type="button" className="btn-close-sheet" onClick={() => setSelectedDate(null)}>&times;</button>
              </div>
            </div>

            {dayOffs.length > 0 && (
              <div className="day-off-list">
                {dayOffs.map((o) => (
                  <div key={o.id} className="day-off-row">
                    <span className={`off-chip off-${o.period}`}>{OFF_LABEL[o.period]}</span>
                    <strong>{o.engineerName}</strong>
                    <span className="sub-text">({o.engineerCategory})</span>
                    <span>{o.reason}</span>
                    {o.createdByRole === 'ENGINEER' && <span className="sub-text">· 기사 본인 등록</span>}
                    {canEdit && (
                      <button type="button" className="btn-link" onClick={() => setOffTarget({ date: selectedDate, engineerId: o.engineerId })}>
                        수정/취소
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="detail-table-wrapper">
              <table className="schedule-detail-table">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th>시공자</th>
                    <th>회차</th>
                    <th>시간</th>
                    <th>계약자</th>
                    <th>아파트/동호수</th>
                    <th>모바일웹</th>
                    <th>상태</th>
                    {showAmount && <th>잔액</th>}
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {details.length === 0 ? (
                    <tr>
                      <td colSpan={showAmount ? 10 : 9} className="no-data">
                        {selectedDate} 일자에 배정된 시공 일정이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    details.map((row) => (
                      <tr key={`${row.contract.id}-${row.stepIndex}`}>
                        <td>{row.contract.category}</td>
                        <td>{row.assigneeName || <span className="text-red">미배정</span>}</td>
                        <td>{row.stepIndex + 1}차</td>
                        <td>{timeLabel(row) || '-'}</td>
                        <td>
                          {row.contract.customerName}
                          <div className="sub-text">{row.contract.customerPhone}</div>
                        </td>
                        <td className="text-left">
                          {formatAddress(row.contract)}
                          {row.memo && <div className="sub-text">메모: {row.memo}</div>}
                        </td>
                        <td>
                          {row.mobileStatus || <span className="sub-text">입력 전</span>}
                          {row.mobileMemo && <div className="sub-text">“{row.mobileMemo}”</div>}
                        </td>
                        <td>{row.contract.status}</td>
                        {showAmount && <td className="text-right">{won(calcAmounts(row.contract).balance)}</td>}
                        <td>
                          <div className="row-actions">
                            {can('notify.send') && (
                              <button type="button" className="btn-talk-yellow" title="담당기사 알림톡" onClick={() => setNotifyItem(row)}>
                                💬
                              </button>
                            )}
                            {(canEditContract || canEdit) && (
                              <button
                                type="button"
                                className="btn-dark-action"
                                title={canEditContract ? '계약서 수정 화면으로 이동' : '일정 수정'}
                                onClick={() => editSchedule(row)}
                              >
                                수정
                              </button>
                            )}
                            {can('contract.view') && (
                              <button type="button" className="btn-outline-action" onClick={() => setViewId(row.contract.id)}>
                                계약서
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {editItem && (
        <div className="modal-overlay" {...backdrop(() => setEditItem(null))}>
          <div className="customer-reg-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top-bar">
              <h3>
                &gt; 일정/담당 변경 — {editItem.contract.customerName} {editItem.stepIndex + 1}차
              </h3>
              <button type="button" className="modal-close-x" onClick={() => setEditItem(null)}>&times;</button>
            </div>
            <form onSubmit={handleSaveEdit} className="reg-table-form">
              <table className="form-grid-table">
                <tbody>
                  <tr>
                    <td className="label-col">현장</td>
                    <td className="input-col">{formatAddress(editItem.contract)}</td>
                  </tr>
                  <tr>
                    <td className="label-col">시공일 / 시간</td>
                    <td className="input-col inline-fields">
                      <input type="date" value={editItem.date} onChange={(e) => setEditItem({ ...editItem, date: e.target.value })} className="input-text" required />
                      <select className="input-text" value={timeValueOf(editItem)} onChange={(e) => setEditItem({ ...editItem, ...timeFieldsOf(e.target.value) })}>
                        <option value="">시간미정</option>
                        <option value="AM">오전(시간미정)</option>
                        <option value="PM">오후(시간미정)</option>
                        {timeOptions(settings).map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>
                  </tr>
                  <tr>
                    <td className="label-col">담당</td>
                    <td className="input-col">
                      <div className="inline-fields">
                        <label className="radio-item">
                          <input type="radio" checked={editItem.assignType !== ASSIGN_TYPES.TEAM} onChange={() => setEditItem({ ...editItem, assignType: ASSIGN_TYPES.ENGINEER, teamId: '' })} /> 기사배정
                        </label>
                        <label className="radio-item">
                          <input type="radio" checked={editItem.assignType === ASSIGN_TYPES.TEAM} onChange={() => setEditItem({ ...editItem, assignType: ASSIGN_TYPES.TEAM, engineerId: '' })} /> 팀배정
                        </label>
                        {editItem.assignType === ASSIGN_TYPES.TEAM ? (
                          <select value={editItem.teamId} onChange={(e) => setEditItem({ ...editItem, teamId: e.target.value })} className="input-text">
                            <option value="">팀선택</option>
                            {crewTeams.map((t) => {
                              const st = teamOffStatus(t.id, engineers, offForEdit, editSlot);
                              return (
                                <option key={t.id} value={t.id} disabled={st.allOff && String(t.id) !== String(editItem.teamId)}>
                                  {t.name}
                                  {st.total ? ` (${st.total}명${st.offCount ? `, 휴무 ${st.offCount}명` : ''})` : ''}
                                  {st.allOff ? ' — 전원 휴무' : ''}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <select value={editItem.engineerId} onChange={(e) => setEditItem({ ...editItem, engineerId: e.target.value })} className="input-text">
                            <option value="">미배정</option>
                            {engineers.map((en) => {
                              const off = offForEdit(en.id);
                              const dis = off && offBlocks(off.period, editSlot);
                              return (
                                <option key={en.id} value={en.id} disabled={dis && String(en.id) !== String(editItem.engineerId)}>
                                  {en.name}({en.category}){off ? ` — ${OFF_LABEL[off.period]}휴무` : ''}
                                </option>
                              );
                            })}
                          </select>
                        )}
                      </div>
                      {editBlockedOff && offBlocks(editBlockedOff.period, editSlot) && (
                        <div className="text-red off-hint">
                          선택한 기사는 이날 {OFF_LABEL[editBlockedOff.period]} 휴무입니다.
                          {editBlockedOff.period !== 'DAY' && ` ${editBlockedOff.period === 'AM' ? '오후' : '오전'} 시간으로 지정하면 배정할 수 있습니다.`}
                        </div>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="label-col">메모</td>
                    <td className="input-col">
                      <input type="text" value={editItem.memo} onChange={(e) => setEditItem({ ...editItem, memo: e.target.value })} className="input-text full" />
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="form-bottom-btns">
                <button type="submit" className="btn-dark-lg">수정완료</button>
                <button type="button" className="btn-dark-lg cancel" onClick={() => setEditItem(null)}>취소</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {offTarget && (
        <OffModal
          date={offTarget.date}
          engineers={engineers}
          initialEngineerId={offTarget.engineerId}
          existingFor={(id) => offs.find((o) => String(o.engineerId) === String(id) && o.date === offTarget.date)}
          onSave={saveOff}
          onCancelOff={cancelOff}
          onClose={() => setOffTarget(null)}
        />
      )}
      {notifyItem && (
        <KakaoModal contract={notifyItem.contract} initialTarget="기사" initialStep={notifyItem.stepIndex} onClose={() => setNotifyItem(null)} />
      )}
      {viewId && <ContractViewModal contractId={viewId} onClose={() => setViewId(null)} onChanged={load} />}
    </div>
  );
}
