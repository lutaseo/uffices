import React, { useState } from 'react';
import {
  APPROVAL_STATUS,
  WORK_TYPES,
  BRANDS,
  CATEGORIES,
  DATE_TYPES,
  ESIGN_STATUS,
  RECEPTION_TYPES,
  SORT_OPTIONS,
  WORK_STATUS,
} from '../constants.js';
import { presetRange } from '../utils/date.js';
import { useAuth } from '../auth/AuthContext.jsx';
import AptSearchInput from './AptSearchInput.jsx';

export const EMPTY_FILTER = {
  dateType: 'contractDate',
  startDate: '',
  endDate: '',
  aptName: '',
  dong: '',
  ho: '',
  customerName: '',
  phone: '',
  brand: '',
  category: '',
  receptionType: '',
  status: '',
  approval: '',
  workType: '',
  esignStatus: '',
  ownerId: '',
  engineerId: '',
  sort: 'contractDate_desc',
};

const PRESETS = [
  { key: 'today', label: '오늘' },
  { key: 'week', label: '이번주' },
  { key: 'month', label: '이번달' },
  { key: 'lastMonth', label: '지난달' },
  { key: '3months', label: '3개월' },
];

// 텍스트/날짜 입력은 [검색] 시 반영, 드롭다운은 선택 즉시 반영
export default function SearchFilter({ filter, onSearch, staff = [], engineers = [], actions }) {
  const { company } = useAuth();
  const brands = company?.brands?.length ? company.brands : BRANDS; // 업체에 등록된 브랜드
  const [draft, setDraft] = useState(filter);

  const set = (name, value) => setDraft((prev) => ({ ...prev, [name]: value }));

  const applySelect = (name, value) => {
    const next = { ...draft, [name]: value };
    setDraft(next);
    onSearch(next);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (draft.startDate && draft.endDate && draft.startDate > draft.endDate) {
      alert('시작일이 종료일보다 늦습니다.');
      return;
    }
    onSearch(draft);
  };

  const handlePreset = (key) => {
    const [startDate, endDate] = presetRange(key);
    const next = { ...draft, startDate, endDate };
    setDraft(next);
    onSearch(next);
  };

  const handleReset = () => {
    setDraft(EMPTY_FILTER);
    onSearch(EMPTY_FILTER);
  };

  const input = (name, placeholder, className = 'input-search') => (
    <input
      type="text"
      placeholder={placeholder}
      value={draft[name]}
      onChange={(e) => set(name, e.target.value)}
      className={className}
    />
  );

  const select = (name, placeholder, options) => (
    <select value={draft[name]} onChange={(e) => applySelect(name, e.target.value)} className="input-select">
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );

  return (
    <div className="filter-box">
      <form onSubmit={handleSubmit}>
        <div className="filter-row">
          <select value={draft.dateType} onChange={(e) => set('dateType', e.target.value)} className="input-select">
            {DATE_TYPES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
          <input type="date" value={draft.startDate} onChange={(e) => set('startDate', e.target.value)} className="input-date" />
          <span>~</span>
          <input type="date" value={draft.endDate} onChange={(e) => set('endDate', e.target.value)} className="input-date" />
          <div className="preset-group">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className="btn-preset" onClick={() => handlePreset(p.key)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-row">
          <AptSearchInput value={draft.aptName} onChange={(v) => set('aptName', v)} className="input-search wide" placeholder="아파트명" />
          {input('dong', '동', 'input-search narrow')}
          {input('ho', '호', 'input-search narrow')}
          {input('customerName', '계약자명')}
          {input('phone', '계약자 전화번호', 'input-search wide')}
          <button type="submit" className="btn-search-submit">
            🔍 검색
          </button>
          <button type="button" className="btn-reset" onClick={handleReset}>
            초기화
          </button>
        </div>

        <div className="filter-row">
          {select('brand', '브랜드선택', brands)}
          {select('category', '구분', CATEGORIES)}
          {select('sort', null, SORT_OPTIONS)}
          {select('receptionType', '접수형태', RECEPTION_TYPES)}
          {select('approval', '승인구분', APPROVAL_STATUS)}
          {select('status', '시공상태', WORK_STATUS)}
          {select('workType', '시공종류', WORK_TYPES)}
          {select('esignStatus', '전자계약상태', Object.values(ESIGN_STATUS))}
          {staff.length > 0 && select('ownerId', '작성자선택', staff.map((s) => ({ value: String(s.id), label: s.name })))}
          {select('engineerId', '시공담당(기사)', engineers.map((e) => ({ value: String(e.id), label: `${e.name}(${e.category})` })))}
          <div className="filter-actions">{actions}</div>
        </div>
      </form>
    </div>
  );
}
