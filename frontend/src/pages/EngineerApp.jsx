import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { API_MODE, engineerApp } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { MOBILE_STATUS, OFF_LABEL } from '../constants.js';
import { timeLabel } from '../utils/contract.js';
import { WEEKDAYS, addDays, formatKoreanDate, toDateKey, today } from '../utils/date.js';
import { won } from '../utils/format.js';
import OffModal from '../components/OffModal.jsx';
import { goBack, match, navigate, navigateForward } from '../router.js';
import { useRefreshOnReturn } from '../utils/useRefreshOnReturn.js';

// 기사모바일: 기사 계정으로 로그인하면 이 화면만 보입니다 (휴대폰 화면 기준).
export default function EngineerApp({ route }) {
  const { user, company, logout } = useAuth();
  const tab = route?.path === '/engineer/off' ? 'off' : 'schedule';
  const detail = route && match('/engineer/contract/:id', route.path);
  // 기사 계정은 /engineer 주소만 사용
  useEffect(() => {
    if (route && route.path !== '/engineer' && route.path !== '/engineer/off' && !detail) navigate('/engineer', { replace: true });
  }, [route?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (t) => navigate(t === 'off' ? '/engineer/off' : '/engineer');

  return (
    <div className="engineer-app">
      <header className="engineer-header">
        <div>
          <strong>{company?.name} 기사모바일</strong>
          <div className="sub-text light">{user.name} 기사님</div>
          {API_MODE === 'demo' && (
            <div className="demo-badge engineer" title="서버 연결 전: 이 기기 브라우저에만 저장되어 PC·다른 휴대폰과 공유되지 않습니다">
              데모 모드 · 이 기기에만 저장
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn-logout"
          onClick={async () => {
            await logout();
            navigate('/', { replace: true });
          }}
        >
          로그아웃
        </button>
      </header>
      <nav className="engineer-tabs">
        <button type="button" className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}>내 일정</button>
        <button type="button" className={tab === 'off' ? 'active' : ''} onClick={() => setTab('off')}>휴무 설정</button>
      </nav>
      {detail ? <ContractView id={Number(detail.id)} step={Number(route.query.get('step'))} /> : tab === 'schedule' ? <MySchedules /> : <MyOffs />}
    </div>
  );
}

// 상세 화면에 갔다 돌아와도 보던 달력·날짜 그대로
const memo = { view: 'calendar', date: null, ym: null };

// 달력 칸 만들기 (앞쪽 빈칸 + 그달 날짜)
function monthCells(year, month) {
  const cells = [];
  for (let i = 0; i < new Date(year, month - 1, 1).getDay(); i++) cells.push(null);
  for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) cells.push(toDateKey(new Date(year, month - 1, d)));
  return cells;
}

function MySchedules() {
  const { handleError } = useAuth();
  const [view, setView] = useState(memo.view); // calendar | upcoming | past
  const [ym, setYm] = useState(memo.ym || [new Date().getFullYear(), new Date().getMonth() + 1]);
  const [picked, setPicked] = useState(memo.date || today());
  const [list, setList] = useState([]);
  const [offs, setOffs] = useState([]);
  const [year, month] = ym;

  useEffect(() => {
    Object.assign(memo, { view, ym, date: picked });
  }, [view, ym, picked]);

  const load = useCallback(() => {
    const t = today();
    const [from, to] =
      view === 'calendar'
        ? [toDateKey(new Date(year, month - 1, 1)), toDateKey(new Date(year, month, 0))]
        : view === 'upcoming'
          ? [t, addDays(t, 30)]
          : [addDays(t, -30), addDays(t, -1)];
    Promise.all([engineerApp.mySchedules({ from, to }), engineerApp.myOffs({ from, to })])
      .then(([sch, off]) => {
        setList(sch);
        setOffs(off);
      })
      .catch(handleError);
  }, [view, year, month, handleError]);

  useEffect(() => {
    load();
  }, [load]);
  useRefreshOnReturn(load);

  const move = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYm([d.getFullYear(), d.getMonth() + 1]);
  };
  const goToday = () => {
    const d = new Date();
    setYm([d.getFullYear(), d.getMonth() + 1]);
    setPicked(today());
  };

  // 목록 보기: '오늘 이후 30일'에서는 오늘 일정이 없어도 오늘 칸을 맨 위에 표시
  const grouped = useMemo(() => {
    const map = {};
    if (view === 'calendar') map[picked] = [];
    else if (view === 'upcoming') map[today()] = [];
    if (view !== 'calendar') offs.forEach((o) => (map[o.date] = map[o.date] || []));
    list.forEach((s) => (view !== 'calendar' || s.date === picked) && (map[s.date] = map[s.date] || []).push(s));
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [list, offs, view, picked]);
  const offOf = (date) => offs.find((o) => o.date === date);
  const countOf = useMemo(() => {
    const m = {};
    list.forEach((s) => (m[s.date] = (m[s.date] || 0) + 1));
    return m;
  }, [list]);
  const dayTag = (date) => (date === today() ? '오늘' : date === addDays(today(), 1) ? '내일' : '');

  const tag = (v, label) => (
    <label className={`radio-tag ${view === v ? 'selected' : ''}`}>
      <input type="radio" checked={view === v} onChange={() => setView(v)} /> {label}
    </label>
  );

  return (
    <div className="engineer-body">
      <div className="radio-btn-group">
        {tag('calendar', '달력')}
        {tag('upcoming', '오늘 이후 30일')}
        {tag('past', '지난 30일')}
      </div>

      {view === 'calendar' && (
        <>
          <div className="calendar-header-control">
            <button type="button" className="btn-month-nav" onClick={() => move(-1)} aria-label="이전 달">&lt;</button>
            <span className="current-year-month">{year}. {String(month).padStart(2, '0')}</span>
            <button type="button" className="btn-month-nav" onClick={() => move(1)} aria-label="다음 달">&gt;</button>
            <button type="button" className="btn-today-sm" onClick={goToday}>오늘</button>
          </div>
          <div className="calendar-grid-wrapper">
            <div className="calendar-weekdays">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`weekday ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}>{w}</div>
              ))}
            </div>
            <div className="calendar-days-grid">
              {monthCells(year, month).map((date, idx) => {
                if (!date) return <div key={idx} className="calendar-cell empty-cell" />;
                const off = offOf(date);
                return (
                  <div
                    key={date}
                    className={`calendar-cell mini ${date === today() ? 'today-cell' : ''} ${date < today() ? 'past-cell' : ''} ${date === picked ? 'picked-cell' : ''}`}
                    role="button"
                    aria-pressed={date === picked}
                    onClick={() => setPicked(date)}
                  >
                    <div className="day-number">{Number(date.slice(8))}</div>
                    {off && <span className={`off-chip off-${off.period}`}>{OFF_LABEL[off.period]}</span>}
                    {countOf[date] && <div className="schedule-badge">일정 {countOf[date]}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {grouped.length === 0 && <p className="no-data">배정된 일정이 없습니다.</p>}
      {grouped.map(([date, rows]) => (
        <section key={date}>
          <h4 className={`engineer-date ${date === today() ? 'is-today' : ''}`}>
            {formatKoreanDate(date)}
            {dayTag(date) && <span className={`day-tag ${date === today() ? 'today' : ''}`}>{dayTag(date)}</span>}
            {rows.length > 0 && <span className="sub-text"> {rows.length}건</span>}
            {offOf(date) && <span className={`off-chip off-${offOf(date).period}`}>{OFF_LABEL[offOf(date).period]} 휴무</span>}
          </h4>
          {offOf(date) && <div className="sub-text">휴무 사유: {offOf(date).reason}</div>}
          {rows.length === 0 && !offOf(date) && (
            <div className="engineer-card empty">{date === today() ? '오늘' : '이 날'} 배정된 일정이 없습니다.</div>
          )}
          {rows.map((s) => (
            <ScheduleCard key={`${s.contractId}-${s.stepIndex}`} s={s} onReported={load} />
          ))}
        </section>
      ))}
    </div>
  );
}

// 일정 카드: 위쪽(현장·고객·내용)을 누르면 계약 상세로, 아래는 현장 보고
function ScheduleCard({ s, onReported }) {
  const open = () => navigateForward(`/engineer/contract/${s.contractId}?step=${s.stepIndex}`);
  return (
    <div className="engineer-card">
      <div className="engineer-card-link" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
        <div className="engineer-card-top">
          <strong>{timeLabel(s) || '시간미정'}</strong>
          <span className="status-chip st-blue">{s.category} {s.workType !== '시공' ? `· ${s.workType}` : ''}</span>
          <span className="sub-text">{s.stepIndex + 1}차{s.viaTeam ? ` · ${s.teamName}` : ''}</span>
          <span className="engineer-card-more">상세 ›</span>
        </div>
        <div className="bold-text">{s.address}</div>
        <div>
          {s.customerName} ·{' '}
          <a href={`tel:${s.customerPhone}`} onClick={(e) => e.stopPropagation()}>
            {s.customerPhone}
          </a>
        </div>
        {s.items && <div className="sub-text pre-wrap">{s.items}</div>}
        {s.memo && <div className="sub-text">메모: {s.memo}</div>}
        {s.engineerNote && <div className="engineer-note">📌 전달사항: {s.engineerNote}</div>}
        <div className="engineer-balance">현장 수령 잔액 <strong>{won(s.balance)}원</strong></div>
      </div>
      <ReportForm contractId={s.contractId} step={s} onReported={onReported} />
    </div>
  );
}

// 현장 보고 (상태 + 메모) → 사무실 계약서 '모바일웹' 칸에 표시
function ReportForm({ contractId, step, onReported }) {
  const { handleError } = useAuth();
  const [d, setD] = useState({ mobileStatus: step.mobileStatus || '', memo: step.mobileMemo || '' });
  useEffect(() => {
    setD({ mobileStatus: step.mobileStatus || '', memo: step.mobileMemo || '' });
  }, [step.mobileStatus, step.mobileMemo]);

  const report = async () => {
    try {
      await engineerApp.report({ contractId, stepIndex: step.stepIndex, mobileStatus: d.mobileStatus, memo: d.memo });
      alert('보고되었습니다. 사무실 계약서에 바로 표시됩니다.');
      onReported?.();
    } catch (e) {
      handleError(e);
    }
  };

  return (
    <>
      <div className="engineer-report">
        <select className="input-text" value={d.mobileStatus} onChange={(e) => setD({ ...d, mobileStatus: e.target.value })}>
          <option value="">입력 전</option>
          {MOBILE_STATUS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input className="input-text" placeholder="보고 메모 (선택)" value={d.memo} onChange={(e) => setD({ ...d, memo: e.target.value })} />
        <button type="button" className="btn-confirm" onClick={report}>보고</button>
      </div>
      {step.reportedAt && <div className="sub-text">마지막 보고: {new Date(step.reportedAt).toLocaleString('ko-KR')}</div>}
    </>
  );
}

// 계약 상세 (기사용): 실장 계약 상세와 같은 모양 — 계약정보 / 시공정보 / 상세시공 (보기 전용 + 내 회차 보고)
const CIRCLED = ['①', '②', '③'];
const siteText = (c) =>
  [c.aptName, c.dong && `${c.dong}동`, c.ho && `${c.ho}호`, c.aptType && `타입 : ${c.aptType}`, c.area && `평 : ${c.area}`].filter(Boolean).join(' ') || c.address;
const scheduleLine = (s) => (s?.date ? `${s.date}(${timeLabel(s) || '무관'})` : '');
const telLinks = (c) =>
  [c.customerPhone, c.customerPhone2].filter(Boolean).map((p) => (
    <div key={p}>
      <a href={`tel:${p}`}>{p}</a>
    </div>
  ));

function ContractView({ id, step }) {
  const { handleError } = useAuth();
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(id);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    engineerApp
      .contract(id)
      .then((d) => {
        setData(d);
        setSelectedId((prev) => (d.contracts.some((c) => c.id === prev) ? prev : d.selectedId));
      })
      .catch((e) => (e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND' ? setError(e.message) : handleError(e)));
  }, [id, handleError]);
  useEffect(() => {
    load();
  }, [load]);
  useRefreshOnReturn(load);

  const back = (
    <button type="button" className="btn-back-engineer" onClick={() => goBack('/engineer')}>
      ‹ 내 일정
    </button>
  );
  if (error) return <div className="engineer-body">{back}<p className="no-data">{error}</p></div>;
  if (!data) return <div className="engineer-body">{back}<p className="page-loading">불러오는 중...</p></div>;

  const list = data.contracts;
  const c = list.find((x) => x.id === selectedId) || list[0];
  const mine = c.schedules.filter((s) => s.mine);

  return (
    <div className="engineer-body engineer-detail">
      {back}

      <h3 className="form-section-title">&gt; 계약정보</h3>
      <table className="info-grid">
        <tbody>
          <tr>
            <th>고객명</th>
            <td>{c.customerName}</td>
            <th>전화번호</th>
            <td>{telLinks(c)}</td>
            <th>브랜드</th>
            <td>{c.brand}</td>
          </tr>
          <tr>
            <th>계약일</th>
            <td>{c.contractDate}</td>
            <th>계약담당</th>
            <td>{c.ownerName}</td>
            <th>현장</th>
            <td>{siteText(c)}</td>
          </tr>
          <tr>
            <th>입주예정일</th>
            <td colSpan={5}>{c.moveInDate}</td>
          </tr>
          <tr>
            <th>고객 참고사항</th>
            <td colSpan={5} className="pre-wrap">{c.customerNote}</td>
          </tr>
        </tbody>
      </table>

      <h3 className="form-section-title">&gt; 시공정보 — No.{c.no ?? '-'} {c.category}</h3>
      <table className="info-grid">
        <tbody>
          <tr>
            <th>구분</th>
            <td>
              {c.category}
              {c.receptionType && `(${c.receptionType})`}
            </td>
            <th>시공종류</th>
            <td>{c.workType}</td>
            <th>시공상태</th>
            <td>
              {c.status}
              {c.status === '시공완료' && c.completedDate && ` (${c.completedDate})`}
            </td>
          </tr>
          <tr>
            <th>시공 등록</th>
            <td colSpan={2}>
              {[0, 1, 2].map((i) => (
                <div key={i} className={c.schedules[i]?.mine ? 'my-step' : ''}>
                  {CIRCLED[i]} : {scheduleLine(c.schedules[i])}
                </div>
              ))}
            </td>
            <th>시공담당</th>
            <td colSpan={2}>
              {[0, 1, 2].map((i) => (
                <div key={i} className={c.schedules[i]?.mine ? 'my-step' : ''}>
                  {CIRCLED[i]} : {c.schedules[i]?.assigneeName || ''}
                  {c.schedules[i]?.mine && <span className="sub-text"> (나)</span>}
                  {c.schedules[i]?.mobileStatus && <span className="mobile-chip">{c.schedules[i].mobileStatus}</span>}
                </div>
              ))}
            </td>
          </tr>
          <tr>
            <th>패키지</th>
            <td colSpan={3}>
              {c.lineItems.map((l, i) => (
                <div key={i}>
                  {l.name}
                  {l.qty > 1 && ` x${l.qty}`}
                  {l.detail && <span className="sub-text"> — {l.detail}</span>}
                </div>
              ))}
            </td>
            <th>추가시공품목</th>
            <td className="pre-wrap">{c.items}</td>
          </tr>
          <tr>
            <th>계약금액</th>
            <td colSpan={5}>
              <div className="amount-line">
                <span>실계약금 <b>{won(c.amounts.actual)}원</b></span>
                <span>입금 <b>{won(c.amounts.paid)}원</b></span>
                <span className={c.amounts.balance > 0 ? 'text-red' : 'text-done'}>남은 잔금 <b>{won(c.amounts.balance)}원</b></span>
              </div>
            </td>
          </tr>
          <tr>
            <th>기사전달사항</th>
            <td colSpan={5} className="pre-wrap">{c.engineerNote}</td>
          </tr>
          {mine.map((s) =>
            s.memo ? (
              <tr key={s.stepIndex}>
                <th>{CIRCLED[s.stepIndex]} 일정 메모</th>
                <td colSpan={5} className="pre-wrap">{s.memo}</td>
              </tr>
            ) : null,
          )}
        </tbody>
      </table>

      {mine.length > 0 && (
        <>
          <h3 className="form-section-title">&gt; 현장 보고</h3>
          {mine.map((s) => (
            <div key={s.stepIndex} className={`engineer-card ${s.stepIndex === step && c.id === id ? 'focus-step' : ''}`}>
              <div className="engineer-card-top">
                <strong>{CIRCLED[s.stepIndex]} {s.stepIndex + 1}차</strong>
                <span>{s.date ? `${formatKoreanDate(s.date)} ${timeLabel(s)}` : '일정 미정'}</span>
              </div>
              <ReportForm contractId={c.id} step={s} onReported={load} />
            </div>
          ))}
        </>
      )}

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
            </tr>
          </thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id} className={`selectable-row ${x.id === c.id ? 'selected-row' : ''}`} onClick={() => setSelectedId(x.id)} title="누르면 위 시공정보에 표시됩니다">
                <td>{x.no ?? '-'}</td>
                <td className="nowrap">
                  {x.category} - {x.workType}
                  {x.status === '취소' && <div className="text-red sub-text">취소</div>}
                </td>
                <td className="text-left">
                  {x.lineItems.map((l, i) => (
                    <div key={i}>{l.name}</div>
                  ))}
                </td>
                <td className="text-left pre-wrap items-cell">{x.items}</td>
                <td className="text-left nowrap">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      {CIRCLED[i]} {scheduleLine(x.schedules[i])}
                    </div>
                  ))}
                </td>
                <td className="text-left nowrap">
                  {[0, 1, 2].map((i) => (
                    <div key={i}>
                      {CIRCLED[i]} : {x.schedules[i]?.assigneeName || ''}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyOffs() {
  const { handleError } = useAuth();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [offs, setOffs] = useState([]);
  const [busy, setBusy] = useState({});
  const [target, setTarget] = useState(null);
  const [notice, setNotice] = useState('');

  const from = toDateKey(new Date(year, month - 1, 1));
  const to = toDateKey(new Date(year, month, 0));

  const load = useCallback(() => {
    Promise.all([engineerApp.myOffs({ from, to }), engineerApp.mySchedules({ from, to })])
      .then(([o, s]) => {
        setOffs(o);
        const counts = {};
        s.forEach((x) => (counts[x.date] = (counts[x.date] || 0) + 1));
        setBusy(counts);
      })
      .catch(handleError);
  }, [from, to, handleError]);

  useEffect(() => {
    load();
  }, [load]);
  useRefreshOnReturn(load);

  const move = (delta) => {
    const d = new Date(year, month - 1 + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const cells = monthCells(year, month);

  const offOn = (date) => offs.find((o) => o.date === date);

  // 오류는 휴무 창(OffModal) 안에 표시됩니다
  const save = async ({ period, reason }) => {
    await engineerApp.setMyOff({ date: target, period, reason });
    setTarget(null);
    load();
  };

  const cancel = async () => {
    await engineerApp.cancelMyOff(target);
    setTarget(null);
    load();
  };

  const pick = (date) => {
    if (date < today()) {
      setNotice('지난 날짜는 휴무를 등록·취소할 수 없습니다. 오늘 이후 날짜를 눌러 주세요.');
      return;
    }
    setNotice('');
    setTarget(date);
  };

  return (
    <div className="engineer-body">
      <div className="calendar-header-control">
        <button type="button" className="btn-month-nav" onClick={() => move(-1)}>&lt;</button>
        <span className="current-year-month">{year}. {String(month).padStart(2, '0')}</span>
        <button type="button" className="btn-month-nav" onClick={() => move(1)}>&gt;</button>
      </div>
      <p className="sub-text">날짜를 눌러 휴무(오전/오후/종일)를 등록하세요. 일정이 배정된 시간대는 휴무를 등록할 수 없습니다.</p>
      {notice && <p className="off-error" role="alert">{notice}</p>}
      <div className="calendar-grid-wrapper">
        <div className="calendar-weekdays">
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`weekday ${i === 0 ? 'sunday' : ''} ${i === 6 ? 'saturday' : ''}`}>{w}</div>
          ))}
        </div>
        <div className="calendar-days-grid">
          {cells.map((date, idx) => {
            if (!date) return <div key={idx} className="calendar-cell empty-cell" />;
            const off = offOn(date);
            const past = date < today();
            return (
              <div
                key={date}
                className={`calendar-cell mini ${date === today() ? 'today-cell' : ''} ${past ? 'past-cell' : ''}`}
                role="button"
                onClick={() => pick(date)}
              >
                <div className="day-number">{Number(date.slice(8))}</div>
                {off && <span className={`off-chip off-${off.period}`}>{OFF_LABEL[off.period]}</span>}
                {busy[date] && <div className="schedule-badge">일정 {busy[date]}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {target && (
        <OffModal
          date={target}
          existingFor={() => offOn(target)}
          onSave={save}
          onCancelOff={cancel}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
