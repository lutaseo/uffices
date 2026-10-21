import React, { useEffect, useMemo, useState } from 'react';
import {
  contracts as contractApi,
  customers as customerApi,
  engineerOffs as offApi,
  products as productApi,
  teams as teamApi,
  users as userApi,
} from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import MoneyInput from '../components/MoneyInput.jsx';
import PaymentPhotos from '../components/PaymentPhotos.jsx';
import PaperPhotos from '../components/PaperPhotos.jsx';
import EngineerPicker from '../components/EngineerPicker.jsx';
import AptSearchInput from '../components/AptSearchInput.jsx';
import { ROLES } from '../auth/permissions.js';
import {
  ISSUE_STATUS,
  APPROVAL_STATUS,
  ASSIGN_TYPES,
  BRANDS,
  CATEGORIES,
  DEFAULT_SCHEDULE_SETTINGS,
  MAX_SCHEDULE_STEPS,
  OFF_LABEL,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  RECEPTION_TYPES,
  WORK_STATUS,
  WORK_TYPES,
} from '../constants.js';
import {
  calcAmounts,
  groupPrefill,
  offBlocks,
  slotOf,
  teamOffStatus,
  timeFieldsOf,
  timeOptions,
  timeValueOf,
} from '../utils/contract.js';
import { today } from '../utils/date.js';
import { formatPhone, won } from '../utils/format.js';
import ContractViewModal from '../components/ContractViewModal.jsx';

const CIRCLED = ['①', '②', '③'];

const emptySchedule = () => ({ date: '', time: '', ampm: '', assignType: ASSIGN_TYPES.ENGINEER, engineerId: '', teamId: '', memo: '' });

// 기사의 담당시공에 이 구분이 들어 있는지 (예전 데이터는 category 글자로 판단)
const doesCategory = (en, category) => (Array.isArray(en.categories) && en.categories.length ? en.categories.includes(category) : String(en.category || '').includes(category));

function initialForm(contract, company, user) {
  if (contract) {
    const steps = contract.schedules.map((s) => ({
      ...s,
      engineerId: s.engineerId ? String(s.engineerId) : '',
      teamId: s.teamId ? String(s.teamId) : '',
    }));
    while (steps.length < MAX_SCHEDULE_STEPS) steps.push(emptySchedule());
    return {
      ...contract,
      ownerId: String(contract.ownerId || ''),
      schedules: steps,
      lineItems: (contract.lineItems || []).map((l) => ({ ...l })),
      payments: (contract.payments || []).map((p) => ({ ...p })),
    };
  }
  return {
    brand: company?.brands?.[0] || BRANDS[0],
    customerName: '',
    customerPhone: '',
    customerPhone2: '',
    ownerId: String(user.id),
    aptName: '',
    dong: '',
    ho: '',
    aptType: '',
    area: '',
    contractDate: today(),
    moveInDate: '',
    approval: '승인',
    taxInvoice: '',
    cashReceipt: '',
    engineerNote: '',
    memo: '',
    category: CATEGORIES[0],
    workType: WORK_TYPES[0],
    receptionType: RECEPTION_TYPES[0],
    schedules: Array.from({ length: MAX_SCHEDULE_STEPS }, emptySchedule),
    status: '미정',
    completedDate: '',
    canceledDate: '',
    cancelReason: '',
    lineItems: [],
    items: '',
    totalAmount: '',
    discount: '',
    voucher: '',
    discountReason: '',
    payments: [],
    happyCallMemo: '',
    customerNote: '',
  };
}

