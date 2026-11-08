import React, { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { apartments, imports, users } from '../../api/index.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { categoriesFromName, legacyKeys, mapLegacyRow, parseLegacyHtml } from '../../utils/legacyImport.js';
import { won } from '../../utils/format.js';
import { CATEGORIES } from '../../constants.js';
import { parseProductText } from '../../utils/productImport.js';
import { normalizeSido, parseApartmentText } from '../../utils/apartmentImport.js';

// 설정 > 데이터 가져오기 (관리자 전용)
//   1) 기사 목록 (엑셀/CSV: 이름, 아이디, 연락처)
//   2) 예전 프로그램의 계약 '엑셀다운로드' 파일
//   3) 직원 계정 (엑셀: 이름, 아이디, 비밀번호, 부서, 직급)
//   4) 상품 목록 (예전 프로그램 상품 화면 복사·붙여넣기, 또는 엑셀: 상품명, 구분, 품목, 상세품목, 노출여부)
//   5) 아파트 목록 (예전 프로그램 아파트 화면 복사·붙여넣기, 또는 엑셀: 시도, 시군구, 아파트명)
const BATCH = 20; // 실서비스 DB 가 멀어도 한 번 요청이 시간 제한(60초) 안에 끝나도록 작게

// 시간 초과·일시 오류면 잠시 뒤 더 작게 나눠 다시 시도 (이미 저장된 건은 서버가 건너뜀)
async function sendWithRetry(rows, options = {}, tries = 3) {
  try {
    return await imports.contracts(rows, options);
  } catch (err) {
    const retryable = err.code === 'SERVER' || err.code === 'NETWORK';
    if (!retryable || tries <= 1) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    if (rows.length > 5) {
      const half = Math.ceil(rows.length / 2);
      const a = await sendWithRetry(rows.slice(0, half), options, tries - 1);
      const b = await sendWithRetry(rows.slice(half), options, tries - 1);
      return { created: a.created + b.created, skipped: a.skipped + b.skipped, updated: (a.updated || 0) + (b.updated || 0), errors: [...a.errors, ...b.errors], newEngineers: [...a.newEngineers, ...b.newEngineers], newBrands: [...a.newBrands, ...b.newBrands] };
    }
    return sendWithRetry(rows, options, tries - 1);
  }
}

const readFile = (file, as) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    if (as === 'text') r.readAsText(file, 'utf-8');
    else r.readAsArrayBuffer(file);
  });

export default function ImportPage() {
  return (
    <div className="page-card import-page">
      <div className="page-header">
        <h2>데이터 가져오기</h2>
        <ul className="notice-list">
          <li>예전 프로그램의 기사·계약 자료를 한 번에 옮기는 화면입니다. <b>기사 목록을 먼저</b> 가져온 뒤 계약을 가져오세요.</li>
          <li>파일을 고르면 먼저 <b>미리보기</b>가 나오고, [가져오기]를 눌러야 실제로 저장됩니다.</li>
          <li>같은 파일을 다시 올려도 이미 가져온 기사(같은 이름)·계약(같은 예전 번호)은 건너뛰어 중복되지 않습니다.</li>
          <li>기사 비밀번호는 가져오지 않습니다. 기사모바일을 쓰려면 [기사관리]에서 기사별 비밀번호를 정해 주세요.</li>
        </ul>
      </div>
      <EngineerImport />
      <ContractImport />
      <UserImport />
      <ProductImport />
      <ApartmentImport />
      <OwnerFix />
    </div>
  );
}

