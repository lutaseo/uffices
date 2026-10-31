import React, { useCallback, useEffect, useState } from 'react';
import { apartments, engineers, products, scheduleSettings, teams } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { CATEGORIES, DEFAULT_SCHEDULE_SETTINGS, PRODUCT_KINDS } from '../../constants.js';
import { formatPhone, won } from '../../utils/format.js';
import Pagination from '../../components/Pagination.jsx';
import MoneyInput from '../../components/MoneyInput.jsx';
import { backdrop } from '../../utils/backdrop.js';
import { goBack, match, navigate, navigateForward } from '../../router.js';
import { REGIONS, SIDO_LIST } from '../../utils/regions.js';
import EngineerForm from './EngineerForm.jsx';
import { resetAptCache } from '../../components/AptSearchInput.jsx';

const PAGE_SIZE = 20;

// ------------------------------------------------------------
// 설정 > 기초코드 공통 화면 (목록 + 검색 + 등록/수정 모달)
//   columns: [{ key, label, render?, className? }]
//   fields:  [{ key, label, type: text|select|textarea|number|checkbox|tel, options?, required? }]
//   filters: [{ key, placeholder, options }]  → 드롭다운 필터
// ------------------------------------------------------------
//   onAdd/onEdit: 주면 팝업 대신 별도 화면으로 이동 (기사관리)
//   pagePath: 주면 등록/수정을 별도 화면(pagePath/new, pagePath/번호)으로 (상품·아파트)
//   fields type 추가: radio(options), custom(render(form, setField, rows)), textarea(rows), checkbox(note)
//   extraActions(reload): 목록 위에 추가 버튼, onChanged: 저장/삭제 후 호출
function MasterPage({ title, notices, api, columns, fields, filters = [], searchKeys, emptyForm, removeConfirm, onAdd, onEdit, pagePath, path = '', formTitle, extraActions, onChanged }) {
  const { handleError } = useAuth();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [applied, setApplied] = useState('');
  const [filterValues, setFilterValues] = useState({});
  const [page, setPage] = useState(1);
  const [form, setForm] = useState(null);

  const [loaded, setLoaded] = useState(false);
  const load = useCallback(
    () =>
      api
        .list({ includeInactive: true })
        .then((r) => {
          setRows(r);
          setLoaded(true);
          onChanged?.();
        })
        .catch(handleError),
    [api, handleError],
  );
  useEffect(() => {
    load();
  }, [load]);

  // 별도 화면 등록/수정: /settings/products/new, /settings/products/12
  const pageId = pagePath ? (match(`${pagePath}/new`, path) ? 'new' : match(`${pagePath}/:id`, path)?.id) : null;
  useEffect(() => {
    if (!pageId) return setForm(null);
    if (pageId === 'new') return setForm({ ...emptyForm });
    if (!loaded) return;
    const row = rows.find((r) => r.id === Number(pageId));
    if (row) setForm({ ...row });
    else navigate(pagePath, { replace: true });
  }, [pageId, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const openAdd = () => (pagePath ? navigateForward(`${pagePath}/new`) : onAdd ? onAdd() : setForm({ ...emptyForm }));
  const openEdit = (r) => (pagePath ? navigateForward(`${pagePath}/${r.id}`) : onEdit ? onEdit(r) : setForm({ ...r }));
  const closeForm = () => (pagePath ? goBack(pagePath) : setForm(null));

  // 번호: 업체 안에서 등록 순서대로 1, 2, 3 … (목록은 최신 번호가 위)
  const seq = new Map([...rows].sort((a, b) => a.id - b.id).map((r, i) => [r.id, i + 1]));
  const filtered = [...rows].sort((a, b) => b.id - a.id).filter(
    (r) =>
      (!applied || searchKeys.some((k) => String(r[k] ?? '').includes(applied))) &&
      filters.every((f) => !filterValues[f.key] || (f.match ? f.match(r, filterValues[f.key]) : String(r[f.key]) === filterValues[f.key])),
  );
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const save = async (e) => {
    e.preventDefault();
    try {
      await api.save(form);
      load();
      closeForm();
    } catch (err) {
      handleError(err);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(removeConfirm ? removeConfirm(row) : `[${row.name}] 을(를) 삭제하시겠습니까?`)) return;
    try {
      await api.remove(row.id);
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const renderField = (f) => {
    const value = form[f.key] ?? '';
    switch (f.type) {
      case 'select':
        return (
          <select className="input-text" value={value} onChange={(e) => setField(f.key, e.target.value)}>
            {f.options.map((o) => (
              <option key={o.value ?? o} value={o.value ?? o}>
                {o.label ?? o}
              </option>
            ))}
          </select>
        );
      case 'textarea':
        return <textarea className="input-text full" rows={f.rows || 3} value={value} onChange={(e) => setField(f.key, e.target.value)} />;
      case 'radio':
        return (
          <div className="radio-row">
            {f.options.map((o) => (
              <label key={o} className="radio-item">
                <input type="radio" checked={value === o} onChange={() => setField(f.key, o)} /> {o}
              </label>
            ))}
          </div>
        );
      case 'custom':
        return f.render(form, setField, rows);
      case 'checkbox':
        return (
          <label className="radio-item">
            <input type="checkbox" checked={value !== false} onChange={(e) => setField(f.key, e.target.checked)} /> {f.checkLabel}
            {f.note && <span className="field-note"> ⓘ {f.note}</span>}
          </label>
        );
      case 'password':
        return (
          <input
            type="password"
            className="input-text"
            value={value}
            autoComplete="new-password"
            placeholder={form.id && form.hasPassword ? '변경할 때만 입력' : ''}
            onChange={(e) => setField(f.key, e.target.value)}
          />
        );
      case 'money':
        return <MoneyInput value={value ?? ''} onChange={(v) => setField(f.key, v)} />;
      case 'tel':
        return <input type="tel" className="input-text" value={value} onChange={(e) => setField(f.key, formatPhone(e.target.value))} placeholder="010-0000-0000" required={f.required} />;
      default:
        return (
          <input
            type={f.type || 'text'}
            className={`input-text ${f.wide ? 'full' : ''}`}
            value={value}
            min={f.type === 'number' ? 0 : undefined}
            onChange={(e) => setField(f.key, e.target.value)}
            required={f.required}
          />
        );
    }
  };

  const formBody = form && (
    <form onSubmit={save} className="reg-table-form">
      <table className="form-grid-table master-form">
        <tbody>
          {fields.map((f) => (
            <tr key={f.key}>
              <td className="label-col">
                {f.label}
                {f.required && <span className="star">*</span>}
              </td>
              <td className="input-col">
                {renderField(f)}
                {f.help && <div className="sub-text">{f.help}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-bottom-btns">
        <button type="submit" className="btn-dark-lg sm">{pagePath ? '확인' : '저장'}</button>
        <button type="button" className="btn-dark-lg sm cancel" onClick={closeForm}>{pagePath ? '목록' : '취소'}</button>
      </div>
    </form>
  );

  if (pageId) {
    return (
      <div className="page-card">
        <h3 className="section-title">&gt; {formTitle || title} {pageId === 'new' ? '등록' : '수정'}</h3>
        {formBody || <div className="page-loading">불러오는 중...</div>}
      </div>
    );
  }

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>{title}</h2>
        <ul className="notice-list">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>

      <div className="customer-action-bar">
        {filters.map((f) => (
          <select
            key={f.key}
            className="input-select"
            value={filterValues[f.key] || ''}
            onChange={(e) => {
              setFilterValues({ ...filterValues, [f.key]: e.target.value });
              setPage(1);
            }}
          >
            <option value="">{f.placeholder}</option>
            {f.options.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ))}
        <form
          className="search-box"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(query.trim());
            setPage(1);
          }}
        >
          <input className="customer-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="검색어" />
          <button type="submit" className="btn-search-icon">🔍</button>
        </form>
        <button type="button" className="btn-add-customer" onClick={openAdd}>
          + 등록하기
        </button>
        {extraActions?.(load)}
        <span className="sub-text" style={{ marginLeft: 'auto', alignSelf: 'center' }}>총 {filtered.length}건</span>
      </div>

      <div className="table-responsive">
        <table className="customer-table">
          <thead>
            <tr>
              <th>번호</th>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="no-data">등록된 항목이 없습니다.</td>
              </tr>
            )}
            {pageRows.map((r) => (
              <tr
                key={r.id}
                className={`${r.active === false || r.visible === false ? 'inactive-row' : ''} ${onEdit || pagePath ? 'clickable-row' : ''}`}
                onClick={onEdit || pagePath ? (e) => !e.target.closest('button') && openEdit(r) : undefined}
              >
                <td>{seq.get(r.id)}</td>
                {columns.map((c) => (
                  <td key={c.key} className={c.className || ''}>
                    {c.render ? c.render(r) : r[c.key] || '-'}
                  </td>
                ))}
                <td>
                  <div className="table-action-btns">
                    <button type="button" className="btn-edit-icon" title="수정" onClick={() => openEdit(r)}>✏️</button>
                    <button type="button" className="btn-delete-icon" title="삭제" onClick={() => remove(r)}>🗑️</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onChange={setPage} />

      {form && !pagePath && (
        <div className="modal-overlay" {...backdrop(() => setForm(null))}>
          <div className="customer-reg-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-top-bar">
              <h3>&gt; {title} {form.id ? '수정' : '등록'}</h3>
              <button type="button" className="modal-close-x" onClick={() => setForm(null)}>&times;</button>
            </div>
            {formBody}
          </div>
        </div>
      )}
    </div>
  );
}

export function EngineerSettings({ path = '' }) {
  const [crewTeams, setCrewTeams] = useState([]);
  useEffect(() => {
    teams.list().then((t) => setCrewTeams(t.filter((x) => x.kind === '시공팀'))).catch(() => {});
  }, []);
  // /settings/engineers/new, /settings/engineers/:id → 기사 등록/수정 화면
  if (match('/settings/engineers/new', path)) return <EngineerForm />;
  const edit = match('/settings/engineers/:id', path);
  if (edit) return <EngineerForm key={edit.id} engineerId={edit.id} />;

  const teamName = (id) => crewTeams.find((t) => t.id === id)?.name || '-';
  return (
    <MasterPage
      title="기사 관리"
      notices={[
        '시공을 진행하는 기사 정보를 등록하는 페이지입니다. 계약 등록/일정관리에서 기사를 배정할 때 사용됩니다.',
        "아이디와 비밀번호를 등록하면 기사가 같은 로그인 화면에서 '기사모바일'(내 일정 확인, 시공상태 보고, 휴무 설정)을 사용할 수 있습니다.",
        '기사를 누르면 정보 수정과 휴무일 관리(달력)를 할 수 있습니다. 주소는 시공 현장과의 거리 확인에 사용됩니다.',
        '계약에 배정된 적이 있는 기사는 삭제 시 기록 보존을 위해 “미사용” 처리됩니다.',
      ]}
      api={engineers}
      searchKeys={['name', 'phone', 'loginId', 'address']}
      filters={[{ key: 'category', placeholder: '담당시공', options: CATEGORIES, match: (r, v) => (r.categories || []).includes(v) }]}
      removeConfirm={(r) => `[${r.name}] 기사를 삭제하시겠습니까?\n(배정 이력이 있으면 미사용 처리됩니다)`}
      onAdd={() => navigateForward('/settings/engineers/new')}
      onEdit={(r) => navigateForward(`/settings/engineers/${r.id}`)}
      columns={[
        { key: 'name', label: '이름', className: 'text-left bold-text' },
        { key: 'category', label: '담당시공' },
        { key: 'teamId', label: '소속팀', render: (r) => (r.teamId ? teamName(r.teamId) : '-') },
        { key: 'loginId', label: '아이디' },
        { key: 'hasPassword', label: '모바일 로그인', render: (r) => (r.loginId && r.hasPassword ? '가능' : <span className="sub-text">미설정</span>) },
        { key: 'phone', label: '연락처' },
        { key: 'address', label: '주소', className: 'text-left', render: (r) => [r.address, r.addressDetail].filter(Boolean).join(' ') || '-' },
        { key: 'active', label: '사용', render: (r) => (r.active === false ? <span className="text-red">미사용</span> : '사용') },
      ]}
      fields={[]}
    />
  );
}

export function TeamSettings() {
  return (
    <MasterPage
      title="팀 관리"
      notices={[
        '부서(상담팀/박람회팀 등)와 시공팀(스마일팀 등)을 관리합니다.',
        '부서는 사용자관리에서 직원에게, 시공팀은 기사관리에서 기사에게 지정하며 계약서의 [팀배정]에 사용됩니다.',
      ]}
      api={teams}
      searchKeys={['name', 'description']}
      emptyForm={{ name: '', kind: '부서', description: '' }}
      removeConfirm={(r) => `[${r.name}] 팀을 삭제하시겠습니까?\n소속된 사용자는 '팀 없음'으로 변경됩니다.`}
      columns={[
        { key: 'name', label: '팀명', className: 'bold-text' },
        { key: 'kind', label: '종류' },
        { key: 'description', label: '설명', className: 'text-left' },
      ]}
      fields={[
        { key: 'name', label: '팀명', required: true },
        { key: 'kind', label: '종류', type: 'select', options: ['부서', '시공팀'], help: "시공팀은 계약서 '팀배정'과 기사 소속팀에 사용됩니다." },
        { key: 'description', label: '설명', wide: true },
      ]}
    />
  );
}

const WORK_CATEGORIES = CATEGORIES.filter((c) => c !== '기타');

export function ProductSettings({ path = '' }) {
  return (
    <MasterPage
      title="상품관리"
      formTitle="상품"
      pagePath="/settings/products"
      path={path}
      notices={[
        '계약서 등록 시 사용되는 상품코드 관리 페이지입니다.',
        '상품을 미리 등록해 두면 계약 등록 시 [시공선택]의 패키지 · 추가시공품목 칸에서 골라 시공내용과 금액이 자동 입력됩니다.',
        '사용하지 않는 상품은 비활성화 하세요. 비활성화 하시면 계약서 작성 시 상품리스트에 표시되지 않습니다.',
      ]}
      api={products}
      searchKeys={['name', 'detail', 'freeDetail']}
      filters={[
        { key: 'category', placeholder: '시공 구분', options: WORK_CATEGORIES },
        { key: 'kind', placeholder: '상품 종류', options: PRODUCT_KINDS },
      ]}
      emptyForm={{ name: '', kind: PRODUCT_KINDS[0], category: WORK_CATEGORIES[0], detail: '', freeDetail: '', price: '', visible: true }}
      columns={[
        { key: 'name', label: '상품명', className: 'text-left' },
        { key: 'kind', label: '상품 종류' },
        { key: 'category', label: '시공 구분' },
        { key: 'detail', label: '상세품목', className: 'text-left' },
        { key: 'price', label: '금액', className: 'text-right', render: (r) => won(r.price) },
        { key: 'visible', label: '활성화', render: (r) => (r.visible === false ? <span className="text-red">비활성</span> : '활성') },
      ]}
      fields={[
        { key: 'name', label: '상품명', required: true },
        { key: 'kind', label: '상품 종류', type: 'radio', options: PRODUCT_KINDS.slice(0, 2), help: '계약 등록 [시공선택]에서 패키지 칸 / 추가시공품목 칸 중 어디에 나올지 정합니다.' },
        { key: 'category', label: '시공 구분', type: 'radio', options: WORK_CATEGORIES, help: '계약 등록의 시공 구분(줄눈·청소…)과 같습니다. 패키지는 같은 시공 구분일 때만 보입니다.' },
        { key: 'detail', label: '상세품목', type: 'textarea', rows: 10 },
        { key: 'freeDetail', label: '무료시공내역', type: 'textarea', rows: 10 },
        { key: 'price', label: '금액', type: 'money', help: '계약 등록 [시공선택]에서 이 상품을 고르면 이 금액이 단가로 들어갑니다.' },
        { key: 'visible', label: '활성화', type: 'checkbox', checkLabel: '활성화', note: '사용하지 않는 상품은 비활성화 하세요. 비활성화 하시면 계약서 작성 시 상품리스트에 표시되지 않습니다.' },
      ]}
    />
  );
}

// 아파트 등록: 지역코드(시/도 → 시/군/구) + 아파트명, 같은 지역·이름이 이미 있으면 안내
function RegionSelect(form, setField) {
  const sigungus = REGIONS[form.sido] || [];
  return (
    <div className="inline-fields">
      <select className="input-text" value={form.sido || ''} onChange={(e) => { setField('sido', e.target.value); setField('sigungu', ''); }}>
        <option value="">선택</option>
        {!SIDO_LIST.includes(form.sido) && form.sido && <option value={form.sido}>{form.sido}</option>}
        {SIDO_LIST.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <select className="input-text" value={form.sigungu || ''} onChange={(e) => setField('sigungu', e.target.value)}>
        <option value="">선택</option>
        {!sigungus.includes(form.sigungu) && form.sigungu && <option value={form.sigungu}>{form.sigungu}</option>}
        {sigungus.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    </div>
  );
}

function AptNameInput(form, setField, rows) {
  const name = String(form.name || '').trim();
  const dup = name && rows.find((r) => r.id !== form.id && r.name.trim() === name && (r.sido || '') === (form.sido || '') && (r.sigungu || '') === (form.sigungu || ''));
  return (
    <>
      <div className="inline-fields">
        <input className="input-text" value={form.name || ''} onChange={(e) => setField('name', e.target.value)} placeholder="아파트명" required />
        <span className="sub-text">ⓘ 기존 데이터와 지역코드, 아파트명이 일치하는 경우 아래영역에 안내문구가 표시됩니다.</span>
      </div>
      {dup && <div className="off-error">이미 등록된 아파트입니다: {[dup.sido, dup.sigungu, dup.name].filter(Boolean).join(' ')}</div>}
    </>
  );
}

export function ApartmentSettings({ path = '' }) {
  return (
    <MasterPage
      title="아파트 관리"
      formTitle="아파트"
      pagePath="/settings/apartments"
      path={path}
      notices={[
        '계약 등록 시 사용되는 아파트 기초코드입니다. 계약서 작성·계약 검색의 현장 칸에 글자 일부만 쳐도 여기 등록된 아파트가 추천됩니다.',
        '[계약에서 불러오기]를 누르면 지금까지 계약에 적힌 현장 이름 중 아직 없는 것을 한 번에 등록합니다. (지역은 나중에 수정)',
      ]}
      onChanged={resetAptCache}
      extraActions={(reload) => (
        <button
          type="button"
          className="btn-add-customer outline"
          onClick={async () => {
            try {
              const r = await apartments.fromContracts();
              alert(r.created ? `계약에 적힌 현장 ${r.created}곳을 아파트 목록에 등록했습니다.` : '새로 등록할 현장이 없습니다. (이미 모두 등록됨)');
              reload();
            } catch (e) {
              alert(e.message);
            }
          }}
        >
          계약에서 불러오기
        </button>
      )}
      api={apartments}
      searchKeys={['name', 'sido', 'sigungu']}
      filters={[{ key: 'sido', placeholder: '시/도', options: SIDO_LIST }]}
      emptyForm={{ sido: '', sigungu: '', name: '' }}
      columns={[
        { key: 'region', label: '지역', className: 'text-left', render: (r) => [r.sido, r.sigungu].filter(Boolean).join(' / ') || '-' },
        { key: 'name', label: '아파트', className: 'text-left' },
      ]}
      fields={[
        { key: 'region', label: '지역코드', type: 'custom', render: RegionSelect },
        { key: 'name', label: '아파트명', type: 'custom', render: AptNameInput },
      ]}
    />
  );
}

export function ScheduleSettings() {
  const { handleError, refresh } = useAuth();
  const [form, setForm] = useState(null);

  useEffect(() => {
    scheduleSettings.get().then(setForm).catch(handleError);
  }, [handleError]);

  if (!form) return <div className="page-card page-loading">불러오는 중...</div>;

  const save = async (e) => {
    e.preventDefault();
    try {
      await scheduleSettings.save(form);
      await refresh(); // 다른 화면의 시간 선택 목록에 바로 반영
      alert('저장되었습니다.');
    } catch (err) {
      handleError(err);
    }
  };

  const f = (key, props = {}) => (
    <input className="input-text" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} {...props} />
  );

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>일정관리설정</h2>
        <ul className="notice-list">
          <li>계약서/일정관리의 시간 선택 목록과 기사 휴무(오전/오후) 판단 기준을 설정합니다.</li>
          <li>기사 1인 하루 최대 배정 건수를 정하면 초과 배정이 차단됩니다. (0 = 제한 없음)</li>
        </ul>
      </div>
      <form onSubmit={save}>
        <table className="form-grid-table narrow-table">
          <tbody>
            <tr>
              <td className="label-col">오전/오후 기준</td>
              <td className="input-col">
                {f('amEnd', { type: 'time' })} 이전 시작 = 오전, 이후 = 오후
              </td>
            </tr>
            <tr>
              <td className="label-col">시간 선택 범위</td>
              <td className="input-col inline-fields">
                {f('startTime', { type: 'time' })} ~ {f('endTime', { type: 'time' })}
              </td>
            </tr>
            <tr>
              <td className="label-col">시간 간격</td>
              <td className="input-col">
                <select className="input-text" value={form.interval} onChange={(e) => setForm({ ...form, interval: Number(e.target.value) })}>
                  {[10, 15, 20, 30, 60].map((m) => <option key={m} value={m}>{m}분</option>)}
                </select>
              </td>
            </tr>
            <tr>
              <td className="label-col">하루 최대 배정</td>
              <td className="input-col">
                {f('maxPerDay', { type: 'number', min: 0, style: { width: 80 } })} 건 / 기사 1인
              </td>
            </tr>
          </tbody>
        </table>
        <div className="form-bottom-btns">
          <button type="submit" className="btn-dark-lg">저장</button>
          <button type="button" className="btn-dark-lg cancel" onClick={() => setForm({ ...DEFAULT_SCHEDULE_SETTINGS })}>기본값으로</button>
        </div>
      </form>
    </div>
  );
}
