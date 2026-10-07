import React, { useEffect, useRef, useState } from 'react';
import { esign } from '../api/index.js';
import ContractDocument from '../components/ContractDocument.jsx';

// 고객용 전자서명 페이지 (/sign/:token). 로그인 없이 링크로만 접근합니다.
export default function SignPage({ token }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);

  useEffect(() => {
    esign
      .getByToken(token)
      .then((d) => {
        setData(d);
        setSignerName(d.contract.customerName);
        if (d.contract.esign?.status === '서명완료') setDone(true);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  // 캔버스를 화면 크기에 맞춰 선명하게
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#111';
  }, [data, done]);

  const point = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onDown = (e) => {
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(...point(e));
  };
  const onMove = (e) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current.getContext('2d');
    ctx.lineTo(...point(e));
    ctx.stroke();
    hasInk.current = true;
  };
  const onUp = () => {
    drawing.current = false;
  };

  const clear = () => {
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    hasInk.current = false;
  };

  const submit = async () => {
    if (!hasInk.current) {
      alert('서명란에 서명해 주세요.');
      return;
    }
    setSubmitting(true);
    try {
      const signature = canvasRef.current.toDataURL('image/png');
      await esign.sign(token, { signerName, signature, agreed });
      // 방금 한 서명과 '서명완료' 상태를 계약서에 바로 보여줌
      const signedAt = new Date().toISOString();
      const mark = (c) => ({ ...c, esign: { ...c.esign, status: '서명완료', signerName: signerName.trim(), signature, signedAt } });
      setData((d) => ({ ...d, contract: mark(d.contract), contracts: (d.contracts || [d.contract]).map(mark) }));
      setDone(true);
    } catch (e) {
      alert(e.message);
      setSubmitting(false);
    }
  };

  if (error) return <div className="sign-page"><div className="sign-card"><h2>서명 링크 오류</h2><p>{error}</p></div></div>;
  if (!data) return <div className="page-loading">불러오는 중...</div>;

  return (
    <div className="sign-page">
      <div className="sign-card">
        <ContractDocument contract={data.contract} contracts={data.contracts} company={data.company} showStatus />

        {done ? (
          <div className="sign-done">✅ 서명이 완료되었습니다. 감사합니다.</div>
        ) : (
          <div className="sign-form">
            <label className="agree">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> 위 계약 내용을 확인하였으며 이에 동의합니다.
            </label>
            <div className="inline-fields">
              서명자 성함 <input className="input-text" value={signerName} onChange={(e) => setSignerName(e.target.value)} />
            </div>
            <div className="sign-pad-wrap">
              <canvas
                ref={canvasRef}
                className="sign-pad"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerLeave={onUp}
              />
              <button type="button" className="btn-link" onClick={clear}>지우기</button>
            </div>
            <button type="button" className="btn-confirm big" disabled={!agreed || submitting} onClick={submit}>
              {submitting ? '제출 중...' : '서명 완료'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
