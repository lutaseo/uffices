import React, { useEffect, useRef, useState } from 'react';
import { apartments as apartmentApi } from '../api/index.js';

// 현장(아파트) 검색 입력칸: 아파트관리에 미리 등록한 현장을 검색해서 눌러 선택 (휴대폰·PC 동일)
//   - 이름·지역 어느 부분을 쳐도 찾음: '강릉', '오션', '강릉 오션', '오션시티' 모두 → 강릉 오션시티
//   - 칸을 누르기만 해도 등록된 현장 목록이 뜸 (스크롤해서 고르기)
//   - ↑↓ 로 고르고 Enter, 또는 눌러서 선택. 목록에 없는 이름도 그대로 입력 가능
const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
const MAX_SHOWN = 50;
const STALE_MS = 60 * 1000; // 1분 지나면 다시 불러옴 (다른 사람이 새로 등록한 현장 반영)
let cache = null; // { rows, at } — 화면을 옮겨 다녀도 자주 불러오지 않음
let loading = null;

function loadList(force) {
  if (!force && cache && Date.now() - cache.at < STALE_MS) return Promise.resolve(cache.rows);
  loading ||= apartmentApi
    .list()
    .then((rows) => {
      cache = { rows, at: Date.now() };
      return rows;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

// 검색어를 띄어쓰기로 나눠 모든 단어가 (지역+이름)에 들어 있으면 일치
//   이름이 검색어로 시작 → 이름에 포함 → 지역으로만 일치 순서로 정렬
function search(list, value) {
  const words = String(value || '').trim().toLowerCase().split(/\s+/).filter(Boolean).map(norm);
  if (!words.length) return list.slice().sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const q = words.join('');
  return list
    .map((a) => {
      const name = norm(a.name);
      const all = norm(`${a.sido}${a.sigungu}${a.name}`);
      if (!words.every((w) => all.includes(w))) return null;
      const rank = name.startsWith(q) ? 0 : name.includes(q) ? 1 : words.every((w) => name.includes(w)) ? 2 : 3;
      return { a, rank };
    })
    .filter(Boolean)
    .sort((x, y) => x.rank - y.rank || x.a.name.localeCompare(y.a.name, 'ko'))
    .map((x) => x.a);
}

// 검색 단어 부분을 굵게
function Highlight({ text, value }) {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return String(text)
    .split(re)
    .map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

export default function AptSearchInput({ value, onChange, onPick, className = 'input-text addr-input', placeholder = '현장검색 (아파트명·지역)', required, ...rest }) {
  const [list, setList] = useState(cache?.rows || []);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const listRef = useRef(null);

  const refresh = (force) =>
    loadList(force)
      .then(setList)
      .catch(() => {});

  useEffect(() => {
    refresh(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const all = search(list, value);
  const matches = all.slice(0, MAX_SHOWN);
  const q = norm(value);
  const exact = list.find((a) => norm(a.name) === q);
  const showList = open && matches.length > 0 && !(exact && matches.length === 1);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (a) => {
    onChange(a.name);
    onPick?.(a);
    setOpen(false);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') return setOpen(false);
    if (!matches.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter' && showList) {
      e.preventDefault();
      pick(matches[active] || matches[0]);
    }
  };

  return (
    <span className="apt-search" ref={box}>
      <input
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          setOpen(true);
          setActive(0);
          refresh(false);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete="off"
        required={required}
        {...rest}
      />
      {q && exact && !open && <span className="apt-registered" title="아파트관리에 등록된 현장">✓ 등록</span>}
      {showList && (
        <ul className="apt-suggest" role="listbox" ref={listRef}>
          {matches.map((a, i) => (
            <li
              key={a.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'active' : ''}
              onPointerDown={(e) => {
                e.preventDefault();
                pick(a);
              }}
            >
              <b>
                <Highlight text={a.name} value={value} />
              </b>
              {(a.sido || a.sigungu) && (
                <span>
                  <Highlight text={[a.sido, a.sigungu].filter(Boolean).join(' ')} value={value} />
                </span>
              )}
            </li>
          ))}
          {all.length > MAX_SHOWN && <li className="more">외 {all.length - MAX_SHOWN}곳 — 더 입력해서 좁혀 주세요</li>}
        </ul>
      )}
      {open && q && !all.length && list.length > 0 && <div className="apt-suggest empty">등록된 현장 중 일치하는 곳이 없습니다 (그대로 입력 가능)</div>}
      {open && cache && !list.length && <div className="apt-suggest empty">등록된 현장이 없습니다 — 설정 &gt; 아파트관리에서 미리 등록하세요</div>}
    </span>
  );
}

// 아파트관리에서 목록이 바뀌면 다시 불러오도록
export const resetAptCache = () => {
  cache = null;
};
