import React, { useCallback, useEffect, useState } from 'react';
import { engineerOffs, engineers, teams } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ROLES } from '../../auth/permissions.js';
import { CATEGORIES, OFF_LABEL } from '../../constants.js';
import { WEEKDAYS, toDateKey } from '../../utils/date.js';
import { digitsOnly } from '../../utils/format.js';
import { openPostcode } from '../../utils/postcode.js';
import { goBack, navigate } from '../../router.js';
import OffModal from '../../components/OffModal.jsx';

// 설정 > 기사관리 > 기사 등록/수정 (/settings/engineers/new, /settings/engineers/:id)
const LIST_PATH = '/settings/engineers';
const WORK_CATEGORIES = CATEGORIES.filter((c) => c !== '기타');
const EMAIL_DOMAINS = ['naver.com', 'gmail.com', 'daum.net', 'hanmail.net', 'nate.com', 'kakao.com'];

const splitPhone = (phone = '') => {
  const d = digitsOnly(phone);
  if (!d) return ['010', '', ''];
  const head = d.startsWith('02') ? 2 : 3;
  const mid = d.length - head - 4;
  return [d.slice(0, head), d.slice(head, head + mid), d.slice(head + mid)];
};

const splitEmail = (email = '') => {
  const [local = '', domain = ''] = email.split('@');
  return { local, domain };
};

const toForm = (e) => {
  const [p1, p2, p3] = splitPhone(e?.phone);
  const { local, domain } = splitEmail(e?.email);
  return {
    id: e?.id,
    loginId: e?.loginId || '',
    hasLoginId: !!e?.loginId,
    password: '',
    hasPassword: !!e?.hasPassword,
    name: e?.name || '',
    categories: e?.categories?.length ? e.categories : [],
    p1,
    p2,
    p3,
    emailLocal: local,
    emailDomain: domain,
    zipcode: e?.zipcode || '',
    address: e?.address || '',
    addressDetail: e?.addressDetail || '',
    teamId: e?.teamId ? String(e.teamId) : '',
    memo: e?.memo || '',
    active: e ? e.active !== false : true,
  };
};