function EngineerImport() {
  const { handleError } = useAuth();
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    try {
      const wb = XLSX.read(await readFile(file), { type: 'array' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const get = (r, ...keys) => String(keys.map((k) => r[k]).find((v) => String(v).trim()) || '').trim();
      const list = data
        .map((r) => {
          const name = get(r, '이름', '기사명', 'name');
          const listed = get(r, '담당시공').split(/[,·/\s]+/).filter((c) => CATEGORIES.includes(c));
          return { name, loginId: get(r, '아이디', 'ID', 'id', 'loginId'), phone: get(r, '연락처', '핸드폰', '전화번호', 'phone'), categories: listed.length ? listed : categoriesFromName(name) };
        })
        .filter((r) => r.name);
      if (!list.length) throw new Error('이름 칸이 있는 줄이 없습니다. 첫 줄에 "이름, 아이디, 연락처" 제목이 있는지 확인해 주세요.');
      setRows(list);
    } catch (err) {
      alert(err.message);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      setResult(await imports.engineers(rows));
      setRows(null);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="import-box">
      <h3>1. 기사 목록</h3>
      <p className="sub-text">엑셀(.xlsx) 또는 CSV. 첫 줄 제목: <b>이름, 아이디, 연락처</b> (담당시공은 선택). 담당시공 칸이 비어 있으면 이름 앞 표시(줄)·청)·코)·탄))로 자동 지정됩니다.</p>
      <label className="btn-file">
        파일 선택
        <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} hidden />
      </label>
      {rows && (
        <>
          <div className="table-responsive import-preview">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>아이디</th>
                  <th>연락처</th>
                  <th>담당시공(자동)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="text-left">{r.name}</td>
                    <td>{r.loginId || '-'}</td>
                    <td>{r.phone || '-'}</td>
                    <td>{r.categories.join('·') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-actions">
            <button type="button" className="btn-dark-lg sm" disabled={busy} onClick={run}>{busy ? '가져오는 중...' : `기사 ${rows.length}명 가져오기`}</button>
            <button type="button" className="btn-dark-lg sm cancel" onClick={() => setRows(null)}>취소</button>
          </div>
        </>
      )}
      {result && (
        <div className="import-result">
          ✔ 새로 등록 {result.created}명 · 이미 있어 건너뜀 {result.skipped}명
          {result.errors.map((e, i) => (
            <div key={i} className="text-red">· {e.name}: {e.message}</div>
          ))}
        </div>
      )}
    </section>
  );
}

