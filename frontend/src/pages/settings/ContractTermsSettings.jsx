import React, { useEffect, useMemo, useState } from 'react';
import { companies as companyApi } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { termSection } from '../../constants.js';
import { ContractTerms } from '../../components/ContractDocument.jsx';

// 운영자(super) > 계약조건: 업체·브랜드별 계약서 '계약 조건' 입력
//   저장 형식(묶음 목록)은 계약서·서명 보관과 같음 — 중요 조항(구분 없음) + '[구분]' 묶음들
//   이미 서명한 계약서는 서명할 때 조건이 따로 보관되어 여기서 바꿔도 그대로

// 묶음 목록 → 입력 칸 { lead, sections: [{ name, lines }] }
function toForm(terms = []) {
  if (!terms.some(termSection)) {
    // 구분 없는 조건(예: 기본 조건 4줄)은 번호를 붙여 중요 조항 칸 하나로
    return { lead: terms.length > 1 ? terms.map((t, i) => `${i + 1}. ${t}`).join('\n') : terms[0] || '', sections: [] };
  }
  return {
    lead: terms.filter((t) => !termSection(t)).join('\n\n'),
    sections: terms
      .filter(termSection)
      .map((t) => {
        const [, ...lines] = t.split('\n');
        return { name: termSection(t), lines: lines.map((l) => l.replace(/^\s*\*\s*/, '')).filter((l) => l.trim()).join('\n') };
      }),
  };
}

// 입력 칸 → 묶음 목록 (한 줄 = 한 항목)
function toTerms({ lead, sections }) {
  const out = [];
  if (lead.trim()) out.push(lead.trim());
  sections.forEach((s) => {
    const items = s.lines.split('\n').map((l) => l.replace(/^\s*\*\s*/, '').trim()).filter(Boolean);
    if (s.name.trim() && items.length) out.push([`[${s.name.trim()}]`, ...items.map((l) => `*${l}`)].join('\n'));
  });
  return out;
}

