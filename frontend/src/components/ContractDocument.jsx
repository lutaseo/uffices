import React from 'react';
import { calcAmounts, timeLabel } from '../utils/contract.js';
import { formatAddress, won } from '../utils/format.js';
import { DEFAULT_CONTRACT_TERMS } from '../constants.js';

// 계약 조건: 서명한 계약서는 서명 당시 조건, 아니면 업체 설정(없으면 기본값)
export const termsOf = (esign, company) =>
  esign?.status === '서명완료' && esign.terms?.length ? esign.terms : company?.contractTerms?.length ? company.contractTerms : DEFAULT_CONTRACT_TERMS;



const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// 계약서 본문. 내부 조회(ContractViewModal)와 고객 서명 페이지(SignPage)가 함께 사용합니다.
//   contracts 를 주면 같은 계약자·현장의 시공들(줄눈·청소 등)을 한 장으로 보여줌
export default function ContractDocument({ contract, contracts, company, showAmount = true, showStatus = false }) {
  const list = contracts?.length ? contracts : [contract];
  const first = list[0];
  const multi = list.length > 1;
  const esign = list.find((c) => c.esign?.signature)?.esign || first.esign || {};
  const amountOn = showAmount && !list.some((c) => c.amountHidden);
  const sums = list.map(calcAmounts).reduce((t, a) => ({ actual: t.actual + a.actual, paid: t.paid + a.paid, balance: t.balance + a.balance }), { actual: 0, paid: 0, balance: 0 });
  const workType = !multi && first.workType && first.workType !== '시공' ? `${first.workType} ` : '';
  const terms = termsOf(list.find((c) => c.esign?.terms)?.esign || esign, company);
  const phones = uniq([first.customerPhone, first.customerPhone2]).join(' / ');

  return (
    <div className="contract-doc">
      <h2 className="doc-title">
        {uniq(list.map((c) => c.brand)).join('·')} {uniq(list.map((c) => c.category)).join('·')} {workType}시공 계약서
      </h2>
      <p className="doc-no">
        계약번호 {list.map((c) => `No.${c.no ?? '-'}`).join(', ')} · 계약일 {uniq(list.map((c) => c.contractDate)).join(', ')}
      </p>
      {showStatus && (
        <div className="doc-status">
          현재 진행상태{' '}
          {list.map((c, i) => (
            <span key={c.id ?? i}>
              {i > 0 && ' · '}
              {multi && `${c.category} `}
              <strong>{c.status}</strong>
              {c.status === '시공완료' && c.completedDate && ` (${c.completedDate})`}
              {c.status === '취소' && c.cancelReason && ` — ${c.cancelReason}`}
            </span>
          ))}
        </div>
      )}

      <table className="doc-table">
        <tbody>
          <tr>
            <th>시공사</th>
            <td colSpan={3}>
              {company?.name}
              {[company?.ceo && `대표 ${company.ceo}`, company?.bizNo && `사업자번호 ${company.bizNo}`].filter(Boolean).join(', ').replace(/^(.+)$/, ' ($1)')}
              <br />
              <span className="sub-text">{company?.address}</span>
            </td>
          </tr>
          <tr>
            <th>계약자</th>
            <td>{first.customerName}</td>
            <th>연락처</th>
            <td>{phones}</td>
          </tr>
          <tr>
            <th>시공 현장</th>
            <td>
              {formatAddress(first)}
              {first.area && ` · ${first.area}평`}
            </td>
            <th>입주예정일</th>
            <td>{first.moveInDate || '-'}</td>
          </tr>
          {list.map((c, i) => (
            <Part key={c.id ?? i} c={c} multi={multi} amountOn={amountOn} />
          ))}
          {multi && amountOn && (
            <tr className="doc-total">
              <th>합계</th>
              <td className="bold-text">계약금액 {won(sums.actual)}원</td>
              <th>기납입 / 잔금</th>
              <td>
                {won(sums.paid)}원 / <strong>{won(sums.balance)}원</strong>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {list.some((c) => c.customerNote) && (
        <div className="doc-customer-note">
          <h4>고객 참고사항</h4>
          {list
            .filter((c) => c.customerNote)
            .map((c, i) => (
              <p key={c.id ?? i} className="pre-wrap">
                {multi && <strong>[{c.category}] </strong>}
                {c.customerNote}
              </p>
            ))}
        </div>
      )}

      <div className="doc-terms">
        <h4>계약 조건</h4>
        <ol>
          {terms.map((t, i) => (
            <li key={i} className="pre-wrap">{t}</li>
          ))}
        </ol>
      </div>

      <div className="doc-sign">
        <div>
          계약자: <strong>{esign.signerName || first.customerName}</strong>
          {esign.signedAt && <span className="sub-text"> (서명일시 {new Date(esign.signedAt).toLocaleString('ko-KR')})</span>}
        </div>
        {esign.signature ? (
          <img src={esign.signature} alt="서명" className="doc-signature" />
        ) : (
          <div className="doc-signature empty">{esign.status === '서명완료' ? '(서명 이미지 없음)' : '(서명 전)'}</div>
        )}
      </div>
    </div>
  );
}

// 시공 한 건(줄눈 / 청소 …)의 내용·일정·금액
function Part({ c, multi, amountOn }) {
  const a = calcAmounts(c);
  const label = (t) => (multi ? `${c.category} ${t}` : t);
  return (
    <>
      {multi && (
        <tr className="doc-part">
          <th colSpan={4}>
            {c.category}
            {c.workType && c.workType !== '시공' ? ` ${c.workType}` : ''} 시공 <span className="sub-text">No.{c.no ?? '-'}</span>
          </th>
        </tr>
      )}
      <tr>
        <th>{label('시공 내용')}</th>
        <td colSpan={3}>
          {(c.lineItems || []).length > 0 && (
            <table className="doc-lines">
              <tbody>
                {c.lineItems.map((l, i) => (
                  <tr key={i}>
                    <td>
                      <strong>{l.name}</strong>
                      {l.detail && <div className="sub-text">{l.detail}</div>}
                    </td>
                    <td className="nowrap">{l.qty}개</td>
                    {amountOn && <td className="text-right nowrap">{won(l.qty * l.unitPrice)}원</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="pre-wrap">{c.items || ((c.lineItems || []).length ? '' : '-')}</div>
        </td>
      </tr>
      <tr>
        <th>{label('시공 일정')}</th>
        <td colSpan={3}>
          {c.schedules.map((s, i) => (
            <div key={i}>
              {i + 1}차: {s.date ? `${s.date} ${timeLabel(s)}` : '협의 후 확정'}
            </div>
          ))}
        </td>
      </tr>
      {amountOn && (
        <>
          <tr>
            <th>시공총액</th>
            <td>{won(a.total)}원</td>
            <th>할인/상품권</th>
            <td>
              {won(a.discount)}원 / {won(a.voucher)}원
            </td>
          </tr>
          <tr>
            <th>계약금액</th>
            <td className="bold-text">{won(a.actual)}원</td>
            <th>기납입 / 잔금</th>
            <td>
              {won(a.paid)}원 / <strong>{won(a.balance)}원</strong>
            </td>
          </tr>
        </>
      )}
    </>
  );
}