export default function EngineerForm({ engineerId }) {
  const { handleError, user } = useAuth();
  const canEditLoginId = user.role === ROLES.ADMIN; // 이미 정한 기사 아이디는 업체 관리자만 바꿀 수 있음
  const isNew = !engineerId;
  const [form, setForm] = useState(isNew ? toForm(null) : null);
  const [crewTeams, setCrewTeams] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    teams.list().then((t) => setCrewTeams(t.filter((x) => x.kind === '시공팀'))).catch(() => {});
    if (isNew) return;
    engineers
      .list({ includeInactive: true })
      .then((rows) => {
        const e = rows.find((r) => r.id === Number(engineerId));
        if (!e) {
          alert('기사를 찾을 수 없습니다.');
          navigate(LIST_PATH, { replace: true });
          return;
        }
        setForm(toForm(e));
      })
      .catch(handleError);
  }, [engineerId, isNew, handleError]);

  if (!form) return <div className="page-card">불러오는 중...</div>;

  const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));
  const toggleCategory = (c) =>
    set('categories', form.categories.includes(c) ? form.categories.filter((x) => x !== c) : WORK_CATEGORIES.filter((x) => x === c || form.categories.includes(x)));

  const searchAddress = () =>
    openPostcode(({ zipcode, address }) => setForm((prev) => ({ ...prev, zipcode, address }))).catch((e) => alert(e.message));

  const submit = async (e) => {
    e.preventDefault();
    const phone = [form.p1, form.p2, form.p3].map(digitsOnly).join('');
    setSaving(true);
    try {
      await engineers.save({
        id: form.id,
        loginId: form.loginId,
        password: form.password,
        name: form.name,
        categories: form.categories,
        phone,
        email: form.emailLocal && form.emailDomain ? `${form.emailLocal.trim()}@${form.emailDomain.trim()}` : '',
        zipcode: form.zipcode,
        address: form.address,
        addressDetail: form.addressDetail,
        teamId: form.teamId,
        memo: form.memo,
        active: form.active,
      });
      goBack(LIST_PATH);
    } catch (err) {
      handleError(err);
    } finally {
      setSaving(false);
    }
  };

  const domainPreset = EMAIL_DOMAINS.includes(form.emailDomain) ? form.emailDomain : '';

  return (
    <div className="page-card engineer-form-page">
      <h3 className="section-title">&gt; 기사 {isNew ? '등록' : '수정'}</h3>
      <form onSubmit={submit} className="reg-table-form">
        <table className="form-grid-table engineer-form">
          <tbody>
            <tr>
              <td className="label-col">기사 아이디</td>
              <td className="input-col">
                {form.hasLoginId && !canEditLoginId ? (
                  <span className="plain-value">{form.loginId}</span>
                ) : (
                  <>
                    <input className="input-text" value={form.loginId} onChange={(e) => set('loginId', e.target.value.trim())} autoComplete="off" />
                    <span className="sub-text"> 기사모바일 로그인용 (영문/숫자 3~20자){form.hasLoginId && ' · 바꾸면 기사는 새 아이디로 로그인합니다 (비밀번호는 그대로)'}</span>
                  </>
                )}
              </td>
            </tr>
            <tr>
              <td className="label-col">비밀번호</td>
              <td className="input-col">
                <input
                  type="password"
                  className="input-text"
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  autoComplete="new-password"
                  placeholder={form.hasPassword ? '변경할 때만 입력' : '4자 이상'}
                />
              </td>
            </tr>
            <tr>
              <td className="label-col">
                이름<span className="star">*</span>
              </td>
              <td className="input-col">
                <input className="input-text" value={form.name} onChange={(e) => set('name', e.target.value)} required />
              </td>
            </tr>
            <tr>
              <td className="label-col">담당시공</td>
              <td className="input-col check-row">
                {WORK_CATEGORIES.map((c) => (
                  <label key={c} className="radio-item">
                    <input type="checkbox" checked={form.categories.includes(c)} onChange={() => toggleCategory(c)} /> {c}
                  </label>
                ))}
              </td>
            </tr>
            <tr>
              <td className="label-col">
                핸드폰<span className="star">*</span>
              </td>
              <td className="input-col phone-3">
                <input className="input-text" inputMode="numeric" maxLength={3} value={form.p1} onChange={(e) => set('p1', digitsOnly(e.target.value))} required />
                <span>-</span>
                <input className="input-text" inputMode="numeric" maxLength={4} value={form.p2} onChange={(e) => set('p2', digitsOnly(e.target.value))} required />
                <span>-</span>
                <input className="input-text" inputMode="numeric" maxLength={4} value={form.p3} onChange={(e) => set('p3', digitsOnly(e.target.value))} required />
              </td>
            </tr>
            <tr>
              <td className="label-col">이메일</td>
              <td className="input-col email-row">
                <input className="input-text" value={form.emailLocal} onChange={(e) => set('emailLocal', e.target.value.replace(/[@\s]/g, ''))} />
                <span>@</span>
                <input className="input-text" value={form.emailDomain} onChange={(e) => set('emailDomain', e.target.value.replace(/[@\s]/g, ''))} readOnly={!!domainPreset} />
                <select className="input-text" value={domainPreset} onChange={(e) => set('emailDomain', e.target.value)}>
                  <option value="">직접입력</option>
                  {EMAIL_DOMAINS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td className="label-col">주소</td>
              <td className="input-col address-row">
                <button type="button" className="btn-postcode" onClick={searchAddress}>우편번호</button>
                <input className="input-text zip" value={form.zipcode} onChange={(e) => set('zipcode', digitsOnly(e.target.value))} inputMode="numeric" maxLength={5} />
                <input className="input-text addr1" value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="주소 1" />
                <input className="input-text addr2" value={form.addressDetail} onChange={(e) => set('addressDetail', e.target.value)} placeholder="주소 2" />
              </td>
            </tr>
            <tr>
              <td className="label-col">소속 시공팀</td>
              <td className="input-col">
                <select className="input-text" value={form.teamId} onChange={(e) => set('teamId', e.target.value)}>
                  <option value="">없음</option>
                  {crewTeams.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <span className="sub-text"> 팀배정된 일정은 소속 기사 모두의 기사모바일에 표시됩니다.</span>
              </td>
            </tr>
            <tr>
              <td className="label-col">사용여부</td>
              <td className="input-col">
                <label className="radio-item">
                  <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} /> 사용 (해제 시 배정 목록에서 제외)
                </label>
              </td>
            </tr>
            <tr>
              <td className="label-col">기사 휴무일 관리</td>
              <td className="input-col">
                {isNew ? (
                  <p className="sub-text">ⓘ 기사를 먼저 등록(확인)한 뒤, 목록에서 기사를 눌러 휴무일을 지정할 수 있습니다.</p>
                ) : (
                  <OffCalendars engineer={{ id: form.id, name: form.name }} />
                )}
              </td>
            </tr>
          </tbody>
        </table>
        <div className="form-bottom-btns">
          <button type="submit" className="btn-dark-lg sm" disabled={saving}>{saving ? '저장 중...' : '확인'}</button>
          <button type="button" className="btn-dark-lg sm cancel" onClick={() => goBack(LIST_PATH)}>취소</button>
        </div>
      </form>
    </div>
  );
}