function ContractImport() {
  const { handleError } = useAuth();
  const [preview, setPreview] = useState(null);
  const [sync, setSync] = useState(true); // 이미 가져온 계약도 시공일·기사·시공상태를 파일대로
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);

  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    try {
      const text = await readFile(file, 'text');
      const raw = parseLegacyHtml(text);
      if (!raw.length) throw new Error('예전 프로그램의 계약 엑셀다운로드 파일이 아닙니다. (계약 줄을 찾지 못했습니다)');
      const rows = raw.map(mapLegacyRow);
      const count = (f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
      const dates = rows.map((r) => r.contractDate).filter(Boolean).sort();
      setPreview({
        rows,
        fileName: file.name,
        from: dates[0],
        to: dates[dates.length - 1],
        brands: count((r) => r.brand || '(미지정 → 기본 브랜드)'),
        categories: count((r) => r.category),
        statuses: count((r) => r.status),
        engineers: [...new Set(rows.flatMap((r) => r.schedules.map((s) => s.engineerName)).filter(Boolean))],
        total: rows.reduce((s, r) => s + r.totalAmount - r.discount - r.voucher, 0),
        noSite: rows.filter((r) => r.aptName === '(현장 미입력)').length,
      });
    } catch (err) {
      alert(err.message);
    }
  };

  const run = async () => {
    const { rows } = preview;
    const sum = { created: 0, skipped: 0, updated: 0, errors: [], newEngineers: [], newBrands: [] };
    setProgress({ done: 0, total: rows.length });
    try {
      for (let i = 0; i < rows.length; i += BATCH) {
        const r = await sendWithRetry(rows.slice(i, i + BATCH), { sync });
        sum.created += r.created;
        sum.skipped += r.skipped;
        sum.updated += r.updated || 0;
        sum.errors.push(...r.errors);
        sum.newEngineers.push(...r.newEngineers);
        sum.newBrands.push(...r.newBrands);
        setProgress({ done: Math.min(i + BATCH, rows.length), total: rows.length });
      }
      // 같은 계약이 두 번 들어간 것 정리 (예전에 번호로 찾다가 생긴 중복) — 파일에 있는 수보다 많은 것만
      if (sync) {
        const counts = {};
        rows.forEach((r) => {
          const k = legacyKeys(r)[0];
          counts[k] = (counts[k] || 0) + 1;
        });
        sum.trashed = (await imports.contractDuplicates(counts)).trashed;
      }
      setPreview(null);
    } catch (err) {
      handleError(err);
      sum.errors.unshift({ legacyNo: '-', customerName: '', message: `중간에 멈췄습니다: ${err.message} → 같은 파일을 다시 올리면 이어서 가져옵니다(이미 들어간 건은 건너뜀).` });
    } finally {
      setResult(sum);
      setProgress(null);
    }
  };

  const chips = (obj) =>
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');

  return (
    <section className="import-box">
      <h3>2. 계약 (예전 프로그램 엑셀다운로드 파일)</h3>
      <p className="sub-text">예전 프로그램 [계약관리 → 엑셀다운로드]로 받은 .xls 파일을 그대로 올리세요. 상품내역·메모·기사전달사항·입금액·시공예정일①②·시공담당까지 옮겨집니다.</p>
      <label className="btn-file">
        파일 선택
        <input type="file" accept=".xls,.html,.htm" onChange={pick} hidden />
      </label>
      {preview && (
        <div className="import-summary">
          <table className="form-grid-table">
            <tbody>
              <tr><td className="label-col">파일</td><td className="input-col">{preview.fileName}</td></tr>
              <tr><td className="label-col">계약</td><td className="input-col"><b>{preview.rows.length}건</b> (계약일 {preview.from} ~ {preview.to}) · 실계약금 합계 {won(preview.total)}원</td></tr>
              <tr><td className="label-col">브랜드</td><td className="input-col">{chips(preview.brands)}</td></tr>
              <tr><td className="label-col">시공종류</td><td className="input-col">{chips(preview.categories)}</td></tr>
              <tr><td className="label-col">시공상태</td><td className="input-col">{chips(preview.statuses)}</td></tr>
              <tr><td className="label-col">시공담당</td><td className="input-col">{preview.engineers.join(', ') || '-'}<div className="sub-text">기사관리에 같은 이름이 없으면 자동으로 등록됩니다.</div></td></tr>
              {preview.noSite > 0 && <tr><td className="label-col">확인 필요</td><td className="input-col text-red">현장(아파트) 표기가 없는 계약 {preview.noSite}건 → "(현장 미입력)"으로 가져옵니다.</td></tr>}
            </tbody>
          </table>
          <label className="radio-item import-sync">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> 이미 가져온 계약도 <b>시공일 · 시공담당(기사) · 시공상태</b>를 이 파일대로 맞추기
            <div className="sub-text">입금·서명·사진·상담내역·기사 시공 기록은 그대로 둡니다. 파일에서 비어 있는 회차는 지금 입력된 일정을 지우지 않습니다.</div>
          </label>
          <div className="import-actions">
            <button type="button" className="btn-dark-lg sm" disabled={!!progress} onClick={run}>{progress ? `가져오는 중... ${progress.done}/${progress.total}` : `계약 ${preview.rows.length}건 가져오기`}</button>
            <button type="button" className="btn-dark-lg sm cancel" disabled={!!progress} onClick={() => setPreview(null)}>취소</button>
          </div>
          {progress && <progress className="import-progress" value={progress.done} max={progress.total} />}
        </div>
      )}
      {result && (
        <div className="import-result">
          ✔ 새로 가져옴 {result.created}건{result.updated ? ` · 일정 맞춤 ${result.updated}건` : ''}{result.trashed ? ` · 중복 정리(휴지통) ${result.trashed}건` : ''} · 이미 있어 건너뜀 {result.skipped}건 · 실패 {result.errors.length}건
          {result.newBrands.length > 0 && <div>브랜드 추가: {[...new Set(result.newBrands)].join(', ')}</div>}
          {result.newEngineers.length > 0 && <div>기사 자동 등록: {[...new Set(result.newEngineers)].join(', ')}</div>}
          {result.errors.slice(0, 50).map((e, i) => (
            <div key={i} className="text-red">· 예전 번호 {e.legacyNo} {e.customerName}: {e.message}</div>
          ))}
        </div>
      )}
    </section>
  );
}

