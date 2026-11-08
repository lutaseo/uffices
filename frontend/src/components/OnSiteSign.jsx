import React, { useEffect, useState } from 'react';
import { contracts as contractApi } from '../api/index.js';
import SignPage from '../pages/SignPage.jsx';
import KakaoModal from './KakaoModal.jsx';

// 계약 등록 직후 그 자리(태블릿 등)에서 고객 서명받기
//   ids: 방금 등록한 계약들. 한 장으로 서명하는 것(줄눈·청소)은 한 번에, 나머지(나노코팅 등)는 차례로
//   서명이 끝나면 [계약완료] 알림톡 창이 바로 열림 → 고객에게 발송
//   first: 이미 있는 서명 링크로 바로 시작 { token, ids } (계약서 보기에서 [지금 이 기기에서 서명받기] — 보낸 링크와 같은 값)
export default function OnSiteSign({ ids, first = null, onClose }) {
  const [left, setLeft] = useState(ids); // 아직 서명 화면을 안 띄운 계약
  const [cur, setCur] = useState(null); // { token, ids }
  const [done, setDone] = useState(false);
  const [talk, setTalk] = useState(null); // 계약완료 알림톡 보낼 계약
  const [talkOpen, setTalkOpen] = useState(false);
  const [error, setError] = useState('');

  const start = async (queue) => {
    setDone(false);
    setTalk(null);
    setTalkOpen(false);
    if (!queue.length) return onClose();
    try {
      const r = await contractApi.requestSign(queue[0]);
      const bundle = r.ids || [queue[0]];
      setCur({ token: r.token, ids: bundle });
      setLeft(queue.filter((id) => !bundle.includes(id)));
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    if (first?.token) {
      setCur({ token: first.token, ids: first.ids });
      setLeft(ids.filter((id) => !first.ids.includes(id)));
    } else start(ids);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 서명 완료 → 계약완료 알림톡 창 열기 (알림톡에 들어갈 계약 정보를 새로 불러옴)
  const onDone = async () => {
    setDone(true);
    try {
      setTalk(await contractApi.get(cur.ids[0]));
      setTalkOpen(true);
    } catch {
      // 알림톡 창을 못 열어도 서명은 저장됨 — 아래 버튼으로 닫기
    }
  };

  const next = () => (left.length ? start(left) : onClose());

  return (
    <div className="onsite-sign">
      <div className="onsite-sign-bar">
        <b>✍ 고객 서명{left.length > 0 && ` (남은 계약서 ${left.length}장)`}</b>
        {done ? (
          <span className="onsite-sign-actions">
            {talk && (
              <button type="button" className="btn-kakao-talk sm" onClick={() => setTalkOpen(true)}>
                계약완료 알림톡
              </button>
            )}
            <button type="button" className="btn-dark-sm" onClick={next}>
              {left.length ? '다음 계약서 서명' : '완료'}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn-dark-sm"
            onClick={() => window.confirm('서명을 나중에 받으시겠습니까?\n계약서 보기에서 [알림톡으로 보내기]로 서명 링크를 보낼 수 있습니다.') && onClose()}
          >
            나중에 받기
          </button>
        )}
      </div>
      <div className="onsite-sign-body">
        {error && (
          <div className="sign-card">
            <p className="text-red">{error}</p>
            <button type="button" className="btn-dark-sm" onClick={onClose}>
              닫기
            </button>
          </div>
        )}
        {cur && <SignPage key={cur.token} token={cur.token} onDone={onDone} />}
      </div>
      {done && talk && talkOpen && <KakaoModal contract={talk} initialTemplate="계약완료" initialTarget="고객" onClose={() => setTalkOpen(false)} />}
    </div>
  );
}
