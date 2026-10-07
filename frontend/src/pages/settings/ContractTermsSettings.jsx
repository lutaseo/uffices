import React, { useEffect, useState } from 'react';
import { contractTerms } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';

// 글 길이에 맞춰 칸 높이 (폰은 한 줄에 들어가는 글자가 적음)
const rowsFor = (t) => {
  const perLine = typeof window !== 'undefined' && window.innerWidth < 600 ? 16 : 60;
  return Math.min(10, Math.max(2, t.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0)));
};

// 설정 > 계약조건설정: 고객 계약서·서명 화면의 '계약 조건' 조항을 고침
export default function ContractTermsSettings() {
  const { handleError, refresh } = useAuth();
  const [terms, setTerms] = useState(null);
  const [isDefault, setIsDefault] = useState(false);
  const [dirty, setDirty] = useState(false);

  const apply = (r) => {
    setTerms(r.terms);
    setIsDefault(r.isDefault);
    setDirty(false);
  };

  useEffect(() => {
    contractTerms.get().then(apply).catch(handleError);
  }, [handleError]);

  if (!terms) return <div className="page-card page-loading">불러오는 중...</div>;

  const change = (next) => {
    setTerms(next);
    setDirty(true);
  };
  const move = (i, d) => {
    const next = [...terms];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    change(next);
  };

  const save = async () => {
    try {
      apply(await contractTerms.save(terms));
      await refresh(); // 계약서 보기에 바로 반영
      alert('저장되었습니다. 앞으로 보는 계약서·서명 화면에 바뀐 조건이 나옵니다.');
    } catch (err) {
      handleError(err);
    }
  };

  const reset = async () => {
    if (!window.confirm('계약 조건을 처음 기본값으로 되돌릴까요?')) return;
    try {
      apply(await contractTerms.reset());
      await refresh();
    } catch (err) {
      handleError(err);
    }
  };

  return (
    <div className="page-card">
      <div className="page-header">
        <h2>계약조건설정</h2>
        <ul className="notice-list">
          <li>고객이 받는 계약서와 전자서명 화면의 <b>계약 조건</b>에 순서대로 번호가 붙어 나옵니다.</li>
          <li>이미 <b>서명이 끝난 계약서</b>는 서명할 때의 조건이 그대로 보관됩니다. (여기서 바꿔도 바뀌지 않음)</li>
          <li>서명 대기 중인 계약서는 고객이 링크를 여는 시점의 조건으로 보입니다.</li>
        </ul>
      </div>

      {isDefault && <p className="sub-text">지금은 프로그램 기본 조건을 쓰고 있습니다.</p>}

      <ol className="terms-edit">
        {terms.map((t, i) => (
          <li key={i}>
            <span className="terms-no">{i + 1}.</span>
            <textarea
              className="input-text"
              rows={rowsFor(t)}
              value={t}
              placeholder="조항 내용을 입력하세요"
              onChange={(e) => change(terms.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <span className="terms-btns">
              <button type="button" className="btn-dark-sm" disabled={i === 0} onClick={() => move(i, -1)} title="위로">▲</button>
              <button type="button" className="btn-dark-sm" disabled={i === terms.length - 1} onClick={() => move(i, 1)} title="아래로">▼</button>
              <button type="button" className="btn-text-danger" onClick={() => change(terms.filter((_, j) => j !== i))}>삭제</button>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn-dark-sm" onClick={() => change([...terms, ''])} disabled={terms.length >= 30}>
        + 조항 추가
      </button>

      <div className="form-bottom-btns">
        <button type="button" className="btn-dark-lg" onClick={save} disabled={!dirty}>저장</button>
        <button type="button" className="btn-dark-lg cancel" onClick={reset}>기본값으로</button>
      </div>
    </div>
  );
}