// 계약서 작성/수정 화면. contractId 가 없으면 신규.
// prefillFrom: 이 계약과 같은 계약자·현장으로 새 시공을 추가할 때 원본 계약 id
// prefillCategory: 계약 상세의 [+ 청소] 등으로 들어오면 그 구분으로 시작
export default function ContractEditor({ contractId, prefillFrom, prefillCategory, engineers, onClose }) {
  const { user, company, can, handleError } = useAuth();
  const isEdit = !!contractId;
  const showAmount = can('contract.amount');
  const canApprove = can('contract.approve');
  const settings = { ...DEFAULT_SCHEDULE_SETTINGS, ...(company?.scheduleSettings || {}) };
  const brands = company?.brands?.length ? company.brands : BRANDS;

  const [contract, setContract] = useState(null);
  const [form, setForm] = useState(() => (isEdit || prefillFrom ? null : initialForm(null, company, user)));
  const [saving, setSaving] = useState(false);
  const [productList, setProductList] = useState([]);
  const [allProducts, setAllProducts] = useState(false);
  // 구분(줄눈·청소·탄성…)을 고르면 그 시공 상품만 (전체 상품 보기로 넓힐 수 있음)
  const shownProducts = (form ? productList.filter((p) => allProducts || p.category === form.category) : []).sort(
    (a, b) => (a.kind || '').localeCompare(b.kind || '') || a.id - b.id,
  );
  const [crewTeams, setCrewTeams] = useState([]);
  const [staff, setStaff] = useState([]);
  const [offs, setOffs] = useState([]);
  const [customerResults, setCustomerResults] = useState(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [paper, setPaper] = useState({ saved: null, add: [], remove: [] }); // 실물 계약서 사진 (저장 뒤 올림)

  useEffect(() => {
    if (!isEdit && prefillFrom) {
      contractApi
        .get(prefillFrom)
        .then((src) => setForm({ ...initialForm(null, company, user), ...groupPrefill(src), ...(CATEGORIES.includes(prefillCategory) ? { category: prefillCategory } : {}) }))
        .catch(() => setForm(initialForm(null, company, user)));
    }
    if (isEdit) {
      contractApi
        .get(contractId)
        .then((c) => {
          setContract(c);
          setForm(initialForm(c, company, user));
        })
        .catch((e) => {
          handleError(e);
          onClose();
        });
    }
    productApi.list().then(setProductList).catch(() => {});
    teamApi.list().then((t) => setCrewTeams(t.filter((x) => x.kind === '시공팀'))).catch(() => {});
    if (user.role === ROLES.ADMIN) userApi.staffOptions().then(setStaff).catch(() => {});
  }, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 입력된 시공일의 기사 휴무 조회 → 기사 선택 목록에 표시/비활성화
  const scheduleDates = (form?.schedules || []).map((s) => s.date).filter(Boolean).sort();
  const datesKey = scheduleDates.join(',');
  useEffect(() => {
    if (!scheduleDates.length) {
      setOffs([]);
      return;
    }
    offApi
      .list({ from: scheduleDates[0], to: scheduleDates[scheduleDates.length - 1] })
      .then(setOffs)
      .catch(() => setOffs([]));
  }, [datesKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const offOf = (engineerId, date) => offs.find((o) => String(o.engineerId) === String(engineerId) && o.date === date);

  const amounts = useMemo(() => {
    if (!form) return calcAmounts({});
    const lineTotal = form.lineItems.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);
    return calcAmounts({ ...form, totalAmount: form.lineItems.length ? lineTotal : form.totalAmount });
  }, [form]);

  if (!form) return <div className="page-card page-loading">불러오는 중...</div>;

  const set = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));
  const onField = (e) => set(e.target.name, e.target.value);
  const setStep = (i, patch) =>
    setForm((prev) => ({ ...prev, schedules: prev.schedules.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const setLine = (i, patch) =>
    setForm((prev) => ({ ...prev, lineItems: prev.lineItems.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const setPay = (i, patch) =>
    setForm((prev) => ({ ...prev, payments: prev.payments.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  const addProduct = (id) => {
    const p = productList.find((x) => x.id === Number(id));
    if (!p) return;
    setForm((prev) => ({
      ...prev,
      lineItems: [
        ...prev.lineItems,
        { productId: p.id, name: p.name, detail: [p.detail, p.freeDetail && `[무료시공] ${p.freeDetail}`].filter(Boolean).join('\n'), qty: 1, unitPrice: p.price },
      ],
    }));
  };

  const searchCustomer = async () => {
    const q = form.customerName || form.customerPhone;
    if (!q.trim()) {
      alert('고객명 또는 연락처를 입력한 후 검색해 주세요.');
      return;
    }
    try {
      setCustomerResults(await customerApi.list(q));
    } catch (e) {
      handleError(e);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (showAmount && amounts.balance < 0 && !window.confirm(`입금액이 실계약금보다 ${won(-amounts.balance)}원 많습니다. 그대로 저장하시겠습니까?`)) return;
    // 비어 있는 뒤쪽 회차는 저장하지 않음 (①은 항상 유지)
    const schedules = form.schedules.filter(
      (s, i) => i === 0 || s.date || s.engineerId || s.teamId || s.time || s.ampm || s.mobileStatus,
    );
    setSaving(true);
    try {
      // 입금 줄의 사진(_add/_remove/_saved)은 계약 저장 뒤 입금별로 따로 올림 (한 번에 보내면 용량 한도 초과 위험)
      const strip = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.startsWith('_')));
      const payload = { ...form, schedules, payments: form.payments.map(strip) };
      let saved = isEdit ? await contractApi.update(contractId, payload) : await contractApi.create(payload);
      const kept = form.payments.filter((p) => Number(p.amount)); // 서버도 금액 0인 줄은 저장하지 않음 → 순서가 같음
      let photoError = '';
      for (let i = 0; i < kept.length; i++) {
        const row = kept[i];
        const target = saved.payments?.[i];
        if (!target || (!(row._add || []).length && !(row._remove || []).length)) continue;
        try {
          saved = await contractApi.paymentPhotos(saved.id, target.id, { add: row._add || [], remove: (row._remove || []).filter((id) => id != null) });
        } catch (err) {
          photoError = err.message;
        }
      }
      // 실물 계약서 사진: 지울 것 먼저, 새 사진은 한 장씩 (요청 용량 한도 때문)
      try {
        const removeIds = paper.remove.filter((id) => id != null);
        if (removeIds.length) saved = await contractApi.setPaperPhotos(saved.id, { remove: removeIds });
        for (const img of paper.add) saved = await contractApi.setPaperPhotos(saved.id, { add: [img] });
      } catch (err) {
        photoError = `${photoError ? `${photoError}\n` : ''}실물 계약서 사진: ${err.message}`;
      }
      if (photoError) alert(`계약은 저장되었지만 사진 일부를 올리지 못했습니다.\n${photoError}\n계약 수정에서 다시 첨부해 주세요.`);
      else alert(isEdit ? '저장되었습니다.' : `계약이 등록되었습니다. (No.${saved.no})`);
      onClose(saved, isEdit);
    } catch (err) {
      handleError(err);
      setSaving(false);
    }
  };

  const radios = (name, list, value = form[name], onChange = (v) => set(name, v)) =>
    list.map((v) => (
      <label key={v} className="radio-item">
        <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} /> {v}
      </label>
    ));

  const timeOpts = timeOptions(settings);

  return (
    <div className="page-card contract-editor">
      <div className="page-title-row">
        <h2>계약관리</h2>
        <button type="button" className="btn-outline-action" style={{ marginLeft: 'auto' }} onClick={() => onClose()}>
          ← 뒤로
        </button>
      </div>

      <form onSubmit={handleSave}>
        {/* ---------------- 1. 계약정보 ---------------- */}
        <h3 className="form-section-title">&gt; 계약정보 {isEdit ? `수정 (No.${contract.no})` : '등록'}</h3>
        {isEdit && contract.esign?.status === '서명완료' && (
          <p className="warn-box">⚠ 서명이 완료된 계약입니다. 시공내용이나 금액을 바꾸면 서명이 초기화되어 재서명이 필요합니다.</p>
        )}
        <table className="form-grid-table">
          <tbody>
            <tr>
              <td className="label-col">브랜드<span className="star">*</span></td>
              <td className="input-col">
                {radios('brand', brands)}
                <PaperPhotos contractId={contractId} savedCount={contract?.paperPhotoCount || 0} value={paper} onChange={setPaper} />
                <span className="info-guide">ⓘ 타업체 수주 또는 내부 구분이 필요할 때 브랜드로 구분합니다. 종이에 쓴 계약서는 사진으로 올려 두세요.</span>
              </td>
            </tr>
            <tr>
              <td className="label-col">고객명<span className="star">*</span></td>
              <td className="input-col">
                {isEdit ? (
                  <strong>{form.customerName}</strong>
                ) : (
                  <div className="inline-fields">
                    <input className="input-text" name="customerName" value={form.customerName} onChange={onField} placeholder="고객명" required />
                    {can('customer.view') && (
                      <button type="button" className="btn-dark-sm" onClick={searchCustomer}>고객명검색</button>
                    )}
                  </div>
                )}
                <span className="info-guide">ⓘ 계약자명은 등록 후 수정이 불가합니다.</span>
                {customerResults && (
                  <div className="inline-search-result">
                    {customerResults.length === 0 ? (
                      <p className="sub-text" style={{ padding: 8 }}>일치하는 계약자가 없습니다. 저장 시 새 계약자로 자동 등록됩니다.</p>
                    ) : (
                      customerResults.slice(0, 8).map((c) => (
                        <div key={c.id} className="search-result-row">
                          <span>
                            <strong>{c.name}</strong> {c.phone1} {c.phone2 && `/ ${c.phone2}`} <span className="sub-text">(계약 {c.contractCount}건)</span>
                          </span>
                          <button
                            type="button"
                            className="btn-dark-sm"
                            onClick={() => {
                              setForm((prev) => ({ ...prev, customerName: c.name, customerPhone: c.phone1, customerPhone2: c.phone2 || '' }));
                              setCustomerResults(null);
                            }}
                          >
                            선택
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </td>
            </tr>
            <tr>
              <td className="label-col">고객 연락처 ①<span className="star">*</span></td>
              <td className="input-col">
                <input type="tel" className="input-text" value={form.customerPhone} onChange={(e) => set('customerPhone', formatPhone(e.target.value))} placeholder="010-0000-0000" required />
              </td>
            </tr>
            <tr>
              <td className="label-col">고객 연락처 ②</td>
              <td className="input-col">
                <input type="tel" className="input-text" value={form.customerPhone2} onChange={(e) => set('customerPhone2', formatPhone(e.target.value))} placeholder="010-0000-0000" />
              </td>
            </tr>
            <tr>
              <td className="label-col">계약담당<span className="star">*</span></td>
              <td className="input-col">
                {user.role === ROLES.ADMIN ? (
                  <select className="input-text" value={form.ownerId} onChange={(e) => set('ownerId', e.target.value)}>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                ) : (
                  <span>{isEdit ? contract.ownerName : user.name}</span>
                )}
              </td>
            </tr>
            <tr>
              <td className="label-col">현장<span className="star">*</span></td>
              <td className="input-col inline-fields">
                <AptSearchInput value={form.aptName} onChange={(v) => set('aptName', v)} required />
                <input className="input-text" name="dong" value={form.dong} onChange={onField} style={{ width: 70 }} /> 동
                <input className="input-text" name="ho" value={form.ho} onChange={onField} style={{ width: 70 }} /> 호
                <span>타입</span>
                <input className="input-text" name="aptType" value={form.aptType} onChange={onField} style={{ width: 80 }} />
                <input className="input-text" name="area" value={form.area} onChange={onField} style={{ width: 60 }} /> 평
              </td>
            </tr>
            <tr>
              <td className="label-col">계약일<span className="star">*</span></td>
              <td className="input-col inline-fields">
                <input type="date" className="input-text" name="contractDate" value={form.contractDate} onChange={onField} required />
                <button type="button" className="btn-dark-sm" onClick={() => set('contractDate', '')}>초기화</button>
              </td>
            </tr>
            <tr>
              <td className="label-col">입주예정일</td>
              <td className="input-col">
                <input type="date" className="input-text" name="moveInDate" value={form.moveInDate} onChange={onField} />
              </td>
            </tr>
            <tr>
              <td className="label-col">계약승인</td>
              <td className="input-col">
                {canApprove ? (
                  radios('approval', APPROVAL_STATUS)
                ) : (
                  <span>
                    {isEdit ? form.approval : '승인대기'}{' '}
                    <span className="sub-text">(승인 권한이 있는 관리자가 승인합니다)</span>
                  </span>
                )}
              </td>
            </tr>
            <tr>
              <td className="label-col">세금계산서 / 현금영수증</td>
              <td className="input-col inline-fields">
                <label className="inline-label">
                  세금계산서
                  <select className="input-text" value={form.taxInvoice || ''} onChange={(e) => set('taxInvoice', e.target.value)}>
                    {ISSUE_STATUS.map((v) => <option key={v} value={v}>{v || '선택'}</option>)}
                  </select>
                </label>
                <label className="inline-label">
                  현금영수증
                  <select className="input-text" value={form.cashReceipt || ''} onChange={(e) => set('cashReceipt', e.target.value)}>
                    {ISSUE_STATUS.map((v) => <option key={v} value={v}>{v || '선택'}</option>)}
                  </select>
                </label>
              </td>
            </tr>
            <tr>
              <td className="label-col">기타사항</td>
              <td className="input-col">
                <textarea className="input-text full" rows={3} name="memo" value={form.memo} onChange={onField} placeholder="내용입력 (내부용, 고객에게 표시되지 않음)" />
              </td>
            </tr>
            <tr>
              <td className="label-col">고객 참고사항</td>
              <td className="input-col">
                <textarea className="input-text full customer-note-input" rows={3} name="customerNote" value={form.customerNote || ''} onChange={onField} maxLength={1000} placeholder="고객에게 보이는 안내 (계약서·서명 화면에 표시) 예: 시공 당일 현관 비밀번호를 알려주세요. 시공 후 24시간 물 사용을 피해 주세요." />
                <div className="sub-text text-blue">ⓘ 이 칸은 <b>고객에게 보입니다</b> (계약서·전자서명 화면). 내부 메모는 위 [기타사항]에 적어 주세요.</div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ---------------- 2. 시공 구분 (먼저 골라야 아래 상품 목록이 그 구분 것으로 나옴) ---------------- */}
        <h3 className="form-section-title">&gt; 시공 구분</h3>
        <table className="form-grid-table">
          <tbody>
            <tr>
              <td className="label-col">구분</td>
              <td className="input-col">{radios('category', CATEGORIES)}</td>
            </tr>
            <tr>
              <td className="label-col">시공종류</td>
              <td className="input-col">{radios('workType', WORK_TYPES)}</td>
            </tr>
            <tr>
              <td className="label-col">접수형태</td>
              <td className="input-col">{radios('receptionType', RECEPTION_TYPES)}</td>
            </tr>
          </tbody>
        </table>

        {/* ---------------- 3. 시공내역 · 금액 ---------------- */}
        <h3 className="form-section-title">&gt; 시공내역 · 금액</h3>
        <table className="form-grid-table">
          <tbody>
            <tr>
              <td className="label-col">상품선택</td>
              <td className="input-col">
                {showAmount ? (
                  <>
                    <div className="inline-fields" style={{ marginBottom: 8 }}>
                      <select className="input-text product-select" value="" onChange={(e) => addProduct(e.target.value)}>
                        <option value="">
                          + {allProducts ? '상품 추가 (전체)' : `${form.category} 상품 추가`} ({shownProducts.length}개)
                        </option>
                        {shownProducts.map((p) => (
                          <option key={p.id} value={p.id}>
                            [{allProducts ? `${p.category}/` : ''}{p.kind}] {p.name} — {won(p.price)}원
                          </option>
                        ))}
                      </select>
                      <label className="radio-item">
                        <input type="checkbox" checked={allProducts} onChange={(e) => setAllProducts(e.target.checked)} /> 전체 상품 보기
                      </label>
                      {!allProducts && !shownProducts.length && <span className="sub-text">등록된 {form.category} 상품이 없습니다 (설정 → 상품관리)</span>}
                      <button type="button" className="btn-dark-sm" onClick={() => set('lineItems', [...form.lineItems, { productId: null, name: '', detail: '', qty: 1, unitPrice: 0 }])}>
                        + 직접입력
                      </button>
                    </div>
                    {form.lineItems.length > 0 && (
                      <table className="line-items">
                        <thead>
                          <tr>
                            <th>상품명</th>
                            <th>상세품목</th>
                            <th>수량</th>
                            <th>단가</th>
                            <th>금액</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {form.lineItems.map((l, i) => (
                            <tr key={i}>
                              <td><input className="input-text full" value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></td>
                              <td><input className="input-text full" value={l.detail} onChange={(e) => setLine(i, { detail: e.target.value })} /></td>
                              <td><input type="number" min="1" className="input-text" style={{ width: 60 }} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} /></td>
                              <td><input type="number" min="0" className="input-text money" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: e.target.value })} /></td>
                              <td className="text-right">{won((Number(l.qty) || 0) * (Number(l.unitPrice) || 0))}</td>
                              <td>
                                <button type="button" className="btn-text-danger" onClick={() => set('lineItems', form.lineItems.filter((_, j) => j !== i))}>삭제</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                ) : (
                  <div>
                    {(form.lineItems || []).map((l, i) => (
                      <div key={i}>· {l.name}{l.qty > 1 ? ` x${l.qty}` : ''}</div>
                    ))}
                    <span className="sub-text">상품/금액 수정은 '금액·입금 정보 보기' 권한이 필요합니다.</span>
                  </div>
                )}
              </td>
            </tr>
            <tr>
              <td className="label-col">추가 시공내용</td>
              <td className="input-col">
                <textarea className="input-text full" rows={2} name="items" value={form.items} onChange={onField} placeholder="상품 외 추가 내용 (예: 무료 실리콘 오염방지)" />
              </td>
            </tr>
            {showAmount && (
              <>
                <tr>
                  <td className="label-col">금액</td>
                  <td className="input-col">
                    <div className="amount-fields">
                    <label className="inline-label">
                      시공총액
                      {form.lineItems.length ? (
                        <strong>{won(amounts.total)}원</strong>
                      ) : (
                        <MoneyInput value={form.totalAmount} onChange={(v) => set('totalAmount', v)} />
                      )}
                    </label>
                    <label className="inline-label">
                      할인 <MoneyInput value={form.discount} onChange={(v) => set('discount', v)} placeholder="예: 10000" />
                    </label>
                    <label className="inline-label">
                      상품권 <MoneyInput value={form.voucher} onChange={(v) => set('voucher', v)} />
                    </label>
                    <span className="calc-result">
                      실계약금 <strong>{won(amounts.actual)}</strong>원
                    </span>
                    {form.lineItems.length > 0 && <span className="sub-text">(상품내역이 있으면 시공총액은 자동 합계)</span>}
                    <input className="input-text discount-reason-input" name="discountReason" value={form.discountReason || ''} onChange={onField} placeholder="할인 사유 (예: 박람회 현장 할인)" maxLength={100} />
                    </div>
                  </td>
                </tr>
                <tr>
                  <td className="label-col">입금 내역</td>
                  <td className="input-col">
                    {form.payments.map((p, i) => (
                      <div key={i} className="inline-fields schedule-row">
                        <input type="date" className="input-text" value={p.date} onChange={(e) => setPay(i, { date: e.target.value })} />
                        <select className="input-text" value={p.kind} onChange={(e) => setPay(i, { kind: e.target.value })}>
                          {PAYMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                        </select>
                        <select className="input-text" value={p.method} onChange={(e) => setPay(i, { method: e.target.value })}>
                          {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <MoneyInput value={p.amount} onChange={(v) => setPay(i, { amount: v })} placeholder="금액" />
                        <input className="input-text" value={p.memo || ''} onChange={(e) => setPay(i, { memo: e.target.value })} placeholder="메모 (입금자명 등)" />
                        <PaymentPhotos contractId={contractId} payment={p} onChange={(patch) => setPay(i, patch)} />
                        <button type="button" className="btn-text-danger pay-row-delete" onClick={() => set('payments', form.payments.filter((_, j) => j !== i))}>삭제</button>
                      </div>
                    ))}
                    <div className="inline-fields">
                      <button
                        type="button"
                        className="btn-dark-sm"
                        onClick={() =>
                          set('payments', [
                            ...form.payments,
                            { date: today(), kind: form.payments.length ? '잔금' : '계약금', method: PAYMENT_METHODS[0], amount: '', memo: '' },
                          ])
                        }
                      >
                        + 입금 추가
                      </button>
                      <span className="calc-result">
                        입금 <strong>{won(amounts.paid)}</strong>원 / 잔액 <strong className={amounts.balance > 0 ? 'text-red' : ''}>{won(amounts.balance)}</strong>원
                      </span>
                    </div>
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>

        {/* ---------------- 4. 시공정보 (일정·담당) ---------------- */}
        <h3 className="form-section-title">&gt; 시공정보</h3>
        <table className="form-grid-table">
          <tbody>
            {form.schedules.map((s, i) => {
              const slot = slotOf(s, settings);
              const selectedOff = s.assignType === ASSIGN_TYPES.ENGINEER && s.engineerId && s.date ? offOf(s.engineerId, s.date) : null;
              const blocked = selectedOff && offBlocks(selectedOff.period, slot);
              const dayOffs = s.date ? offs.filter((o) => o.date === s.date) : [];
              return (
                <tr key={i} className="schedule-step-row">
                  <td className="label-col">시공 등록 {CIRCLED[i]}</td>
                  <td className="input-col">
                    <div className="inline-fields">
                      <input type="date" className="input-text" value={s.date} onChange={(e) => setStep(i, { date: e.target.value })} />
                      <button type="button" className="btn-dark-sm" onClick={() => setStep(i, { date: '', time: '', ampm: '' })}>초기화</button>
                      <select className="input-text" value={timeValueOf(s)} onChange={(e) => setStep(i, timeFieldsOf(e.target.value))}>
                        <option value="">시간</option>
                        <option value="AM">오전(시간미정)</option>
                        <option value="PM">오후(시간미정)</option>
                        {timeOpts.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                    {dayOffs.length > 0 && (
                      <div className="sub-text off-hint">
                        이날 휴무: {dayOffs.map((o) => `${o.engineerName}(${OFF_LABEL[o.period]})`).join(', ')}
                      </div>
                    )}
                  </td>
                  <td className="label-col">
                    시공담당 {CIRCLED[i]}
                    <div className="assign-type">
                      {[
                        [ASSIGN_TYPES.ENGINEER, '기사배정'],
                        [ASSIGN_TYPES.TEAM, '팀배정'],
                      ].map(([v, label]) => (
                        <label key={v}>
                          <input
                            type="radio"
                            name={`assign-${i}`}
                            checked={s.assignType === v}
                            onChange={() => setStep(i, { assignType: v, engineerId: '', teamId: '' })}
                          />{' '}
                          {label}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="input-col">
                    <div className="inline-fields">
                      {s.assignType === ASSIGN_TYPES.TEAM ? (
                        <select className="input-text" value={s.teamId} onChange={(e) => setStep(i, { teamId: e.target.value })}>
                          <option value="">팀선택</option>
                          {crewTeams.map((t) => {
                            const st = s.date ? teamOffStatus(t.id, engineers, (id) => offOf(id, s.date), slot) : null;
                            return (
                              <option key={t.id} value={t.id} disabled={st?.allOff && String(t.id) !== String(s.teamId)}>
                                {t.name}
                                {st?.total ? ` (${st.total}명${st.offCount ? `, 휴무 ${st.offCount}명` : ''})` : ''}
                                {st?.allOff ? ' — 전원 휴무' : ''}
                              </option>
                            );
                          })}
                        </select>
                      ) : (
                        <EngineerPicker
                          value={s.engineerId}
                          engineers={engineers.filter((en) => doesCategory(en, form.category))}
                          others={engineers.filter((en) => !doesCategory(en, form.category))}
                          fallbackName={s.engineerName}
                          placeholder={`${form.category} 기사 검색`}
                          info={(en) => {
                            const off = s.date ? offOf(en.id, s.date) : null;
                            return { disabled: !!(off && offBlocks(off.period, slot)) && String(en.id) !== String(s.engineerId), note: off ? `${OFF_LABEL[off.period]}휴무` : '' };
                          }}
                          onChange={(id) => setStep(i, { engineerId: id })}
                        />
                      )}
                      <button type="button" className="btn-dark-sm" onClick={() => setStep(i, { engineerId: '', teamId: '' })}>초기화</button>
                    </div>
                    {s.assignType === ASSIGN_TYPES.TEAM && s.teamId && s.date && teamOffStatus(s.teamId, engineers, (id) => offOf(id, s.date), slot).allOff && (
                      <div className="text-red off-hint">
                        선택한 팀은 이 시간대에 팀원 전원이 휴무입니다.{slot === null && ' 오전/오후 시간을 지정하면 배정할 수 있습니다.'}
                      </div>
                    )}
                    {blocked && (
                      <div className="text-red off-hint">
                        {engineers.find((en) => String(en.id) === String(s.engineerId))?.name || s.engineerName || '선택한 기사'} 기사는 이날 {OFF_LABEL[selectedOff.period]} 휴무입니다.
                        {selectedOff.period !== 'DAY' && slot === null && ` ${selectedOff.period === 'AM' ? '오후' : '오전'} 시간을 선택하면 배정할 수 있습니다.`}
                      </div>
                    )}
                  </td>
                  <td className="label-col">모바일웹 {CIRCLED[i]}</td>
                  <td className="input-col mobile-cell">
                    {s.mobileStatus ? (
                      <>
                        <span className="status-chip st-blue">{s.mobileStatus}</span>
                        <div className="sub-text">
                          {s.reportedBy} · {s.reportedAt && new Date(s.reportedAt).toLocaleString('ko-KR')}
                        </div>
                        {s.mobileMemo && <div className="sub-text">“{s.mobileMemo}”</div>}
                      </>
                    ) : (
                      <span className="sub-text">
                        ⓘ 시공기사가 모바일웹에서 보고한 '시공상태'가 표시됩니다. 표시값이 없을 경우 <span className="text-blue">'입력 전'</span>입니다.
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            <tr>
              <td className="label-col">기사전달사항</td>
              <td className="input-col" colSpan={5}>
                <textarea className="input-text full" rows={2} name="engineerNote" value={form.engineerNote || ''} onChange={onField} placeholder="기사모바일에 표시됩니다 (예: 현관 비밀번호, 주차 안내, 고객 요청사항)" />
              </td>
            </tr>
            <tr>
              <td className="label-col">시공상태(최종)</td>
              <td className="input-col" colSpan={5}>
                <p className="orange-guide">
                  ⓘ 기사가 보고한 '모바일웹' 상태값을 확인하신 후 아래 최종 시공상태 값을 선택해 주세요.
                  <br />ⓘ 아래 설정하신 상태값이 '고객 모바일웹(계약서 링크)'에 표시됩니다.
                </p>
                <div className="inline-fields">
                  {WORK_STATUS.map((v) => (
                    <React.Fragment key={v}>
                      <label className="radio-item">
                        <input type="radio" name="status" checked={form.status === v} onChange={() => set('status', v)} /> {v}
                      </label>
                      {v === '시공완료' && (
                        <input type="date" className="input-text" value={form.completedDate || ''} disabled={form.status !== '시공완료'} onChange={(e) => set('completedDate', e.target.value)} title="시공완료일" />
                      )}
                      {v === '취소' && (
                        <>
                          <input className="input-text" placeholder="취소사유" value={form.cancelReason || ''} disabled={form.status !== '취소'} onChange={(e) => set('cancelReason', e.target.value)} style={{ width: 220 }} />
                          <input type="date" className="input-text" value={form.canceledDate || ''} disabled={form.status !== '취소'} onChange={(e) => set('canceledDate', e.target.value)} title="취소일" />
                        </>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* ---------------- 4. 해피콜 ---------------- */}
        <h3 className="form-section-title">&gt; 해피콜 / 고객 응대 메모</h3>
        <textarea className="input-text full" rows={3} name="happyCallMemo" value={form.happyCallMemo} onChange={onField} placeholder="해피콜 통화 내용, 고객 요청사항 등 (내부용)" />

        <div className="form-bottom-btns">
          <button type="submit" className="btn-dark-lg" disabled={saving}>{saving ? '저장 중...' : '확인'}</button>
          <button type="button" className="btn-dark-lg cancel" onClick={() => onClose()}>취소</button>
          {isEdit && (
            <button type="button" className="btn-outline-action" onClick={() => setViewOpen(true)}>계약서 보기 / 서명요청</button>
          )}
        </div>
      </form>

      {/* ---------------- 5. 변경이력 ---------------- */}
      {isEdit && contract.history?.length > 0 && (
        <>
          <h3 className="form-section-title">&gt; 변경이력</h3>
          <div className="table-responsive">
            <table className="customer-table history-table">
              <thead>
                <tr>
                  <th>일시</th>
                  <th>변경자</th>
                  <th>내용</th>
                  <th>변경사항</th>
                </tr>
              </thead>
              <tbody>
                {[...contract.history].reverse().map((h, i) => (
                  <tr key={i}>
                    <td className="nowrap">{new Date(h.at).toLocaleString('ko-KR')}</td>
                    <td>{h.byName}</td>
                    <td>{h.action}</td>
                    <td className="text-left">
                      {h.changes?.map((c, j) => (
                        <div key={j}>
                          <strong>{c.label}</strong>: {c.from} → {c.to}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {viewOpen && <ContractViewModal contractId={contractId} onClose={() => setViewOpen(false)} />}
    </div>
  );
}
