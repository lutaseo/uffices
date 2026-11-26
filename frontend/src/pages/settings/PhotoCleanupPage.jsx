import React, { useEffect, useState } from 'react';
import { API_MODE, photoCleanup } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { imageBytes, makeZip } from '../../utils/zip.js';
import { today } from '../../utils/date.js';

// 설정 > 사진 정리 (관리자): 시공이 끝나고 6개월 지난 계약의 사진을 압축 파일로 내려받은 뒤 서버에서 지움
//   한 번에 50건씩: [압축 파일 내려받기] → [서버에서 지우기] → 남은 게 있으면 다시
const BATCH = 50;
const safe = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim() || '이름없음';

export default function PhotoCleanupPage() {
  const { handleError } = useAuth();
  const [info, setInfo] = useState(null); // { cutoff, count, photoCount, contracts }
  const [busy, setBusy] = useState('');
  const [downloaded, setDownloaded] = useState(null); // 내려받은 계약 번호들 (지우기 가능)

  const load = () =>
    photoCleanup
      .preview({})
      .then((r) => {
        setInfo(r);
        setDownloaded(null);
      })
      .catch(handleError);
  useEffect(() => {
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const batch = info ? info.contracts.slice(0, BATCH) : [];

  const download = async () => {
    try {
      const files = [];
      for (let i = 0; i < batch.length; i++) {
        const c = batch[i];
        setBusy(`사진 모으는 중 ${i + 1}/${batch.length} · No.${c.no ?? c.id} ${c.customerName}`);
        const photos = await photoCleanup.photos(c.id);
        const folder = `No.${c.no ?? `id${c.id}`}_${safe(c.customerName)}_${safe(c.category)}`;
        for (const p of photos) files.push({ name: `${folder}/${p.name}`, data: await imageBytes(p.image) });
      }
      setBusy('압축 파일 만드는 중…');
      const blob = makeZip(files);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `사진보관_${today()}_${batch.length}건.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      setDownloaded(batch.map((c) => c.id));
    } catch (e) {
      if (e.code) handleError(e);
      else alert(`${e.message}\n잠시 후 다시 시도해 주세요. (아직 아무것도 지우지 않았습니다)`);
    } finally {
      setBusy('');
    }
  };

  const clear = async () => {
    if (!downloaded?.length) return;
    if (!window.confirm(`내려받은 압축 파일이 잘 열리는지 확인하셨나요?\n\n${downloaded.length}건의 사진을 서버에서 지웁니다. 지우면 프로그램에서는 다시 볼 수 없고, 압축 파일로만 남습니다.`)) return;
    setBusy('서버에서 지우는 중…');
    try {
      const r = await photoCleanup.clear(downloaded, {});
      alert(`${r.count}건 · 사진 ${r.photoCount}장을 정리했습니다.${r.skipped ? `\n(그사이 바뀐 ${r.skipped}건은 건너뜀)` : ''}`);
      await load();
    } catch (e) {
      handleError(e);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="page-card photo-cleanup">
      <div className="page-header">
        <h2>사진 정리 (6개월 지난 사진)</h2>
        <ul className="notice-list">
          <li>
            시공완료 · 취소된 계약 중 <b>AS 가 모두 끝났고, 마지막 날짜(시공일 · 계약일 · AS 날짜)부터 6개월이 지난</b> 계약의 사진(실물 계약서 · 입금 영수증 · AS)이 대상입니다.
          </li>
          <li>
            먼저 <b>[압축 파일 내려받기]</b>로 PC 에 보관한 뒤 <b>[서버에서 지우기]</b>를 누르세요. 압축 파일 안에는 계약마다 폴더(No.번호_고객명)가 있습니다.
          </li>
          <li>한 번에 {BATCH}건씩 처리합니다. 지운 계약에는 변경이력에 '사진 정리'가 남고, 계약 내용 · 입금 기록은 그대로입니다.</li>
        </ul>
      </div>

      {API_MODE === 'demo' && <p className="sub-text">데모 화면에서는 사진이 브라우저에만 있어 정리할 필요가 없습니다.</p>}

      {!info ? (
        <p className="photo-cleanup-empty">불러오는 중...</p>
      ) : info.count === 0 ? (
        <p className="photo-cleanup-empty">정리할 사진이 없습니다. (기준: {info.cutoff} 이전에 끝난 계약)</p>
      ) : (
        <>
          <div className="amount-cards">
            <div className="amount-card">
              <span>정리 대상 계약</span>
              <b>{info.count.toLocaleString()}건</b>
              <small>{info.cutoff} 이전에 끝난 계약</small>
            </div>
            <div className="amount-card">
              <span>사진</span>
              <b>{info.photoCount.toLocaleString()}장</b>
            </div>
          </div>

          <div className="photo-cleanup-actions">
            <button type="button" className="btn-dark-lg sm" onClick={download} disabled={!!busy}>
              ① 압축 파일 내려받기 ({batch.length}건)
            </button>
            <button type="button" className="btn-text-danger photo-cleanup-clear" onClick={clear} disabled={!!busy || !downloaded?.length}>
              ② 서버에서 지우기{downloaded?.length ? ` (${downloaded.length}건)` : ''}
            </button>
            {busy && <span className="sub-text">⏳ {busy}</span>}
            {!busy && !downloaded && <span className="sub-text">① 을 먼저 하면 ② 를 누를 수 있습니다.</span>}
            {!busy && downloaded && <span className="sub-text">✔ 내려받았습니다. 압축 파일이 잘 열리는지 확인한 뒤 ② 를 누르세요.</span>}
          </div>

          <div className="table-responsive">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>번호</th>
                  <th>고객</th>
                  <th>구분</th>
                  <th>상태</th>
                  <th>마지막 날짜</th>
                  <th>사진</th>
                </tr>
              </thead>
              <tbody>
                {batch.map((c) => (
                  <tr key={c.id}>
                    <td>{c.no ?? '-'}</td>
                    <td>{c.customerName}</td>
                    <td>{c.category}</td>
                    <td>{c.status}</td>
                    <td>{c.lastDate}</td>
                    <td>{c.photoCount}장</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {info.count > BATCH && <p className="sub-text">이번 {BATCH}건을 정리하면 다음 {Math.min(BATCH, info.count - BATCH)}건이 나옵니다. (남은 {info.count - BATCH}건)</p>}
        </>
      )}
    </div>
  );
}
