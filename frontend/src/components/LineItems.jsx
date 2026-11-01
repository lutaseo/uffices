import React from 'react';

// 계약 상세·기사 화면의 [패키지] / [추가시공품목] 칸
//   줄의 kind('추가시공품목')로 나눔 — kind가 없는 예전 줄은 패키지 칸에
//   글자는 모두 진하게(굵게), 상세품목도 흐리지 않게 (현장에서 잘 보이도록)
const ADDON = '추가시공품목';
export const isAddonLine = (l) => l.kind === ADDON;

// kind: '패키지' | '추가시공품목', withDetail: 상세품목까지 보여 줄지, extra: 추가시공품목 칸 아래 붙는 '추가 시공내용' 글
export default function LineItems({ lines, kind, withDetail = true, extra }) {
  const list = (lines || []).filter((l) => (kind === ADDON ? isAddonLine(l) : !isAddonLine(l)));
  return (
    <div className="line-items-strong">
      {list.map((l, i) => (
        <div key={i}>
          {l.name}
          {l.qty > 1 && ` x${l.qty}`}
          {withDetail && l.detail && <span className="line-detail-text"> — {l.detail}</span>}
        </div>
      ))}
      {extra && <div className="pre-wrap">{extra}</div>}
    </div>
  );
}
