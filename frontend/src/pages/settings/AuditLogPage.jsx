import React, { useEffect, useMemo, useState } from 'react';
import { auditLogs } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { addDays, today } from '../../utils/date.js';

// 설정 > 수정로그 (업체 관리자): 누가 언제 무엇을 바꿨는지 — 최근 2주만 보관
const ROLE_LABEL = { ADMIN: '관리자', MANAGER: '실장', ENGINEER: '기사', CUSTOMER: '고객', SUPER: '운영자' };
const TYPE_CLASS = { 추가: 'text-done', 삭제: 'text-red', 수정: '' };

const timeText = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function AuditLogPage() {
  const { handleError } = useAuth();
  const [filter, setFilter] = useState({ from: addDays(today(), -13), to: today(), actor: '', q: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = async (f = filter) => {
    setLoading(true);
    try {
      setData(await auditLogs.list(f));
    } catch (e) {
      handleError(e);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 사람 선택 목록: 지금까지 받은 기록에서
  const [people, setPeople] = useState([]);
  useEffect(() => {
    if (!data?.rows) return;
    setPeople((prev) => {
      const map = new Map(prev.map((p) => [p.key, p]));
      data.rows.forEach((r) => {
        const key = `${r.actor?.kind}:${r.actor?.id}`;
        if (!map.has(key)) map.set(key, { key, label: `${r.actor?.name || '-'} (${ROLE_LABEL[r.actor?.role] || ''})` });
      });
      return [...map.values()];
    });
  }, [data]);

  const set = (k, v) => setFilter((f) => ({ ...f, [k]: v }));
  const search = (e) => {
    e.preventDefault();
    load(filter);
  };
  const rows = useMemo(() => data?.rows || [], [data]);

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>수정로그</h2>
        <ul className="notice-list">
          <li>누가 언제 무엇을 등록·수정·삭제했는지 자동으로 남습니다. 최근 {data?.keepDays || 14}일 기록만 보관하고, 그보다 오래된 기록은 자동으로 지워집니다.</li>
          <li>비밀번호·서명, 고객 연락처·주소, 메모 같은 내용은 &apos;변경&apos;만 표시하고 값은 남기지 않습니다. 금액·일정·상태·담당 등은 바뀌기 전 → 후 값을 보여 줍니다.</li>
        </ul>
      </div>

      <form className="audit-filter" onSubmit={search}>
        <input type="date" className="input-text" value={filter.from} min={addDays(today(), -13)} max={today()} onChange={(e) => set('from', e.target.value)} />
        <span>~</span>
        <input type="date" className="input-text" value={filter.to} min={addDays(today(), -13)} max={today()} onChange={(e) => set('to', e.target.value)} />
        <select className="input-text" value={filter.actor} onChange={(e) => set('actor', e.target.value)}>
          <option value="">전체 사람</option>
          {people.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        <input className="input-text" value={filter.q} onChange={(e) => set('q', e.target.value)} placeholder="검색 (고객명, 작업 등)" />
        <button type="submit" className="btn-dark-sm" disabled={loading}>
          {loading ? '불러오는 중...' : '조회'}
        </button>
      </form>

      {data?.demo && <p className="sub-text">데모 모드에서는 수정로그를 남기지 않습니다. (실서비스에서만 기록)</p>}
      <div className="table-responsive">
        <table className="customer-table audit-table">
          <thead>
            <tr>
              <th>시간</th>
              <th>누가</th>
              <th>작업</th>
              <th>무엇을</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="no-data">
                  {loading ? '불러오는 중...' : '기록이 없습니다.'}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{timeText(r.at)}</td>
                <td className="nowrap">
                  {r.actor?.name || '-'}
                  <div className="sub-text">
                    {ROLE_LABEL[r.actor?.role] || ''}
                    {r.actor?.loginId ? ` · ${r.actor.loginId}` : ''}
                  </div>
                </td>
                <td className="nowrap">{r.action}</td>
                <td className="text-left">
                  {(r.items || []).map((it, i) => (
                    <div key={i} className="audit-item">
                      <b className={TYPE_CLASS[it.type] || ''}>[{it.type}]</b> {it.target}
                      {it.fields?.length > 0 && (
                        <ul>
                          {it.fields.map((f, j) => (
                            <li key={j}>{f.from !== undefined ? `${f.label}: ${f.from} → ${f.to}` : `${f.label} 변경`}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length >= 1000 && <p className="sub-text">기록이 많아 1,000건까지만 보여 줍니다. 기간이나 사람으로 좁혀 주세요.</p>}
    </div>
  );
}