export default function ContractTermsSettings() {
  const { handleError } = useAuth();
  const [data, setData] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [brand, setBrand] = useState('');
  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async (keep) => {
    try {
      const d = await companyApi.termsSettings();
      setData(d);
      const c = d.companies.find((x) => x.id === keep?.companyId) || d.companies[0];
      if (c) pick(c, keep?.brand && c.brands.includes(keep.brand) ? keep.brand : c.brands[0]);
    } catch (e) {
      handleError(e);
    }
  };
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const company = data?.companies.find((c) => c.id === companyId);
  const pick = (c, b) => {
    setCompanyId(c.id);
    setBrand(b || '');
    setForm(b ? toForm(c.terms[b]) : null);
    setDirty(false);
  };
  const leave = () => !dirty || window.confirm('저장하지 않은 내용이 있습니다. 이동할까요?');

  const change = (patch) => {
    setForm((f) => ({ ...f, ...patch }));
    setDirty(true);
  };
  const setSection = (i, patch) => change({ sections: form.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const preview = useMemo(() => (form ? toTerms(form) : []), [form]);

  const save = async () => {
    const terms = toTerms(form);
    if (form.sections.some((s) => s.lines.trim() && !s.name.trim())) return alert('구분 이름을 넣어 주세요. (예: 줄눈)');
    setSaving(true);
    try {
      await companyApi.saveContractTerms({ companyId, brand, terms });
      alert('저장되었습니다. 이제부터 이 브랜드 계약서에 적용됩니다. (이미 서명한 계약서는 그대로)');
      await load({ companyId, brand });
    } catch (e) {
      handleError(e);
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    if (!window.confirm(`${brand} 계약조건을 지우고 기본 조건으로 되돌릴까요?`)) return;
    try {
      await companyApi.saveContractTerms({ companyId, brand, terms: [] });
      await load({ companyId, brand });
    } catch (e) {
      handleError(e);
    }
  };

  if (!data) return <div className="page-card">불러오는 중...</div>;
  return (
    <div className="page-card">
      <div className="page-header">
        <h2>계약조건</h2>
        <ul className="notice-list">
          <li>업체 · 브랜드마다 계약서의 &apos;계약 조건&apos;을 넣습니다. 운영자만 바꿀 수 있습니다.</li>
          <li>중요 조항은 모든 계약서 맨 앞에 강조 상자로, 구분별 조건은 그 구분(줄눈·청소 등)을 계약한 계약서에만 나옵니다.</li>
          <li>이미 서명한 계약서는 서명할 때의 조건이 그대로 남습니다.</li>
        </ul>
      </div>

      <div className="terms-pickers">
        <label>
          업체{' '}
          <select
            className="input-text"
            value={companyId || ''}
            onChange={(e) => {
              const c = data.companies.find((x) => x.id === Number(e.target.value));
              if (c && leave()) pick(c, c.brands[0]);
            }}
          >
            {data.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </label>
        <div className="radio-btn-group">
          {company?.brands.map((b) => (
            <label key={b} className={`radio-tag ${b === brand ? 'selected' : ''}`}>
              <input type="radio" name="termsBrand" value={b} checked={b === brand} onChange={() => leave() && pick(company, b)} />
              {b}
              {company.source[b] === 'default' && ' (기본 조건)'}
            </label>
          ))}
        </div>
      </div>
      {company && !company.brands.length && <p className="no-data">이 업체에 등록된 브랜드가 없습니다. 업체/계정관리에서 브랜드를 먼저 넣어 주세요.</p>}

      {form && (
        <div className="terms-editor">
          <div className="terms-form">
            {!company.saved[brand] && <p className="sub-text">아직 입력하지 않아 지금은 아래 조건이 쓰이고 있습니다. 고쳐서 저장하면 이 브랜드 전용 조건이 됩니다.</p>}
            <h3 className="section-title">중요 조항 (모든 계약서 맨 앞, 강조)</h3>
            <textarea className="input-text terms-lead" rows={7} value={form.lead} onChange={(e) => change({ lead: e.target.value })} placeholder="예: 본 계약에서 계약 의뢰인을 “갑”, 시공 업체를 “을”이라 칭하며 …" />

            <h3 className="section-title">구분별 조건 (한 줄에 한 항목)</h3>
            {form.sections.map((s, i) => (
              <div key={i} className="terms-section">
                <div className="inline-fields">
                  <input className="input-text terms-name" list="terms-categories" value={s.name} onChange={(e) => setSection(i, { name: e.target.value.replace(/[[\]]/g, '') })} placeholder="구분 (예: 줄눈)" />
                  <button type="button" className="btn-text-danger" onClick={() => change({ sections: form.sections.filter((_, j) => j !== i) })}>
                    빼기
                  </button>
                </div>
                <textarea className="input-text" rows={5} value={s.lines} onChange={(e) => setSection(i, { lines: e.target.value })} placeholder={'AS규정 : …\n발코니 청소는 별도협의'} />
              </div>
            ))}
            <datalist id="terms-categories">
              {data.categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <button type="button" className="btn-dark-sm" onClick={() => change({ sections: [...form.sections, { name: '', lines: '' }] })}>
              + 구분 추가
            </button>

            <div className="form-bottom-btns">
              {company.saved[brand] && (
                <button type="button" className="btn-outline-action" onClick={reset}>
                  기본 조건으로 되돌리기
                </button>
              )}
              <button type="button" className="btn-dark-lg" onClick={save} disabled={saving || !dirty}>
                {saving ? '저장 중...' : '저장'}
              </button>
            </div>
          </div>

          <div className="terms-preview">
            <h3 className="section-title">계약서 미리보기</h3>
            <p className="sub-text">구분별 조건은 실제 계약서에서 계약한 구분 것만 나옵니다.</p>
            <div className="contract-doc">{preview.length ? <ContractTerms terms={preview} /> : <p className="no-data">조건이 비어 있으면 기본 조건이 쓰입니다.</p>}</div>
          </div>
        </div>
      )}
    </div>
  );
}
