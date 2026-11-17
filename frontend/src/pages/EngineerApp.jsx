import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePageTitle } from '../utils/title.js';
import { API_MODE, engineerApp } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { DEFAULT_SCHEDULE_SETTINGS, MOBILE_STATUS, OFF_LABEL, currentHasFeature } from '../constants.js';
import { timeLabel } from '../utils/contract.js';
import { WEEKDAYS, addDays, formatKoreanDate, toDateKey, today } from '../utils/date.js';
import { won } from '../utils/format.js';
import OffModal from '../components/OffModal.jsx';
import { goBack, match, navigate, navigateForward } from '../router.js';
import { loginEntry } from './LoginPage.jsx';
import { useRefreshOnReturn } from '../utils/useRefreshOnReturn.js';
import PhotoViewer from '../components/PhotoViewer.jsx';
import WorkRecord from '../components/WorkRecord.jsx';
import LineItems from '../components/LineItems.jsx';
import InstallCard from '../components/InstallCard.jsx';
import MapLink from '../components/MapLink.jsx';

// 기사모바일: 기사 계정으로 로그인하면 이 화면만 보입니다 (휴대폰 화면 기준).
export default function EngineerApp({ route }) {
  const { user, company, logout } = useAuth();
  usePageTitle(`기사모바일 · ${company?.name || ''} VerityBase`, `${company?.name || ''} 기사`.trim());
  const tab = route?.path === '/m/off' ? 'off' : 'schedule';
  const detail = route && match('/m/contract/:id', route.path);
  // 기사 계정은 /engineer 주소만 사용
  useEffect(() => {
    // 기사모바일 주소는 /{업체}/m — 예전 주소(/engineer...)로 오면 같은 화면의 새 주소로
    if (route && route.path !== '/m' && route.path !== '/m/off' && !detail) {
      const old = route.path.startsWith('/engineer') ? `/m${route.path.slice('/engineer'.length)}${window.location.search}` : '/m';
      navigate(old, { replace: true });
    }
  }, [route?.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const setTab = (t) => navigate(t === 'off' ? '/m/off' : '/m');

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
            const back = loginEntry() === 'engineer' ? '/m' : '/'; // 기사모바일(/m)로 들어왔으면 기사 로그인 화면으로
            await logout();
            navigate(back, { replace: true });
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

// 달력 위 빨간 알림: 방문일을 아직 안 정한 AS 가 있으면
function AsAlert({ count, onOpen }) {
  return (
    <div className="as-alert" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <span className="as-alert-badge">{count}</span>
      <span className="as-alert-text">
        <b>AS 시공이 발생했습니다</b>
        <small>고객에게 연락하고 방문일을 등록해 주세요</small>
      </span>
      <span className="as-alert-go">확인 ›</span>
    </div>
  );
}

// AS 시간 고르기 (30분 단위)
const AS_TIMES = Array.from({ length: 27 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

// 기사모바일 AS관리: 나에게 맡겨진 AS 목록 · 방문일 등록 · 사진 보기
function MyAsList({ items, onSaved }) {
  const { handleError } = useAuth();
  const [draft, setDraft] = useState({});
  const [photos, setPhotos] = useState(null);
  const [mates, setMates] = useState([]); // 넘길 수 있는 다른 기사님
  useEffect(() => {
    engineerApp.colleagues().then(setMates).catch(() => {});
  }, []);
  if (!items.length) return <p className="no-data">맡겨진 AS 가 없습니다.</p>;
  const key = (a) => `${a.contractId}-${a.asIndex}`;
  const val = (a) => ({ mode: 'visit', date: a.visitDate || '', time: a.visitTime || '', engineerId: '', ...(draft[key(a)] || {}) });
  const put = (a, patch) => setDraft({ ...draft, [key(a)]: { ...val(a), ...patch } });
  const save = async (a) => {
    const v = val(a);
    try {
      if (v.mode === 'visit') {
        if (!v.date) return alert('방문 날짜를 골라 주세요.');
        await engineerApp.setAsVisit(a.contractId, a.asIndex, { date: v.date, time: v.time });
        alert('AS 방문일을 등록했습니다. 내 일정과 사무실에 바로 표시됩니다.');
      } else {
        if (!v.engineerId) return alert('넘길 기사님을 골라 주세요.');
        const name = mates.find((m) => String(m.id) === String(v.engineerId))?.name || '';
        if (!window.confirm(`이 AS 를 ${name} 기사님에게 넘길까요? 넘기면 내 목록에서 빠집니다.`)) return;
        await engineerApp.transferAs(a.contractId, a.asIndex, Number(v.engineerId));
        alert(`${name} 기사님에게 넘겼습니다.`);
      }
      setDraft({ ...draft, [key(a)]: undefined });
      onSaved();
    } catch (e) {
      handleError(e);
    }
  };
  const showPhotos = async (a) => {
    try {
      const list = await engineerApp.asPhotos(a.contractId, a.asIndex);
      if (list.length) setPhotos({ images: list.map((r) => r.image), title: `${a.customerName} AS 사진` });
    } catch (e) {
      handleError(e);
    }
  };
  return (
    <div className="my-as-list">
      {items.map((a) => (
        <div key={key(a)} className={`engineer-card as-card ${a.visitDate ? '' : 'pending'}`}>
          <div className="engineer-card-top">
            <strong>{a.visitDate ? `방문 ${a.visitDate}${a.visitTime ? ` ${a.visitTime}` : ''}` : '방문일 미정'}</strong>
            <span className="status-chip st-red">AS · {a.category}</span>
            <span className="sub-text">접수 {a.date}</span>
          </div>
          <div className="bold-text">
            {a.address} <MapLink name={a.aptName} />
          </div>
          <div>
            {a.customerName} · <a href={`tel:${a.customerPhone}`}>{a.customerPhone}</a>
            {a.customerPhone2 && <> · <a href={`tel:${a.customerPhone2}`}>{a.customerPhone2}</a></>}
          </div>
          <div className="as-request-text">요청: {a.request}</div>
          {a.photoCount > 0 && (
            <button type="button" className="btn-receipt" onClick={() => showPhotos(a)}>📷 사진 {a.photoCount}장 보기</button>
          )}
          <div className="as-visit-form">
            <select className="input-text as-mode" value={val(a).mode} onChange={(e) => put(a, { mode: e.target.value })}>
              <option value="visit">{a.visitDate ? '방문일 변경' : '방문일 등록'}</option>
              <option value="transfer">시공기사 변경</option>
            </select>
            {val(a).mode === 'visit' ? (
              <>
                <input type="date" className="input-text" value={val(a).date} onChange={(e) => put(a, { date: e.target.value })} />
                <select className="input-text" value={val(a).time} onChange={(e) => put(a, { time: e.target.value })}>
                  <option value="">시간 무관</option>
                  {AS_TIMES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </>
            ) : (
              <select className="input-text" value={val(a).engineerId} onChange={(e) => put(a, { engineerId: e.target.value })}>
                <option value="">넘길 기사님 고르기</option>
                {mates.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
            <button type="button" className="btn-confirm" onClick={() => save(a)}>작성</button>
          </div>
        </div>
      ))}
      {photos && <PhotoViewer images={photos.images} start={0} title={photos.title} onClose={() => setPhotos(null)} />}
    </div>
  );
}

function MySchedules() {
  const { handleError } = useAuth();
  const asOn = currentHasFeature('asEngineer') && currentHasFeature('as');
  const [asItems, setAsItems] = useState([]);
  const loadAs = useCallback(() => {
    if (asOn) engineerApp.myAs().then(setAsItems).catch(() => {});
  }, [asOn]);
  useEffect(() => {
    loadAs();
  }, [loadAs]);
  useRefreshOnReturn(loadAs);
  const asPending = asItems.filter((a) => !a.visitDate).length;
  const [view, setView] = useState(memo.view); // calendar | upcoming | past
  const [ym, setYm] = useState(memo.ym || [new Date().getFullYear(), new Date().getMonth() + 1]);
  const [picked, setPicked] = useState(memo.date || today());
  const [list, setList] = useState([]);
  const [offs, setOffs] = useState([]);
  const [fairList, setFairList] = useState([]); // 내 박람회 일정 (본인이 포함된 것만)
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
    Promise.all([engineerApp.mySchedules({ from, to }), engineerApp.myOffs({ from, to }), engineerApp.myFairs({ from, to }).catch(() => [])])
      .then(([sch, off, fr]) => {
        setList(sch);
        setOffs(off);
        setFairList(fr);
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
    if (view !== 'calendar') fairList.forEach((f) => (map[f.date] = map[f.date] || []));
    list.forEach((s) => (view !== 'calendar' || s.date === picked) && (map[s.date] = map[s.date] || []).push(s));
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [list, offs, fairList, view, picked]);
  const offOf = (date) => offs.find((o) => o.date === date);
  const fairsOf = (date) => fairList.filter((f) => f.date <= date && (f.endDate || f.date) >= date);
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
        {asOn && (
          <label className={`radio-tag as-tag ${view === 'as' ? 'selected' : ''}`}>
            <input type="radio" checked={view === 'as'} onChange={() => setView('as')} /> AS관리{asItems.length > 0 && <b className="as-count">{asItems.length}</b>}
          </label>
        )}
      </div>
      {asPending > 0 && view !== 'calendar' && view !== 'as' && <AsAlert count={asPending} onOpen={() => setView('as')} />}
      {view === 'as' && <MyAsList items={asItems} onSaved={loadAs} />}

      {view === 'calendar' && (
        <>
          <div className="calendar-header-control">
            <button type="button" className="btn-month-nav" onClick={() => move(-1)} aria-label="이전 달">&lt;</button>
            <span className="current-year-month">{year}. {String(month).padStart(2, '0')}</span>
            <button type="button" className="btn-month-nav" onClick={() => move(1)} aria-label="다음 달">&gt;</button>
            <button type="button" className="btn-today-sm" onClick={goToday}>오늘</button>
          </div>
          {asPending > 0 && <AsAlert count={asPending} onOpen={() => setView('as')} />}
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
                    {fairsOf(date).length > 0 && <span className="fair-chip mini">박람회</span>}
                    {countOf[date] && <div className="schedule-badge">일정 {countOf[date]}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {view !== 'as' && grouped.length === 0 && <p className="no-data">배정된 일정이 없습니다.</p>}
      {view !== 'as' && grouped.map(([date, rows]) => (
        <section key={date}>
          <h4 className={`engineer-date ${date === today() ? 'is-today' : ''}`}>
            {formatKoreanDate(date)}
            {dayTag(date) && <span className={`day-tag ${date === today() ? 'today' : ''}`}>{dayTag(date)}</span>}
            {rows.length > 0 && <span className="sub-text"> {rows.length}건</span>}
            {offOf(date) && <span className={`off-chip off-${offOf(date).period}`}>{OFF_LABEL[offOf(date).period]} 휴무</span>}
          </h4>
          {offOf(date) && <div className="sub-text">휴무 사유: {offOf(date).reason}</div>}
          {fairsOf(date).map((f) => (
            <div key={`fair${f.id}`} className="day-fair-row">
              <span className="fair-chip">박람회</span>
              <strong className="fair-names">{f.label}</strong>
              {f.endDate && <span className="sub-text">({f.date} ~ {f.endDate})</span>}
            </div>
          ))}
          {rows.length === 0 && !offOf(date) && !fairsOf(date).length && (
            <div className="engineer-card empty">{date === today() ? '오늘' : '이 날'} 배정된 일정이 없습니다.</div>
          )}
          {rows.map((s) => (
            <ScheduleCard key={s.isAs ? `as-${s.contractId}-${s.asIndex}` : `${s.contractId}-${s.stepIndex}`} s={s} onReported={load} />
          ))}
        </section>
      ))}
    </div>
  );
}

// 일정 카드: 위쪽(현장·고객·내용)을 누르면 계약 상세로, 아래는 현장 보고
// 방문일을 등록한 AS: 일정 카드에 'AS' 로 표시 (시공 보고 대신 요청 내용)
function AsScheduleCard({ s }) {
  return (
    <div className="engineer-card as-schedule-card">
      <div className="engineer-card-top">
        <strong>{s.time || '시간 무관'}</strong>
        <span className="status-chip st-red">AS · {s.category}</span>
        <span className="as-step">AS</span>
      </div>
      <div className="bold-text">
        {s.address} <MapLink name={s.aptName} />
      </div>
      <div>
        {s.customerName} · <a href={`tel:${s.customerPhone}`}>{s.customerPhone}</a>
      </div>
      <div className="as-request-text">요청: {s.request}</div>
    </div>
  );
}

function ScheduleCard({ s, onReported }) {
  if (s.isAs) return <AsScheduleCard s={s} />;
  const open = () => navigateForward(`/m/contract/${s.contractId}?step=${s.stepIndex}`);
  return (
    <div className="engineer-card">
      <div className="engineer-card-link" role="button" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()}>
        <div className="engineer-card-top">
          <strong>{timeLabel(s) || '시간미정'}</strong>
          <span className="status-chip st-blue">{s.category} {s.workType !== '시공' ? `· ${s.workType}` : ''}</span>
          <span className="sub-text">{s.stepIndex + 1}차{s.viaTeam ? ` · ${s.teamName}` : ''}</span>
          <span className="engineer-card-more">상세 ›</span>
        </div>
        <div className="bold-text">
          {s.address}{' '}
          <span onClick={(e) => e.stopPropagation()}>
            <MapLink name={s.aptName} />
          </span>
        </div>
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
//   '시공완료'를 고르면 시공 범위 체크(한 것 / 못 한 것) + 사용 자재·색상 → 사무실에 '시공 기록'(누가·언제·무엇을·무엇으로)
const scopeKey = (g, p) => `${g}|${p}`;
// 시공완료 보고: 항목마다 완료 체크(기본 체크) + 자재·색상 + 작업자(팀장), 함께한 사람, 직접 적기
function ReportForm({ contractId, step, onReported }) {
  const { handleError, company } = useAuth();
  const materials = company?.scheduleSettings?.materials || DEFAULT_SCHEDULE_SETTINGS.materials; // 설정 > 일정관리설정의 시공 자재 목록
  const listId = `materials-${contractId}-${step.stepIndex}`;
  const [d, setD] = useState({ mobileStatus: step.mobileStatus || '', memo: step.mobileMemo || '' });
  const scope = step.scope || [];
  // 항목별 입력값 { [key]: { done, material, worker } } — 지난 기록이 있으면 그 값으로 시작
  const initialRows = () => {
    const rec = step.workRecord || {};
    const prev = new Map((rec.items || []).map((x) => [x.text, x]));
    const undone = new Set(rec.undone || []);
    return Object.fromEntries(
      scope.flatMap((g) =>
        g.parts.map((p) => {
          const old = prev.get(p);
          return [scopeKey(g.group, p), { done: old ? old.done !== false : !undone.has(p), material: old?.material || '', color: old?.color || '', worker: old?.worker || '' }];
        }),
      ),
    );
  };
  const [rows, setRows] = useState(initialRows);
  const [material, setMaterial] = useState(step.workRecord?.material || '');
  const [color, setColor] = useState(step.workRecord?.color || '');
  const [helpers, setHelpers] = useState(step.workRecord?.helpers || '');
  const [note, setNote] = useState(step.workRecord?.note || '');
  useEffect(() => {
    setD({ mobileStatus: step.mobileStatus || '', memo: step.mobileMemo || '' });
    setRows(initialRows());
    setMaterial(step.workRecord?.material || '');
    setColor(step.workRecord?.color || '');
    setHelpers(step.workRecord?.helpers || '');
    setNote(step.workRecord?.note || '');
  }, [step.mobileStatus, step.mobileMemo, step.workRecord]); // eslint-disable-line react-hooks/exhaustive-deps
  const setRow = (k, patch) => setRows((prev) => ({ ...prev, [k]: { ...prev[k], ...patch } }));
  const completing = d.mobileStatus === '시공완료' && currentHasFeature('workRecord'); // 기능 꺼진 업체는 기록 칸 없이 상태만 보고 / 상품이 없는 계약도 자재·함께한 사람·직접 적기 칸은 나옴

  const report = async () => {
    const items = scope.flatMap((g) => g.parts.map((p) => ({ text: p, ...(rows[scopeKey(g.group, p)] || { done: true }) })));
    const undone = items.filter((x) => !x.done).map((x) => x.text);
    if (completing && undone.length && !window.confirm(`체크하지 않은 항목 ${undone.length}개는 '미시공'으로 사무실에 보고됩니다.\n${undone.join(', ')}\n\n보고할까요?`)) return;
    try {
      await engineerApp.report({
        contractId,
        stepIndex: step.stepIndex,
        mobileStatus: d.mobileStatus,
        memo: d.memo,
        ...(completing ? { items, material, color, helpers, note } : {}),
      });
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
      {completing && (
        <div className="scope-check">
          <div className="scope-check-title">🧾 시공 기록</div>
          <input className="input-text full" placeholder="함께한 팀장·작업자 (예: 김민수 팀장, 이지훈)" value={helpers} onChange={(e) => setHelpers(e.target.value)} maxLength={200} />
          {scope.map((g) => (
            <div key={g.group} className="scope-group">
              <div className="scope-group-name">{g.group}</div>
              {g.parts.map((p) => {
                const k = scopeKey(g.group, p);
                const r = rows[k] || { done: true, material: '', color: '', worker: '' };
                return (
                  <div key={k} className={`scope-row ${r.done ? '' : 'undone'}`}>
                    <label className="scope-item">
                      <input type="checkbox" checked={r.done} onChange={(e) => setRow(k, { done: e.target.checked })} /> {p}
                    </label>
                    {r.done && (
                      <div className="scope-row-fields">
                        <input className="input-text mat" list={listId} placeholder="자재 (눌러서 고르기)" value={r.material} onChange={(e) => setRow(k, { material: e.target.value })} maxLength={100} />
                        <input className="input-text num" placeholder="번호" value={r.color} onChange={(e) => setRow(k, { color: e.target.value })} maxLength={30} />
                        <input className="input-text worker" placeholder="작업자(팀장)" value={r.worker} onChange={(e) => setRow(k, { worker: e.target.value })} maxLength={50} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <div className="scope-common">
            <span className="sub-text">{scope.length ? '공통 자재 (항목에 안 적으면 이것으로)' : '사용 자재'}</span>
            <div className="scope-row-fields">
              <input className="input-text mat" list={listId} placeholder="자재 (눌러서 고르기)" value={material} onChange={(e) => setMaterial(e.target.value)} maxLength={200} />
              <input className="input-text num" placeholder="번호" value={color} onChange={(e) => setColor(e.target.value)} maxLength={30} />
            </div>
          </div>
          <datalist id={listId}>
            {materials.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <textarea
            className="input-text full scope-note"
            rows={3}
            placeholder="직접 적기 (예: 고객 요청으로 현관 추가 시공, 샤워벽은 다음 방문)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
          {scope.length > 0 && <div className="sub-text">못 한 항목만 체크를 풀어 주세요. 작업자를 비워 두면 보고하는 본인으로 기록됩니다.</div>}
        </div>
      )}
      {step.workRecord && d.mobileStatus === '시공완료' && <WorkRecord record={step.workRecord} />}
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
    <button type="button" className="btn-back-engineer" onClick={() => goBack('/m')}>
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
            <td>
              {siteText(c)} <MapLink name={c.aptName} />
            </td>
          </tr>
          <tr>
            <th>입주예정일</th>
            <td colSpan={5}>{c.moveInDate}</td>
          </tr>
          <tr>
            <th>고객 참고사항</th>
            <td colSpan={5} className="pre-wrap">{c.customerNote}</td>
          </tr>
          {c.paperPhotoCount > 0 && (
            <tr>
              <th>실물 계약서</th>
              <td colSpan={5}>
                <EngineerPaper key={c.id} contract={c} />
              </td>
            </tr>
          )}
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
              <LineItems lines={c.lineItems} kind="패키지" />
            </td>
            <th>추가시공품목</th>
            <td>
              <LineItems lines={c.lineItems} kind="추가시공품목" extra={c.items} />
            </td>
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
                  <LineItems lines={x.lineItems} kind="패키지" withDetail={false} />
                </td>
                <td className="text-left items-cell">
                  <LineItems lines={x.lineItems} kind="추가시공품목" withDetail={false} extra={x.items} />
                </td>
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
  const { handleError, company } = useAuth();
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
      {/* 기사님에게만 보이는 곳: 기사모바일을 앱으로 설치 */}
      <InstallCard code={company?.code} app="engineer" />
    </div>
  );
}

// 기사모바일 계약 상세: 실물 계약서 사진 (보기만) — 들어오면 작은 사진이 바로, 누르면 크게·좌우로 넘김
function EngineerPaper({ contract }) {
  const [photos, setPhotos] = useState(null);
  const [view, setView] = useState(null);
  useEffect(() => {
    engineerApp
      .paperPhotos(contract.id)
      .then(setPhotos)
      .catch(() => setPhotos([]));
  }, [contract.id]);
  if (!photos) return <span className="sub-text">사진 불러오는 중...</span>;
  return (
    <div className="paper-panel">
      {photos.map((r, i) => (
        <span key={r.id} className="paper-thumb">
          <img src={r.image} alt={`실물 계약서 ${i + 1}`} onClick={() => setView(i)} />
        </span>
      ))}
      {view != null && <PhotoViewer images={photos.map((r) => r.image)} start={view} title={`${contract.customerName} 실물 계약서`} onClose={() => setView(null)} />}
    </div>
  );
}
