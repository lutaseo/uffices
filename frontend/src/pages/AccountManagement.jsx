import React, { useCallback, useEffect, useState } from 'react';
import { companies as companyApi, contracts as contractApi, teams as teamApi, users as userApi } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  DATA_SCOPES,
  DEFAULT_MANAGER_PERMISSIONS,
  PERMISSIONS,
  ROLES,
  permissionsOf,
} from '../auth/permissions.js';
import { DEPARTMENTS, POSITIONS } from '../constants.js';
import { addDays, today } from '../utils/date.js';
import { formatPhone } from '../utils/format.js';
import { backdrop } from '../utils/backdrop.js';

export default function AccountManagement() {
  const { user } = useAuth();
  return user.role === ROLES.SUPER ? <SuperAdminView /> : <ManagerAccountsView />;
}

// ------------------------------------------------------------
// 운영자: 업체 + 업체 관리자 계정 발급
// ------------------------------------------------------------
function SuperAdminView() {
  const { handleError } = useAuth();
  const [list, setList] = useState([]);
  const [companyForm, setCompanyForm] = useState(null);
  const [adminForm, setAdminForm] = useState(null);

  const load = useCallback(() => companyApi.list().then(setList).catch(handleError), [handleError]);
  const [sampleBusy, setSampleBusy] = useState(null);

  // 시연용 샘플 계약 넣기/지우기 (가짜 이름·010-0000 번호, 변경이력·수정로그 안 남김)
  const addSample = async (c) => {
    const input = window.prompt(`[${c.name}] 에 시연용 샘플 계약을 몇 건 넣을까요? (최대 200)\n가짜 이름·010-0000-xxxx 번호로 만들고, 변경이력·수정로그는 남기지 않습니다.`, '100');
    if (input === null) return;
    setSampleBusy(c.id);
    try {
      const r = await contractApi.sampleAdd(c.id, Number(input));
      alert(`샘플 계약 ${r.created}건을 넣었습니다. (이 업체 샘플 합계 ${r.total}건)`);
      load();
    } catch (err) {
      handleError(err);
    } finally {
      setSampleBusy(null);
    }
  };
  const clearSample = async (c) => {
    if (!window.confirm(`[${c.name}] 의 샘플 계약을 모두 지울까요?\n직접 등록한 계약은 지우지 않습니다.`)) return;
    setSampleBusy(c.id);
    try {
      const r = await contractApi.sampleClear(c.id);
      alert(`샘플 계약 ${r.removed}건을 지웠습니다.`);
      load();
    } catch (err) {
      handleError(err);
    } finally {
      setSampleBusy(null);
    }
  };
  useEffect(() => {
    load();
  }, [load]);

  const openNewCompany = () =>
    setCompanyForm({
      id: null,
      code: '',
      name: '',
      ceo: '',
      bizNo: '',
      address: '',
      brands: '',
      periodStart: today(),
      periodEnd: addDays(today(), 365),
      adminLoginId: '',
      adminPassword: '',
      adminName: '',
      adminPhone: '',
    });

  const saveCompany = async (e) => {
    e.preventDefault();
    const f = companyForm;
    const company = {
      code: f.code,
      name: f.name,
      ceo: f.ceo,
      bizNo: f.bizNo,
      address: f.address,
      brands: f.brands.split(',').map((b) => b.trim()).filter(Boolean),
      periodStart: f.periodStart,
      periodEnd: f.periodEnd,
    };
    try {
      if (f.id) await companyApi.update(f.id, company);
      else {
        await companyApi.create({
          company,
          admin: { loginId: f.adminLoginId, password: f.adminPassword, name: f.adminName, phone: f.adminPhone },
        });
      }
      setCompanyForm(null);
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const toggleCompany = async (c) => {
    if (!window.confirm(`[${c.name}] 업체를 ${c.active ? '사용정지' : '사용재개'} 하시겠습니까?`)) return;
    try {
      await companyApi.update(c.id, { active: !c.active });
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const saveAdmin = async (e) => {
    e.preventDefault();
    try {
      if (adminForm.id) {
        await userApi.update(adminForm.id, { name: adminForm.name, phone: adminForm.phone, password: adminForm.password || undefined });
      } else {
        await userApi.create(adminForm);
      }
      setAdminForm(null);
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const toggleAdmin = async (a) => {
    try {
      await userApi.update(a.id, { active: !a.active });
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const copyUrl = (code) => {
    const url = `${window.location.origin}/${code}`;
    navigator.clipboard?.writeText(url).then(() => alert(`복사했습니다: ${url}`), () => prompt('주소를 복사하세요', url));
  };

  const t = today();

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>업체 / 관리자 계정 관리 (운영자)</h2>
        <ul className="notice-list">
          <li>업체를 등록하면 해당 업체의 관리자 계정이 함께 발급됩니다.</li>
          <li>관리자는 로그인 후 [계정관리]에서 실장 계정을 만들고 권한을 나눠줄 수 있습니다.</li>
          <li>이용기간이 지나거나 사용정지된 업체의 계정은 로그인할 수 없습니다.</li>
          <li>업체마다 <b>주소 코드</b>를 정하면 그 업체 직원·기사는 <b>{window.location.origin}/코드</b> 로 접속합니다. (예: /thegood)</li>
        </ul>
      </div>
      <div className="customer-action-bar">
        <button type="button" className="btn-add-customer" onClick={openNewCompany}>
          + 업체 등록
        </button>
      </div>

      <div className="table-responsive">
        <table className="customer-table">
          <thead>
            <tr>
              <th>업체명</th>
              <th>대표 / 사업자번호</th>
              <th>이용기간</th>
              <th>상태</th>
              <th>관리자 계정</th>
              <th>실장 수</th>
              <th>계약 수</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const expired = c.periodEnd < t;
              return (
                <tr key={c.id}>
                  <td className="bold-text">
                    {c.name}
                    <div className="sub-text">브랜드: {c.brands.join(', ')}</div>
                    {c.code ? (
                      <div className="company-url">
                        <a href={`/${c.code}`} target="_blank" rel="noreferrer">{window.location.host}/{c.code}</a>
                        <button type="button" className="btn-link" onClick={() => copyUrl(c.code)}>복사</button>
                      </div>
                    ) : (
                      <div className="text-red sub-text">주소 코드 미설정 — [수정/연장]에서 정해 주세요</div>
                    )}
                  </td>
                  <td>
                    {c.ceo}
                    <div className="sub-text">{c.bizNo}</div>
                  </td>
                  <td className={expired ? 'text-red' : ''}>
                    {c.periodStart} ~ {c.periodEnd}
                    {expired && <div>만료</div>}
                  </td>
                  <td>{c.active ? '사용중' : <span className="text-red">정지</span>}</td>
                  <td className="text-left">
                    {c.admins.map((a) => (
                      <div key={a.id} className="admin-line">
                        <span className={a.active ? '' : 'strike'}>
                          {a.name} ({a.loginId})
                        </span>
                        <button type="button" className="btn-link" onClick={() => setAdminForm({ ...a, password: '' })}>
                          수정
                        </button>
                        <button type="button" className="btn-link" onClick={() => toggleAdmin(a)}>
                          {a.active ? '중지' : '재개'}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => setAdminForm({ id: null, companyId: c.id, loginId: '', password: '', name: '', phone: '' })}
                    >
                      + 관리자 추가
                    </button>
                  </td>
                  <td>{c.managerCount}</td>
                  <td>
                    {c.contractCount}
                    <div className="sample-actions">
                      <button type="button" className="btn-link" disabled={sampleBusy === c.id} onClick={() => addSample(c)}>
                        {sampleBusy === c.id ? '처리 중…' : '+ 시연 샘플'}
                      </button>
                      <button type="button" className="btn-link" disabled={sampleBusy === c.id} onClick={() => clearSample(c)}>
                        샘플 지우기
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn-dark-action"
                        onClick={() => setCompanyForm({ ...c, code: c.code || '', brands: c.brands.join(', ') })}
                      >
                        수정/연장
                      </button>
                      <button type="button" className="btn-outline-action" onClick={() => toggleCompany(c)}>
                        {c.active ? '정지' : '재개'}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {companyForm && (
        <FormModal title={companyForm.id ? '업체 수정 / 이용기간 연장' : '업체 등록 + 관리자 계정 발급'} onClose={() => setCompanyForm(null)} onSubmit={saveCompany}>
          <Row label="주소 코드 *">
            <span className="sub-text">{window.location.host}/</span>
            <input
              className="input-text"
              value={companyForm.code}
              onChange={(e) => setCompanyForm({ ...companyForm, code: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
              placeholder="예: thegood"
              maxLength={20}
              required
            />
            <div className="sub-text">영문 소문자·숫자·- (2~20자). 이 업체 직원·기사가 접속하는 주소입니다.{companyForm.id && ' 바꾸면 예전 주소는 쓸 수 없게 됩니다.'}</div>
          </Row>
          <Row label="업체명 *">
            <input className="input-text addr-input" value={companyForm.name} onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })} required />
          </Row>
          <Row label="대표 / 사업자번호">
            <input className="input-text" placeholder="대표자명" value={companyForm.ceo} onChange={(e) => setCompanyForm({ ...companyForm, ceo: e.target.value })} />
            <input className="input-text" placeholder="000-00-00000" value={companyForm.bizNo} onChange={(e) => setCompanyForm({ ...companyForm, bizNo: e.target.value })} />
          </Row>
          <Row label="주소">
            <input className="input-text full" value={companyForm.address} onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })} />
          </Row>
          <Row label="브랜드">
            <input className="input-text full" placeholder="쉼표로 구분 (예: 더좋은집, 더스타트)" value={companyForm.brands} onChange={(e) => setCompanyForm({ ...companyForm, brands: e.target.value })} />
          </Row>
          <Row label="이용기간 *">
            <input type="date" className="input-text" value={companyForm.periodStart} onChange={(e) => setCompanyForm({ ...companyForm, periodStart: e.target.value })} required />
            ~
            <input type="date" className="input-text" value={companyForm.periodEnd} onChange={(e) => setCompanyForm({ ...companyForm, periodEnd: e.target.value })} required />
          </Row>
          {!companyForm.id && (
            <>
              <Row label="관리자 아이디 *">
                <input className="input-text" value={companyForm.adminLoginId} onChange={(e) => setCompanyForm({ ...companyForm, adminLoginId: e.target.value })} required />
                <input type="password" className="input-text" placeholder="초기 비밀번호" value={companyForm.adminPassword} onChange={(e) => setCompanyForm({ ...companyForm, adminPassword: e.target.value })} required autoComplete="new-password" />
              </Row>
              <Row label="관리자 이름 *">
                <input className="input-text" value={companyForm.adminName} onChange={(e) => setCompanyForm({ ...companyForm, adminName: e.target.value })} required />
                <input className="input-text" placeholder="연락처" value={companyForm.adminPhone} onChange={(e) => setCompanyForm({ ...companyForm, adminPhone: formatPhone(e.target.value) })} />
              </Row>
            </>
          )}
        </FormModal>
      )}

      {adminForm && (
        <FormModal title={adminForm.id ? '관리자 계정 수정' : '관리자 계정 추가'} onClose={() => setAdminForm(null)} onSubmit={saveAdmin}>
          <Row label="아이디 *">
            {adminForm.id ? (
              adminForm.loginId
            ) : (
              <input className="input-text" value={adminForm.loginId} onChange={(e) => setAdminForm({ ...adminForm, loginId: e.target.value })} required />
            )}
          </Row>
          <Row label={adminForm.id ? '비밀번호 재설정' : '비밀번호 *'}>
            <input
              type="password"
              className="input-text"
              placeholder={adminForm.id ? '변경할 때만 입력' : ''}
              value={adminForm.password}
              onChange={(e) => setAdminForm({ ...adminForm, password: e.target.value })}
              required={!adminForm.id}
              autoComplete="new-password"
            />
          </Row>
          <Row label="이름 / 연락처 *">
            <input className="input-text" value={adminForm.name} onChange={(e) => setAdminForm({ ...adminForm, name: e.target.value })} required />
            <input className="input-text" value={adminForm.phone} onChange={(e) => setAdminForm({ ...adminForm, phone: formatPhone(e.target.value) })} />
          </Row>
        </FormModal>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// 관리자: 실장 계정 발급 및 권한 위임
// ------------------------------------------------------------
function ManagerAccountsView() {
  const { user, handleError } = useAuth();
  const [list, setList] = useState([]);
  const [form, setForm] = useState(null);
  const [teamList, setTeamList] = useState([]);
  const [query, setQuery] = useState('');
  const grantable = permissionsOf(user);

  const load = useCallback(() => userApi.list().then(setList).catch(handleError), [handleError]);
  useEffect(() => {
    load();
    teamApi.list().then(setTeamList).catch(() => {});
  }, [load]);

  const teamName = (id) => teamList.find((t) => t.id === id)?.name || '';
  // 번호: 등록 순서대로 1, 2, 3 … (목록은 최신 번호가 위)
  const seq = new Map([...list].sort((a, b) => a.id - b.id).map((m, i) => [m.id, i + 1]));
  const shown = [...list].sort((a, b) => b.id - a.id).filter((m) => !query || m.name.includes(query) || m.loginId.includes(query));

  const openNew = () =>
    setForm({
      id: null,
      loginId: '',
      password: '',
      name: '',
      phone: '',
      permissions: DEFAULT_MANAGER_PERMISSIONS,
      dataScope: DATA_SCOPES.ALL,
      teamId: '',
      department: '',
      position: '실장',
    });

  const togglePerm = (key) =>
    setForm((prev) => ({
      ...prev,
      permissions: prev.permissions.includes(key) ? prev.permissions.filter((p) => p !== key) : [...prev.permissions, key],
    }));

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) {
        await userApi.update(form.id, {
          name: form.name,
          phone: form.phone,
          permissions: form.permissions,
          dataScope: form.dataScope,
          teamId: form.teamId,
          department: form.department,
          position: form.position,
          password: form.password || undefined,
        });
      } else {
        await userApi.create(form);
      }
      setForm(null);
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const toggleActive = async (m) => {
    if (!window.confirm(`[${m.name}] 계정을 ${m.active ? '사용중지' : '사용재개'} 하시겠습니까?`)) return;
    try {
      await userApi.update(m.id, { active: !m.active });
      load();
    } catch (err) {
      handleError(err);
    }
  };

  const groups = [...new Set(PERMISSIONS.map((p) => p.group))];

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>사용자관리</h2>
        <ul className="notice-list">
          <li>유피스 PC 및 박람회 태블릿에서 전자계약 시스템을 사용할 직원 계정을 등록/관리합니다.</li>
          <li>실장 계정을 만들고 메뉴별 권한을 체크해 위임합니다. 체크하지 않은 메뉴는 실장 화면에 보이지 않습니다.</li>
          <li>데이터 범위를 “본인 작성 건만”으로 설정하면 실장은 자기가 등록한 계약만 조회/수정할 수 있습니다.</li>
        </ul>
      </div>
      <div className="customer-action-bar">
        <div className="search-box">
          <input className="customer-search-input" placeholder="이름/아이디" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button type="button" className="btn-search-icon">🔍</button>
        </div>
        <button type="button" className="btn-add-customer" onClick={openNew}>
          + 사용자 등록
        </button>
      </div>

      <div className="table-responsive">
        <table className="customer-table user-list-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>아이디</th>
              <th>이름</th>
              <th>부서/직책</th>
              <th>연락처</th>
              <th>데이터 범위</th>
              <th>권한</th>
              <th>최근 로그인</th>
              <th>상태</th>
              <th>관리</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={10} className="no-data">등록된 사용자가 없습니다.</td>
              </tr>
            )}
            {shown.map((m) => (
              <tr key={m.id}>
                <td>{seq.get(m.id)}</td>
                <td>{m.loginId}</td>
                <td className="bold-text">{m.name}</td>
                <td>{[m.department || teamName(m.teamId), m.position].filter(Boolean).join(' / ') || '-'}</td>
                <td>{m.phone || '-'}</td>
                <td>{m.dataScope === DATA_SCOPES.OWN ? '본인 작성 건만' : '업체 전체'}</td>
                <td className="text-left perm-summary">
                  {PERMISSIONS.filter((p) => m.permissions.includes(p.key)).map((p) => (
                    <span key={p.key} className={`perm-chip ${p.key === 'sales.total' ? 'strong' : ''}`} title={p.label}>
                      {p.short || p.label}
                    </span>
                  ))}
                </td>
                <td>{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString('ko-KR') : '-'}</td>
                <td>{m.active ? '사용중' : <span className="text-red">중지</span>}</td>
                <td>
                  <div className="row-actions">
                    <button type="button" className="btn-dark-action" onClick={() => setForm({ ...m, password: '' })}>
                      권한수정
                    </button>
                    <button type="button" className="btn-outline-action" onClick={() => toggleActive(m)}>
                      {m.active ? '중지' : '재개'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <FormModal title={form.id ? `사용자 수정 — ${form.name}` : '사용자 등록'} onClose={() => setForm(null)} onSubmit={save}>
          <Row label="아이디 *">
            {form.id ? form.loginId : <input className="input-text" value={form.loginId} onChange={(e) => setForm({ ...form, loginId: e.target.value })} required />}
          </Row>
          <Row label={form.id ? '비밀번호 재설정' : '비밀번호 *'}>
            <input
              type="password"
              className="input-text"
              placeholder={form.id ? '변경할 때만 입력' : ''}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required={!form.id}
              autoComplete="new-password"
            />
          </Row>
          <Row label="이름 / 연락처 *">
            <input className="input-text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <input className="input-text" placeholder="010-0000-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })} />
          </Row>
          <Row label="부서 / 직책">
            <select className="input-text" value={form.department || ''} onChange={(e) => setForm({ ...form, department: e.target.value })}>
              <option value="">선택하세요</option>
              {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="input-text" value={form.position || ''} onChange={(e) => setForm({ ...form, position: e.target.value })}>
              <option value="">선택하세요</option>
              {form.position && !POSITIONS.includes(form.position) && <option value={form.position}>{form.position}</option>}
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Row>
          <Row label="데이터 범위">
            <label className="radio-item">
              <input type="radio" checked={form.dataScope === DATA_SCOPES.ALL} onChange={() => setForm({ ...form, dataScope: DATA_SCOPES.ALL })} />
              업체 전체 계약
            </label>
            <label className="radio-item">
              <input type="radio" checked={form.dataScope === DATA_SCOPES.OWN} onChange={() => setForm({ ...form, dataScope: DATA_SCOPES.OWN })} />
              본인 작성 계약만
            </label>
          </Row>
          <Row label="메뉴 권한">
            <div className="perm-grid">
              {groups.map((g) => (
                <div key={g} className="perm-group">
                  <div className="perm-group-title">{g}</div>
                  {PERMISSIONS.filter((p) => p.group === g).map((p) => (
                    <label key={p.key} className={`perm-check ${grantable.includes(p.key) ? '' : 'disabled'}`}>
                      <input
                        type="checkbox"
                        checked={form.permissions.includes(p.key)}
                        disabled={!grantable.includes(p.key)}
                        onChange={() => togglePerm(p.key)}
                      />
                      {p.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </Row>
        </FormModal>
      )}
    </div>
  );
}

function FormModal({ title, onClose, onSubmit, children }) {
  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="customer-reg-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-top-bar">
          <h3>&gt; {title}</h3>
          <button type="button" className="modal-close-x" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={onSubmit} className="reg-table-form">
          <table className="form-grid-table">
            <tbody>{children}</tbody>
          </table>
          <div className="form-bottom-btns">
            <button type="submit" className="btn-dark-lg">저장</button>
            <button type="button" className="btn-dark-lg cancel" onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <tr>
      <td className="label-col">{label}</td>
      <td className="input-col inline-fields">{children}</td>
    </tr>
  );
}
