import React, { useState } from 'react';
import { materialText } from '../utils/contract.js';

// 기사 시공 기록 (시공완료 보고 때 남김) — 누가 · 언제 · 어떤 항목을 · 무슨 자재로 · 누구와
//   record: { items: [{ text, done, material, worker }], done, undone, material, helpers, note, by, at }
//   full: 전체 내용 (계약 상세의 진행상황). 아니면 한 줄 요약 + [자세히 보기]
//   onMore: [자세히 보기]를 누르면 할 일 (예: 계약 상세로 이동). 없으면 그 자리에서 펼침
export default function WorkRecord({ record, full = false, onMore }) {
  const [open, setOpen] = useState(false);
  if (!record) return null;
  const when = record.at ? new Date(record.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const doneCount = record.items ? record.items.filter((x) => x.done).length : record.done?.length || 0;
  const undoneCount = record.undone?.length || 0;

  if (!full && !open) {
    return (
      <div className="work-record summary">
        🧾 <b>시공 기록</b> {[record.by, when].filter(Boolean).join(' · ')}
        {doneCount > 0 && ` · 완료 ${doneCount}`}
        {undoneCount > 0 && <span className="text-red"> · 미시공 {undoneCount}</span>}
        <button
          type="button"
          className="btn-link work-record-more"
          onClick={(e) => {
            e.stopPropagation();
            if (onMore) onMore();
            else setOpen(true);
          }}
        >
          자세히 보기
        </button>
      </div>
    );
  }

  const done = record.items ? record.items.filter((x) => x.done) : (record.done || []).map((text) => ({ text }));
  return (
    <div className="work-record">
      <div className="work-record-head">
        🧾 시공 기록 <span>{[record.by, when].filter(Boolean).join(' · ')}</span>
        {open && (
          <button type="button" className="btn-link work-record-more" onClick={() => setOpen(false)}>
            접기
          </button>
        )}
      </div>
      {record.helpers && (
        <div>
          <b>함께한 사람</b> {record.helpers}
        </div>
      )}
      {done.length > 0 && (
        <div>
          <b>완료</b>
          <ul className="work-record-items">
            {done.map((x) => (
              <li key={x.text}>
                {x.text}
                {(x.material || x.color || x.worker) && <span className="work-record-meta"> — {[materialText(x.material, x.color), x.worker].filter(Boolean).join(' / ')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {undoneCount > 0 && (
        <div className="text-red">
          <b>미시공</b> {record.undone.join(', ')}
        </div>
      )}
      {(record.material || record.color) && (
        <div>
          <b>{record.items ? '공통 자재' : '자재'}</b> {materialText(record.material, record.color)}
        </div>
      )}
      {record.note && (
        <div className="pre-wrap">
          <b>내용</b> {record.note}
        </div>
      )}
    </div>
  );
}
