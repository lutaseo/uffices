import React, { useEffect, useRef, useState } from 'react';

// 기사 선택: 이름(또는 전화번호 뒷자리)을 쳐서 찾고, 눌러서 선택 (PC·폰 동일)
//   engineers : 지금 구분(줄눈/청소…) 담당 기사 — 기본으로 이것만 보임
//   others    : 다른 구분 기사 — 목록 맨 아래 [다른 구분 기사 보기]를 눌러야 보임
//   info(en)  : { disabled, note } — 휴무 등으로 고를 수 없는 기사 표시
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

export default function EngineerPicker({ value, engineers, others = [], info = () => ({}), onChange, placeholder = '기사 이름 검색', fallbackName = '' }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const input = useRef(null);

  const all = [...engineers, ...others];
  const selected = all.find((en) => String(en.id) === String(value));
  const selectedName = selected ? selected.name : value ? `${fallbackName || '기사'}(미사용)` : '';

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const q = norm(text);
  const hit = (en) => !q || norm(en.name).includes(q) || String(en.phone || '').replace(/\D/g, '').includes(q);
  const mine = engineers.filter(hit);
  const rest = others.filter(hit);
  const list = showOthers || (q && !mine.length) ? [...mine, ...rest] : mine;

  const pick = (en) => {
    if (info(en).disabled) return;
    onChange(String(en.id));
    setText('');
    setOpen(false);
    input.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (open && list[active]) pick(list[active]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <span className="eng-picker" ref={box}>
      <input
        ref={input}
        className="input-text eng-picker-input"
        value={open ? text : selectedName}
        placeholder={open && selectedName ? selectedName : placeholder}
        onFocus={() => {
          setOpen(true);
          setText('');
          setActive(0);
        }}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />
      {open && (
        <ul className="eng-picker-list" role="listbox">
          {list.length === 0 && <li className="empty">{q ? '검색 결과가 없습니다.' : '이 구분 담당 기사가 없습니다.'}</li>}
          {list.map((en, i) => {
            const { disabled, note } = info(en);
            const other = !engineers.includes(en);
            return (
              <li
                key={en.id}
                role="option"
                aria-selected={String(en.id) === String(value)}
                aria-disabled={disabled || undefined}
                className={`${i === active ? 'active' : ''} ${disabled ? 'disabled' : ''} ${String(en.id) === String(value) ? 'selected' : ''}`}
                onMouseEnter={() => setActive(i)}
                // 마우스: 누르는 순간 선택(입력칸 포커스 유지) / 손가락: 끌면 목록이 넘어가고, 톡 누르면(click) 선택
                onPointerDown={(e) => {
                  if (e.pointerType !== 'mouse') return;
                  e.preventDefault();
                  pick(en);
                }}
                onClick={() => pick(en)}
              >
                <span className="name">{en.name}</span>
                <span className="meta">
                  {other && `${en.category} · `}
                  {String(en.phone || '').slice(-4) && `…${String(en.phone).slice(-4)}`}
                  {note && <b className="off"> {note}</b>}
                </span>
              </li>
            );
          })}
          {!showOthers && others.length > 0 && !(q && !mine.length) && (
            <li
              className="more"
              onPointerDown={(e) => {
                e.preventDefault();
                setShowOthers(true);
              }}
            >
              ▸ 다른 구분 기사 {others.length}명도 보기
            </li>
          )}
        </ul>
      )}
    </span>
  );
}
