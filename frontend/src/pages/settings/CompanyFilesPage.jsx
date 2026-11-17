import React, { useEffect, useRef, useState } from 'react';
import { API_MODE, companyFiles } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ROLES } from '../../auth/permissions.js';
import { FILE_MAX_MB } from '../../api/files.js';

// 설정 > 회사 자료 백업: PDF · PPT · 엑셀 등 회사 자료를 올려 두고 어디서든 내려받기
//   보기·내려받기: 관리자 · 실장 / 올리기·지우기: 관리자 또는 '기초설정' 권한
const sizeText = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const icon = (name) => {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
  if (ext === 'pdf') return '📕';
  if (['ppt', 'pptx', 'key'].includes(ext)) return '📙';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
  if (['doc', 'docx', 'hwp', 'hwpx', 'txt'].includes(ext)) return '📘';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'].includes(ext)) return '🖼️';
  if (['zip', '7z', 'rar'].includes(ext)) return '🗜️';
  return '📄';
};

// 저장소로 직접 올리기 (진행률 표시) → { ok, status, text }
function putFile(url, file, onProgress) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'true');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.floor((e.loaded / e.total) * 100));
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText || '' });
    xhr.onerror = () => resolve({ ok: false, status: 0, text: '' });
    xhr.send(file);
  });
}

export default function CompanyFilesPage() {
  const { user, can, handleError } = useAuth();
  const manage = user.role === ROLES.ADMIN || can('settings.manage');
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState('');
  const inputRef = useRef(null);

  const load = () =>
    companyFiles
      .list()
      .then(setList)
      .catch((e) => {
        setList([]);
        handleError(e);
      });
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files) => {
    const picked = [...files];
    if (!picked.length) return;
    const big = picked.find((f) => f.size > FILE_MAX_MB * 1024 * 1024);
    if (big) return alert(`파일은 ${FILE_MAX_MB}MB 까지 올릴 수 있습니다.\n${big.name} (${sizeText(big.size)})`);
    try {
      for (let i = 0; i < picked.length; i += 1) {
        const f = picked[i];
        const label = `올리는 중 ${i + 1}/${picked.length} · ${f.name}`;
        setBusy(label);
        const { id, uploadUrl } = await companyFiles.add({ name: f.name, size: f.size, type: f.type, memo });
        const r = await putFile(uploadUrl, f, (pct) => setBusy(`${label} · ${pct}%`));
        if (!r.ok) {
          await companyFiles.remove(id).catch(() => {});
          const tooBig = r.status === 413 || /size|large|exceed/i.test(r.text);
          throw new Error(
            tooBig
              ? `${f.name} (${sizeText(f.size)}) 은(는) 파일 저장소의 크기 제한에 걸렸습니다.\n운영자가 Supabase > Storage > Settings 에서 올리기 크기 제한을 ${FILE_MAX_MB}MB 로 바꿔야 합니다.`
              : `${f.name} 을(를) 올리지 못했습니다. 인터넷 연결을 확인하고 잠시 후 다시 시도해 주세요.`,
          );
        }
        await companyFiles.confirm(id);
      }
      setMemo('');
      await load();
    } catch (e) {
      if (e.code) handleError(e);
      else alert(e.message);
    } finally {
      setBusy('');
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async (f) => {
    if (!window.confirm(`'${f.name}' 자료를 지울까요?\n지우면 되돌릴 수 없습니다.`)) return;
    try {
      await companyFiles.remove(f.id);
      await load();
    } catch (e) {
      handleError(e);
    }
  };

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (list || []).filter((f) => words.every((w) => `${f.name} ${f.memo} ${f.byName}`.toLowerCase().includes(w)));

  return (
    <div className="page-card company-files">
      <div className="page-header">
        <h2>회사 자료 백업</h2>
        <ul className="notice-list">
          <li>계약서 양식 · 회사 소개 PPT · 가격표 PDF 같은 회사 자료를 올려 두고, 필요할 때 어디서든 내려받으세요.</li>
          <li>파일 하나에 {FILE_MAX_MB}MB 까지, 여러 개를 한 번에 고를 수 있습니다. 큰 파일은 와이파이에서 올리면 빠르고 안전합니다.</li>
          <li>관리자 · 실장님 모두 내려받을 수 있고, 올리기 · 지우기는 관리자(또는 기초설정 권한)만 할 수 있습니다.</li>
        </ul>
      </div>

      {API_MODE === 'demo' ? (
        <p className="files-empty">데모 화면에서는 사용할 수 없습니다. (실제 서비스에서 사용)</p>
      ) : (
        <>
          {manage && (
            <div className="files-upload">
              <input className="input-text" placeholder="설명 (선택, 예: 2026 가격표)" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} disabled={!!busy} />
              <label className={`btn-confirm files-pick ${busy ? 'disabled' : ''}`}>
                📤 파일 올리기
                <input ref={inputRef} type="file" multiple hidden disabled={!!busy} onChange={(e) => upload(e.target.files)} />
              </label>
            </div>
          )}
          {busy && <div className="files-busy">⏳ {busy}</div>}

          <div className="files-search">
            <input className="input-text" placeholder="🔍 자료 이름 · 설명으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
            <span className="sub-text">{list ? `${shown.length}개` : ''}</span>
          </div>

          {!list ? (
            <p className="files-empty">불러오는 중...</p>
          ) : !shown.length ? (
            <p className="files-empty">{list.length ? '찾는 자료가 없습니다.' : '아직 올린 자료가 없습니다.'}</p>
          ) : (
            <ul className="files-list">
              {shown.map((f) => (
                <li key={f.id}>
                  <span className="files-icon">{icon(f.name)}</span>
                  <div className="files-info">
                    <div className="bold-text files-name">{f.name}</div>
                    <div className="sub-text">
                      {f.memo && <>{f.memo} · </>}
                      {sizeText(f.size)} · {f.byName} · {new Date(f.createdAt).toLocaleDateString('ko-KR')}
                    </div>
                  </div>
                  <a className="btn-confirm files-down" href={f.url || undefined} target="_blank" rel="noreferrer" onClick={(e) => !f.url && e.preventDefault()}>
                    내려받기
                  </a>
                  {manage && (
                    <button type="button" className="btn-cancel files-del" onClick={() => remove(f)}>
                      삭제
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