// 3) 직원 계정 — 시공팀은 기사모바일 계정, 나머지는 실장(기본 권한)
function UserImport() {
  const { handleError } = useAuth();
  const [rows, setRows] = useState(null);
  const [resetPassword, setResetPassword] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setResult(null);
    try {
      const wb = XLSX.read(await readFile(file), { type: 'array' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const get = (r, ...keys) => String(keys.map((k) => r[k]).find((v) => String(v).trim()) || '').trim();
      const list = data
        .map((r) => ({
          name: get(r, '이름', 'name'),
          loginId: get(r, '아이디', 'ID', 'id', 'loginId'),
          password: get(r, '비밀번호', '비번', 'password'),
          department: get(r, '부서'),
          position: get(r, '직급'),
          phone: get(r, '연락처', '휴대폰', '전화번호'),
        }))
        .filter((r) => r.name || r.loginId);
      if (!list.length) throw new Error('첫 줄에 "이름, 아이디, 비밀번호, 부서, 직급" 제목이 있는지 확인해 주세요.');
      setRows(list);
    } catch (err) {
      alert(err.message);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      setResult(await imports.users(rows, { resetPassword }));
      setRows(null);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="import-box">
      <h3>3. 직원 계정</h3>
      <p className="sub-text">
        엑셀 첫 줄 제목: <b>이름, 아이디, 비밀번호, 부서, 직급</b> (연락처는 있으면). 부서가 <b>시공팀</b>이면 기사모바일 계정(같은 이름의 기사에 연결, 없으면 새 기사), 나머지는 <b>실장 계정(기본 권한)</b>으로 만듭니다. 권한은 [사용자관리]에서 바꿔 주세요. 이미 있는 아이디는 건너뜁니다.
      </p>
      <label className="btn-file">
        파일 선택
        <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} hidden />
      </label>
      {rows && (
        <>
          <div className="table-responsive import-preview">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>아이디</th>
                  <th>비밀번호</th>
                  <th>부서/직급</th>
                  <th>만들 계정</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="text-left">{r.name || '-'}</td>
                    <td>{r.loginId || '-'}</td>
                    <td>{'•'.repeat(Math.min(r.password.length, 8)) || '-'}</td>
                    <td>{[r.department, r.position].filter(Boolean).join('/') || '-'}</td>
                    <td>{r.department === '시공팀' ? '기사모바일' : '실장'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="import-option">
            <input type="checkbox" checked={resetPassword} onChange={(e) => setResetPassword(e.target.checked)} /> 이미 있는 실장 계정은 <b>비밀번호만 엑셀 것으로 바꾸기</b> (관리자 계정은 바꾸지 않음)
          </label>
          <div className="import-actions">
            <button type="button" className="btn-dark-lg sm" disabled={busy} onClick={run}>{busy ? '등록 중...' : `계정 ${rows.length}개 등록`}</button>
            <button type="button" className="btn-dark-lg sm cancel" onClick={() => setRows(null)}>취소</button>
          </div>
        </>
      )}
      {result && (
        <div className="import-result">
          ✔ 실장 계정 {result.created}개 · 기사모바일 계정 {result.engineers}개{result.updated ? ` · 비밀번호 바꿈 ${result.updated}개` : ''} · 이미 있어 건너뜀 {result.skipped}개
          {result.errors.length > 0 && (
            <ul className="text-red">
              {result.errors.map((x, i) => (
                <li key={i}>
                  {x.name}: {x.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// 4) 상품 목록 — 예전 프로그램 상품 화면을 통째로 복사해 붙여넣거나, 엑셀 파일
function ProductImport() {
  const { handleError } = useAuth();
  const [text, setText] = useState('');
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const preview = (list, hint) => {
    setResult(null);
    if (!list.length) return alert(hint);
    setRows(list);
  };

  const fromText = () => preview(parseProductText(text), '상품 줄을 찾지 못했습니다. 예전 프로그램 상품 목록의 [번호 ~ 노출여부] 칸을 그대로 복사해 붙여넣어 주세요.');

  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await readFile(file), { type: 'array' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const get = (r, ...keys) => String(keys.map((k) => r[k]).find((v) => String(v).trim()) || '').trim();
      const list = data
        .map((r) => ({
          name: get(r, '상품명', 'name'),
          kind: get(r, '구분'),
          category: get(r, '품목'),
          detail: get(r, '상세품목'),
          freeDetail: get(r, '무료시공내역'),
          price: get(r, '가격', '금액'),
          visible: !/^(n|no|아니오|숨김|비활성)$/i.test(get(r, '노출여부', '활성화')),
        }))
        .filter((r) => r.name);
      preview(list, '첫 줄에 "상품명, 구분, 품목, 상세품목, 노출여부" 제목이 있는지 확인해 주세요.');
    } catch (err) {
      alert(err.message);
    }
  };

  const run = async () => {
    setBusy(true);
    const sum = { created: 0, skipped: 0, errors: [] };
    try {
      for (let i = 0; i < rows.length; i += 100) {
        const r = await imports.products(rows.slice(i, i + 100));
        sum.created += r.created;
        sum.skipped += r.skipped;
        sum.errors.push(...r.errors);
      }
      setRows(null);
      setText('');
    } catch (err) {
      handleError(err);
    } finally {
      setResult(sum);
      setBusy(false);
    }
  };

  return (
    <section className="import-box">
      <h3>4. 상품 목록</h3>
      <p className="sub-text">
        예전 프로그램 상품 목록 화면을 <b>번호부터 노출여부까지 통째로 복사</b>해 아래에 붙여넣거나, 엑셀(첫 줄 제목: <b>상품명, 구분, 품목, 상세품목, 노출여부</b>)을 고르세요. 노출여부 N 은 비활성으로 들어가고, 품목이 비어 있으면 상품명으로 짐작합니다. 가격은 0 으로 들어가니 [상품관리]에서 넣어 주세요. 같은 상품명·상세품목은 건너뜁니다.
      </p>
      <textarea className="import-paste" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="여기에 붙여넣기" />
      <div className="import-actions">
        <button type="button" className="btn-dark-lg sm" disabled={!text.trim()} onClick={fromText}>붙여넣은 내용 미리보기</button>
        <label className="btn-file">
          엑셀 파일 선택
          <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} hidden />
        </label>
      </div>
      {rows && (
        <>
          <div className="table-responsive import-preview">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>상품명</th>
                  <th>구분</th>
                  <th>품목</th>
                  <th>상세품목</th>
                  <th>노출</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="text-left">{r.name}</td>
                    <td>{r.kind || '-'}</td>
                    <td>{r.category || <span className="sub-text">(짐작)</span>}</td>
                    <td className="text-left">{r.detail.length > 60 ? `${r.detail.slice(0, 60)}…` : r.detail || '-'}</td>
                    <td>{r.visible ? 'Y' : <span className="text-red">N</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-actions">
            <button type="button" className="btn-dark-lg sm" disabled={busy} onClick={run}>{busy ? '등록 중...' : `상품 ${rows.length}개 등록`}</button>
            <button type="button" className="btn-dark-lg sm cancel" onClick={() => setRows(null)}>취소</button>
          </div>
        </>
      )}
      {result && (
        <div className="import-result">
          ✔ 상품 {result.created}개 등록 · 이미 있어 건너뜀 {result.skipped}개
        </div>
      )}
    </section>
  );
}

// 5) 아파트 목록 — 예전 프로그램 아파트 화면을 통째로 복사해 붙여넣거나, 엑셀
function ApartmentImport() {
  const { handleError } = useAuth();
  const [text, setText] = useState('');
  const [rows, setRows] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const preview = (list, hint) => {
    setResult(null);
    if (!list.length) return alert(hint);
    setRows(list);
  };

  const fromText = () => preview(parseApartmentText(text), '아파트 줄을 찾지 못했습니다. 예전 프로그램 아파트 목록의 [번호, 지역(시도 / 시군구), 아파트명] 칸을 그대로 복사해 붙여넣어 주세요.');

  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await readFile(file), { type: 'array' });
      const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
      const get = (r, ...keys) => String(keys.map((k) => r[k]).find((v) => String(v).trim()) || '').trim();
      const list = data
        .map((r) => {
          const [sido = '', sigungu = ''] = get(r, '지역').split('/').map((x) => x.trim());
          return { sido: normalizeSido(get(r, '시도') || sido), sigungu: get(r, '시군구') || sigungu, name: get(r, '아파트명', '아파트', '단지명', 'name') };
        })
        .filter((r) => r.name);
      preview(list, '첫 줄에 "시도, 시군구, 아파트명" 제목이 있는지 확인해 주세요.');
    } catch (err) {
      alert(err.message);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      setResult(await apartments.importMany(rows));
      setRows(null);
      setText('');
    } catch (err) {
      handleError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="import-box">
      <h3>5. 아파트 목록</h3>
      <p className="sub-text">
        예전 프로그램 아파트 목록 화면을 <b>번호부터 아파트명까지 통째로 복사</b>해 붙여넣거나, 엑셀(첫 줄 제목: <b>시도, 시군구, 아파트명</b>)을 고르세요. 이미 있는 아파트(띄어쓰기 무시 같은 이름)는 지역이 비어 있으면 지역만 채우고, 아니면 건너뜁니다.
      </p>
      <textarea className="import-paste" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="여기에 붙여넣기" />
      <div className="import-actions">
        <button type="button" className="btn-dark-lg sm" disabled={!text.trim()} onClick={fromText}>붙여넣은 내용 미리보기</button>
        <label className="btn-file">
          엑셀 파일 선택
          <input type="file" accept=".xlsx,.xls,.csv" onChange={pick} hidden />
        </label>
      </div>
      {rows && (
        <>
          <div className="table-responsive import-preview">
            <table className="customer-table">
              <thead>
                <tr>
                  <th>시도</th>
                  <th>시군구</th>
                  <th>아파트명</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.sido || '-'}</td>
                    <td>{r.sigungu || '-'}</td>
                    <td className="text-left">{r.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="import-actions">
            <button type="button" className="btn-dark-lg sm" disabled={busy} onClick={run}>{busy ? '등록 중...' : `아파트 ${rows.length}개 등록`}</button>
            <button type="button" className="btn-dark-lg sm cancel" onClick={() => setRows(null)}>취소</button>
          </div>
        </>
      )}
      {result && (
        <div className="import-result">
          ✔ 새로 등록 {result.created}개 · 지역 채움 {result.updated}개 · 이미 있어 건너뜀 {result.skipped}개
        </div>
      )}
    </section>
  );
}

// [임시 · 한 번만 쓰는 칸] 예전 프로그램 계약의 작성자(계약담당) 맞추기 — 실장님 계약을 다 옮기면 이 칸과 imports.reassignOwner 를 지웁니다
//   예전 프로그램 계약관리에서 실장님별로 거른 목록(번호·브랜드·시공종류·…·연락처·아파트명 순서)을 표째 복사해 붙여 넣음
const OWNER_FIELDS = ['contractDate', 'category', 'customerName', 'customerPhone', 'aptName', 'dong', 'ho'];
function parseOwnerList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((l) => l.split('\t').map((x) => x.trim()))
    .filter((cells) => /^\d+$/.test(cells[0]) && /^\d{4}-\d{2}-\d{2}$/.test(cells[6] || '')) // 제목 줄·빈 줄 빼고 계약 줄만
    .map((cells) => {
      const r = mapLegacyRow({ cells });
      return Object.fromEntries(OWNER_FIELDS.map((k) => [k, r[k] || '']));
    });
}

function OwnerFix() {
  const { handleError } = useAuth();
  const [staff, setStaff] = useState([]);
  const [ownerId, setOwnerId] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // 같은 이름 계정(예: 관리자 장경국 / 실장 아이디 jang)이 있어도 구분되게 아이디까지 보여 줌
    users
      .list()
      .then((list) => setStaff(list.filter((u) => u.active !== false)))
      .catch(() => {});
  }, []);
  const rows = parseOwnerList(text);
  const call = async (apply) => {
    setBusy(true);
    try {
      const r = await imports.reassignOwner({ rows, ownerId, apply });
      if (apply) {
        setDone(r);
        setPreview(null);
        setText('');
      } else {
        setPreview(r);
        setDone(null);
      }
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="import-box">
      <h3>6. 예전 계약 작성자(계약담당) 맞추기 <span className="sub-text">— 임시 기능</span></h3>
      <p className="sub-text">
        예전 프로그램에서 가져온 계약은 모두 가져오기를 한 관리자 이름으로 들어가 있습니다. 예전 프로그램 계약관리에서 <b>실장님 한 분으로 거른 목록</b>을 표째 복사해 아래에 붙여 넣고,
        그 실장님을 고른 뒤 [찾아보기] → [바꾸기]를 누르세요. 실장님마다 한 번씩 하면 됩니다.
      </p>
      <div className="inline-fields" style={{ marginBottom: 8 }}>
        <select className="input-text" value={ownerId} onChange={(e) => { setOwnerId(e.target.value); setPreview(null); setDone(null); }}>
          <option value="">실장님 고르기</option>
          {staff.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.loginId})</option>
          ))}
        </select>
        <span className="sub-text">붙여 넣은 계약 {rows.length}건</span>
      </div>
      <textarea
        className="input-text full"
        rows={6}
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview(null); setDone(null); }}
        placeholder={'번호\t브랜드\t시공종류\t번호\t접수형태\t시공상태\t계약일\t계약자\t연락처\t아파트명 …\n214\t더좋은집\t줄눈\t박람\t시공\t미정\t2026-11-01\t박순자(승인)\t010-…'}
      />
      <div className="import-actions">
        <button type="button" className="btn-dark-lg sm" disabled={busy || !ownerId || !rows.length} onClick={() => call(false)}>
          {busy && !preview ? '찾는 중...' : '찾아보기'}
        </button>
        {preview && preview.changed > 0 && (
          <button type="button" className="btn-dark-lg sm" disabled={busy} onClick={() => call(true)}>
            {busy ? '바꾸는 중...' : `${preview.changed}건 계약담당을 ${preview.ownerName}(${preview.ownerLoginId})(으)로 바꾸기`}
          </button>
        )}
      </div>
      {preview && (
        <div className="import-result">
          붙여 넣은 {preview.total}건 중 <b>{preview.matched}건 찾음</b>
          {preview.changed > 0 && <> · 바뀔 계약 {preview.changed}건 (지금 담당: {Object.entries(preview.fromOwners).map(([k, v]) => `${k} ${v}건`).join(', ')})</>}
          {preview.already > 0 && <> · 이미 {preview.ownerName} {preview.already}건</>}
          {preview.notFoundCount > 0 && (
            <div className="text-red">
              못 찾은 계약 {preview.notFoundCount}건 (그대로 둡니다):
              {preview.notFound.map((t, i) => (
                <div key={i}>· {t}</div>
              ))}
            </div>
          )}
        </div>
      )}
      {done && (
        <div className="import-result">
          ✔ {done.changed}건의 계약담당을 <b>{done.ownerName}</b>(으)로 바꿨습니다.{done.already ? ` (이미 ${done.ownerName} ${done.already}건)` : ''} 계약마다 변경이력에 남았습니다.
        </div>
      )}
    </section>
  );
}