// 기사 휴무일 달력: 년/월 선택 후 [달력추가] → 날짜 클릭 → 휴무 등록/수정/취소 (바로 저장)
function OffCalendars({ engineer }) {
  const { handleError } = useAuth();
  const now = new Date();
  const [pickYear, setPickYear] = useState(now.getFullYear());
  const [pickMonth, setPickMonth] = useState(now.getMonth() + 1);
  const [months, setMonths] = useState(() => {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return [
      [now.getFullYear(), now.getMonth() + 1],
      [next.getFullYear(), next.getMonth() + 1],
    ];
  });
  const [offs, setOffs] = useState([]);
  const [target, setTarget] = useState(null);

  const first = months[0];
  const last = months[months.length - 1];
  const from = toDateKey(new Date(first[0], first[1] - 1, 1));
  const to = toDateKey(new Date(last[0], last[1], 0));

  const load = useCallback(
    () => engineerOffs.list({ engineerId: engineer.id, from, to }).then(setOffs).catch(handleError),
    [engineer.id, from, to, handleError],
  );
  useEffect(() => {
    load();
  }, [load]);

  const addMonth = () => {
    if (months.some(([y, m]) => y === pickYear && m === pickMonth)) return;
    setMonths([...months, [pickYear, pickMonth]].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  };
  const removeMonth = (y, m) => setMonths(months.filter(([yy, mm]) => !(yy === y && mm === m)));

  const offOn = (date) => offs.find((o) => o.date === date);

  const save = async ({ period, reason }) => {
    await engineerOffs.set({ engineerId: engineer.id, date: target, period, reason });
    setTarget(null);
    load();
  };
  const cancel = async () => {
    await engineerOffs.remove({ engineerId: engineer.id, date: target });
    setTarget(null);
    load();
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1, now.getFullYear() + 2];

  return (
    <div className="off-calendars-box">
      <p className="off-cal-guide">
        ⓘ 기사 휴무일 지정을 위해서는 먼저 아래 달력을 추가 &gt; 해당월의 해당일 클릭 &gt; 클릭 후 팝업창에서 내용에 맞게 입력 후 저장버튼 클릭
      </p>
      <div className="off-cal-controls">
        <select className="input-text" value={pickYear} onChange={(e) => setPickYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
        <select className="input-text" value={pickMonth} onChange={(e) => setPickMonth(Number(e.target.value))}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{m}월</option>
          ))}
        </select>
        <button type="button" className="btn-add-calendar" onClick={addMonth}>+ 달력추가</button>
        <span className="off-legend">
          <i className="lg-DAY" /> 종일 <i className="lg-AM" /> 오전 <i className="lg-PM" /> 오후
        </span>
      </div>
      <div className="off-cal-list">
        {months.map(([y, m]) => (
          <MonthCalendar key={`${y}-${m}`} year={y} month={m} offOn={offOn} onPick={setTarget} onRemove={months.length > 1 ? () => removeMonth(y, m) : null} />
        ))}
      </div>
      {target && (
        <OffModal date={target} existingFor={() => offOn(target)} onSave={save} onCancelOff={cancel} onClose={() => setTarget(null)} />
      )}
    </div>
  );
}

function MonthCalendar({ year, month, offOn, onPick, onRemove }) {
  const cells = [];
  for (let i = 0; i < new Date(year, month - 1, 1).getDay(); i++) cells.push(null);
  for (let d = 1; d <= new Date(year, month, 0).getDate(); d++) cells.push(toDateKey(new Date(year, month - 1, d)));
  while (cells.length < 42) cells.push(null);
  return (
    <div className="off-month">
      <div className="off-month-title">
        {year}.{month}
        {onRemove && (
          <button type="button" className="off-month-remove" title="달력 빼기" onClick={onRemove}>&times;</button>
        )}
      </div>
      <table className="off-month-table">
        <thead>
          <tr>
            {WEEKDAYS.map((w, i) => (
              <th key={w} className={i === 0 ? 'sun' : ''}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, r) => (
            <tr key={r}>
              {cells.slice(r * 7, r * 7 + 7).map((date, i) => {
                if (!date) return <td key={i} />;
                const off = offOn(date);
                return (
                  <td
                    key={date}
                    className={`day ${off ? `off off-${off.period}` : ''}`}
                    title={off ? `${OFF_LABEL[off.period]} 휴무: ${off.reason}` : '눌러서 휴무 등록'}
                    onClick={() => onPick(date)}
                  >
                    {Number(date.slice(8))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
