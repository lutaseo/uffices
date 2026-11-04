import React from 'react';

// 기사 시공 기록 (시공완료 보고 때 남김) — 누가 · 언제 · 어떤 범위를 · 무엇으로 했는지
//   record: { done: [], undone: [], material, by, at }
export default function WorkRecord({ record, compact = false }) {
  if (!record) return null;
  const when = record.at ? new Date(record.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className={`work-record ${compact ? 'compact' : ''}`}>
      <div className="work-record-head">
        🧾 시공 기록 <span>{[record.by, when].filter(Boolean).join(' · ')}</span>
      </div>
      {record.done?.length > 0 && (
        <div>
          <b>완료</b> {record.done.join(', ')}
        </div>
      )}
      {record.undone?.length > 0 && (
        <div className="text-red">
          <b>미시공</b> {record.undone.join(', ')}
        </div>
      )}
      {record.note && (
        <div className="pre-wrap">
          <b>내용</b> {record.note}
        </div>
      )}
      {record.material && (
        <div>
          <b>자재·색상</b> {record.material}
        </div>
      )}
    </div>
  );
}
