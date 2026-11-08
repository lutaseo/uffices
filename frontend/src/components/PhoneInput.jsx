import React, { useRef, useState } from 'react';

// 휴대폰 번호 칸: [010] - [0000] - [0000]
//   앞 칸은 010 이 미리 들어가 있고(011 등은 고쳐 쓸 수 있음), 칸이 차면 다음 칸으로 자동으로 넘어감
//   빈 칸에서 지우기(←)를 누르면 앞 칸으로, 번호 전체를 붙여 넣으면 세 칸에 나눠 들어감
//   value / onChange 는 예전처럼 '010-1234-5678' 한 줄 (가운데·끝 칸이 비어 있으면 '' = 입력 안 함)
const split = (v) => {
  const s = String(v || '');
  if (s.includes('-')) {
    const [x = '', y = '', z = ''] = s.split('-').map((t) => t.replace(/\D/g, ''));
    return [x || '010', y, z];
  }
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return ['010', '', ''];
  if (d.length <= 3) return [d, '', ''];
  const head = d.slice(0, 3);
  const rest = d.slice(3);
  if (d.length === 10) return [head, rest.slice(0, 3), rest.slice(3)]; // 예전 10자리 번호 (011-123-4567)
  return [head, rest.slice(0, 4), rest.slice(4, 8)];
};

export default function PhoneInput({ value, onChange, required = false, id }) {
  const [b0, b, c] = split(value);
  const [headDraft, setHeadDraft] = useState(null); // 아직 뒷자리를 안 쓴 동안 앞자리(011 등)를 기억
  const a = b || c ? b0 : headDraft ?? '010';
  const refs = [useRef(null), useRef(null), useRef(null)];
  const MAX = [3, 4, 4];

  const emit = (parts) => {
    const [x, y, z] = parts;
    setHeadDraft(x);
    onChange(y || z ? [x, y, z].filter(Boolean).join('-') : ''); // 쓰는 중에도 칸 나눔 그대로 (010-1234-567 이 010-123-4567 로 바뀌지 않게)
  };

  const onPart = (i) => (e) => {
    const digits = e.target.value.replace(/\D/g, '');
    const parts = [a, b, c];
    // 번호 전체를 붙여 넣거나 자동완성으로 들어온 경우: 세 칸에 나눔
    if (digits.length > MAX[i] && i === 0 && digits.length >= 10) {
      const p = split(digits);
      emit(p);
      refs[2].current?.focus();
      return;
    }
    parts[i] = digits.slice(0, MAX[i]);
    const over = digits.slice(MAX[i]); // 칸보다 많이 쓰면 넘친 숫자는 다음 칸으로
    if (over && i < 2) parts[i + 1] = (over + parts[i + 1]).slice(0, MAX[i + 1]);
    emit(parts);
    if (i < 2 && (over || (parts[i].length === MAX[i] && digits.length > [a, b, c][i].length))) refs[i + 1].current?.focus();
  };

  // 빈 칸에서 지우기(←): 앞 칸으로 가서 마지막 숫자 하나를 지움 (앞 칸 전체가 지워지지 않게)
  const keepCaret = useRef(false);
  const onKey = (i) => (e) => {
    if (e.key === 'Backspace' && !e.currentTarget.value && i > 0) {
      e.preventDefault();
      const parts = [a, b, c];
      parts[i - 1] = parts[i - 1].slice(0, -1);
      emit(parts);
      keepCaret.current = true;
      refs[i - 1].current?.focus();
    }
  };
  const onFocus = (e) => {
    if (keepCaret.current) {
      keepCaret.current = false;
      const el = e.target;
      setTimeout(() => el.setSelectionRange?.(el.value.length, el.value.length), 0);
      return;
    }
    e.target.select();
  };

  const box = (i, val, extra = {}) => (
    <input
      ref={refs[i]}
      type="tel"
      inputMode="numeric"
      autoComplete={i === 0 ? 'tel' : 'off'}
      className={`input-text phone-part ${i === 0 ? 'head' : ''}`}
      value={val}
      maxLength={i === 0 ? 13 : 9}
      onChange={onPart(i)}
      onKeyDown={onKey(i)}
      onFocus={onFocus}
      placeholder={i === 0 ? '010' : '0000'}
      aria-label={['휴대폰 앞자리', '휴대폰 가운데 4자리', '휴대폰 끝 4자리'][i]}
      {...extra}
    />
  );

  return (
    <span className="phone-input">
      {box(0, a, { id })}
      <span className="phone-dash">-</span>
      {box(1, b, { required })}
      <span className="phone-dash">-</span>
      {box(2, c, { required })}
    </span>
  );
}
