import React from 'react';
import { calcAmounts, timeLabel } from '../utils/contract.js';
import { formatAddress, won } from '../utils/format.js';
import { MOLD_PRICE, MOLD_ROOMS, PAINT_PLACES, REVIEW_PAYBACK, contractTermsFor, isMoldLine, isPaintStyle, moldLineName, termSection } from '../constants.js';

// 계약 조건: 서명한 계약서는 서명 당시 조건, 아니면 업체·브랜드별 조건
const termsOf = (esign, company, brand, categories) =>
  (esign?.status === '서명완료' && esign.terms?.length ? esign.terms : contractTermsFor(company, brand, categories) || []).filter((t) => t !== null && t !== undefined).map(String);



// '제1조(목적)' 처럼 조 제목으로 시작하는 약관 (첫 줄 = 제목)
const isArticle = (t) => /^제\s*\d+\s*조/.test(t);

const uniq = (arr) => [...new Set(arr.filter(Boolean))];

// 계약서 본문. 내부 조회(ContractViewModal)와 고객 서명 페이지(SignPage)가 함께 사용합니다.
//   contracts 를 주면 같은 계약자·현장의 시공들(줄눈·청소 등)을 한 장으로 보여줌
export default function ContractDocument({ contract, contracts, company, showAmount = true, showStatus = false }) {
  const list = contracts?.length ? contracts : [contract];
  // 신화탄성 양식(기능 paintContract)인 업체의 탄성·페인트 계약은 신화탄성 종이 계약서와 같은 양식
  if (list.every((c) => isPaintStyle(company, c.category))) {
    return <PaintDocument list={list} company={company} showAmount={showAmount} showStatus={showStatus} />;
  }
  const first = list[0];
  const multi = list.length > 1;
  const esign = list.find((c) => c.esign?.signature)?.esign || first.esign || {};
  const amountOn = showAmount && !list.some((c) => c.amountHidden);
  const sums = list.map(calcAmounts).reduce((t, a) => ({ actual: t.actual + a.actual, paid: t.paid + a.paid, balance: t.balance + a.balance }), { actual: 0, paid: 0, balance: 0 });
  const workType = !multi && first.workType && first.workType !== '시공' ? `${first.workType} ` : '';
  const terms = termsOf(list.find((c) => c.esign?.terms)?.esign || esign, company, first.brand, list.map((c) => c.category));
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
            <Part key={c.id ?? i} c={c} multi={multi} amountOn={amountOn} site={formatAddress(c) !== formatAddress(first) ? formatAddress(c) : ''} />
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

      <ContractTerms terms={terms} />

      <div className="doc-sign">
        <div className="doc-sign-names">
          {first.ownerName && (
            <div>
              상담자: <strong>{first.ownerName}</strong>
            </div>
          )}
          계약자: <strong>{esign.signerName || first.customerName}</strong>
          {esign.signedAt && <span className="sub-text"> (서명일시 {new Date(esign.signedAt).toLocaleString('ko-KR')})</span>}
        </div>
        {esign.signature ? (
          <img src={esign.signature} alt="서명" className="doc-signature" />
        ) : (
          <div className="doc-signature empty">{esign.status === '서명완료' ? (esign.paperMarked ? '(종이 계약서로 서명 완료)' : '(서명 이미지 없음)') : '(서명 전)'}</div>
        )}
      </div>
    </div>
  );
}

// 시공 한 건(줄눈 / 청소 …)의 내용·일정·금액
function Part({ c, multi, amountOn, site }) {
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
      {site && (
        <tr>
          <th>{label('시공 현장')}</th>
          <td colSpan={3}>{site}</td>
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
          {(c.schedules || []).map((s, i) => (
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

// 계약서의 '계약 조건' 부분 (운영자 계약조건 화면 미리보기에서도 사용)
export function ContractTerms({ terms }) {
  return (
    <div className="doc-terms">
      <h4>계약 조건</h4>
      {terms.some(termSection) ? (
        terms.map((t, i) => {
          const [title, ...lines] = t.split('\n');
          if (!termSection(t)) return <p key={i} className={`${i === 0 ? 'doc-term-lead' : 'doc-article-closing'} pre-wrap`}>{t}</p>; // 맨 앞 = 가장 중요한 조항
          return (
            <section key={i} className="doc-article">
              <h5>{title}</h5>
              <ul className="doc-term-list">
                {lines.filter((l) => l.trim()).map((l, j) => (
                  <li key={j}>{l.replace(/^\s*\*\s*/, '')}</li>
                ))}
              </ul>
            </section>
          );
        })
      ) : terms.some(isArticle) ? (
        terms.map((t, i) => {
          if (!isArticle(t)) return <p key={i} className="doc-article-closing pre-wrap">{t}</p>;
          const [title, ...body] = t.split('\n');
          return (
            <section key={i} className="doc-article">
              <h5>{title}</h5>
              <p className="pre-wrap">{body.join('\n')}</p>
            </section>
          );
        })
      ) : terms.length === 1 ? (
        <p className="doc-term-lead pre-wrap">{terms[0]}</p> // 구분 없이 한 묶음 = 중요 조항만
      ) : (
        <ol>
          {terms.map((t, i) => (
            <li key={i} className="pre-wrap">{t}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

const box = (on) => (on ? '☑' : '☐');
const manwon = (n) => `${won(n / 10000)}만원`;
const METHOD_LABEL = { 현금: '현금', 계좌이체: '이체', 카드: '카드' };

// 신화탄성 탄성·페인트 계약서 (신화탄성 종이 계약서 양식, v-base 에서 가져옴)
//   위: 아파트명·동호수(타입)·고객명·연락처 / 제품명·시공장소·품질보증·금액·비고(구역)
//   곰팡이방지 살균시공 · AS 보장범위 / 최종 계약금액 안내 / 비고(계약 조항) + 업체 정보 / 서명
function PaintDocument({ list, company, showAmount, showStatus }) {
  const first = list[0];
  const esign = list.find((c) => c.esign?.signature)?.esign || first.esign || {};
  const amountOn = showAmount && !list.some((c) => c.amountHidden);
  const lines = list.flatMap((c) => c.lineItems || []);
  const products = lines.filter((l) => !isMoldLine(l));
  const a = list.map(calcAmounts).reduce(
    (t, x) => ({ total: t.total + x.total, voucher: t.voucher + x.voucher, discount: t.discount + x.discount, actual: t.actual + x.actual, balance: t.balance + x.balance }),
    { total: 0, voucher: 0, discount: 0, actual: 0, balance: 0 },
  );
  const deposits = list.flatMap((c) => (c.payments || []).filter((p) => (p.kind || '계약금') === '계약금'));
  const depositSum = deposits.reduce((t, p) => t + (Number(p.amount) || 0), 0);
  const depositMethods = new Set(deposits.map((p) => METHOD_LABEL[p.method] || p.method));
  const terms = termsOf(list.find((c) => c.esign?.terms)?.esign || esign, company, first.brand, list.map((c) => c.category));
  const phones = uniq([first.customerPhone, first.customerPhone2]).join(' / ');
  const dongHo = [first.dong && `${first.dong}동`, first.ho && `${first.ho}호`].filter(Boolean).join(' ') + (first.aptType ? ` (${first.aptType})` : '');
  const signDate = new Date(esign.signedAt || `${first.contractDate}T00:00:00`);
  const notes = uniq(list.map((c) => c.items));
  const info = [
    ['사업자번호', company?.bizNo, '대표', company?.ceo],
    ['상호', company?.name, '종목', company?.bizItem],
    ['업태', company?.bizType, '고객센터', company?.csPhone],
    ['휴대번호', company?.mobile, '빠른문의', company?.quickPhone],
  ];

  return (
    <div className="contract-doc paint-doc">
      <h2 className="doc-title">{company?.name || first.brand} 계약서</h2>
      <p className="doc-no">
        계약번호 {list.map((c) => `No.${c.no ?? '-'}`).join(', ')} · 계약일 {uniq(list.map((c) => c.contractDate)).join(', ')}
      </p>
      {showStatus && (
        <div className="doc-status">
          현재 진행상태 <strong>{first.status}</strong>
          {first.status === '시공완료' && first.completedDate && ` (${first.completedDate})`}
        </div>
      )}

      <table className="doc-table paint-head">
        <tbody>
          <tr>
            <th>아파트명</th>
            <td>{first.aptName}</td>
            <th>고객명</th>
            <td>{first.customerName}</td>
          </tr>
          <tr>
            <th>동 호수(타입)</th>
            <td>{dongHo || '-'}</td>
            <th>연락처</th>
            <td>{phones}</td>
          </tr>
          <tr>
            <th>시공일정</th>
            <td>
              {first.schedules.filter((s) => s.date).map((s, i) => (
                <div key={i}>{s.date} {timeLabel(s)}</div>
              ))}
              {!first.schedules.some((s) => s.date) && '협의 후 확정'}
            </td>
            <th>입주예정일</th>
            <td>{first.moveInDate || '-'}</td>
          </tr>
        </tbody>
      </table>

      <table className="doc-table paint-products">
        <thead>
          <tr>
            <th>제품명</th>
            <th>시공장소</th>
            <th>품질보증</th>
            {amountOn && <th>금액</th>}
            <th>비고(구역)</th>
          </tr>
        </thead>
        <tbody>
          {products.length === 0 && (
            <tr>
              <td colSpan={amountOn ? 5 : 4} className="pre-wrap">{notes.join('\n') || '-'}</td>
            </tr>
          )}
          {products.map((l, i) => (
            <tr key={i}>
              <td className="paint-product">
                <strong>{l.name}</strong>
                {l.detail && <div className="sub-text pre-wrap">{l.detail}</div>}
                {l.qty > 1 && <div className="sub-text">수량 {l.qty}</div>}
              </td>
              <td className="paint-places-cell">
                {PAINT_PLACES.map((pl) => (
                  <span key={pl} className={(l.places || []).includes(pl) ? 'on' : ''}>
                    {box((l.places || []).includes(pl))} {pl}
                  </span>
                ))}
              </td>
              <td className="nowrap">A/S{l.warranty ? ` (${l.warranty})` : ''}</td>
              {amountOn && <td className="text-right nowrap">{won(l.qty * l.unitPrice)}원</td>}
              <td>{l.zone || ''}</td>
            </tr>
          ))}
          <tr>
            <th>곰팡이방지 살균시공</th>
            <td colSpan={amountOn ? 4 : 3}>
              {MOLD_ROOMS.map((room) => (
                <span key={room} className="paint-check">
                  {box(lines.some((l) => l.name === moldLineName(room)))} {room} {manwon(lines.find((l) => l.name === moldLineName(room))?.unitPrice || MOLD_PRICE)}
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <th>AS 보장범위</th>
            <td colSpan={amountOn ? 4 : 3}>
              <span className="paint-check">{box(list.some((c) => c.asCoverage))} 곰팡이, 들뜸 AS보장</span>
            </td>
          </tr>
          {products.length > 0 && notes.length > 0 && (
            <tr>
              <th>추가 시공내용</th>
              <td colSpan={amountOn ? 4 : 3} className="pre-wrap">{notes.join('\n')}</td>
            </tr>
          )}
        </tbody>
      </table>

      {amountOn && (
        <table className="doc-table paint-amounts">
          <caption>※ 최종 계약금액 안내 ※</caption>
          <thead>
            <tr>
              <th>항목</th>
              <th>내역</th>
              <th>금액</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>기본 시공 금액</th>
              <td />
              <td className="text-right">{won(a.total)}원</td>
            </tr>
            <tr>
              <th>상품권 할인</th>
              <td>{a.voucher ? `상품권 ${manwon(a.voucher)} 할인적용` : ''}</td>
              <td className="text-right">{a.voucher ? `-${won(a.voucher)}원` : '-'}</td>
            </tr>
            <tr>
              <th>할인 · 이벤트혜택</th>
              <td>{uniq(list.map((c) => c.discountReason)).join(', ')}</td>
              <td className="text-right">{a.discount ? `-${won(a.discount)}원` : '-'}</td>
            </tr>
            <tr className="paint-total">
              <th>금액</th>
              <td />
              <td className="text-right">{won(a.actual)}원</td>
            </tr>
            <tr>
              <th>계약금</th>
              <td>
                {['현금', '이체', '카드'].map((m) => (
                  <span key={m} className="paint-check">
                    {box(depositMethods.has(m))} {m}
                  </span>
                ))}
              </td>
              <td className="text-right">{won(depositSum)}원</td>
            </tr>
            <tr>
              <th>잔금</th>
              <td />
              <td className="text-right bold-text">{won(a.balance)}원</td>
            </tr>
            <tr>
              <th>시공후기 페이백</th>
              <td>
                <span className="paint-check">{box(list.some((c) => c.reviewPayback))} 시공 후기이벤트 참여 {manwon(REVIEW_PAYBACK)} 할인</span>
              </td>
              <td className="text-right">{list.some((c) => c.reviewPayback) ? `${won(REVIEW_PAYBACK)}원` : '-'}</td>
            </tr>
          </tbody>
        </table>
      )}

      {list.some((c) => c.customerNote) && (
        <div className="doc-customer-note">
          <h4>고객 참고사항</h4>
          {list.filter((c) => c.customerNote).map((c, i) => (
            <p key={c.id ?? i} className="pre-wrap">{c.customerNote}</p>
          ))}
        </div>
      )}

      <div className="paint-bottom">
        <div className="paint-terms">
          <h4>비고</h4>
          {terms.map((t, i) => (
            <p key={i} className="pre-wrap">{t}</p>
          ))}
        </div>
        <table className="doc-table paint-company">
          <tbody>
            {info.map(([k1, v1, k2, v2]) => (
              <tr key={k1}>
                <th>{k1}</th>
                <td>{v1 || '-'}</td>
                <th>{k2}</th>
                <td>{v2 || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="doc-sign">
        <div className="doc-sign-names">
          {signDate.getFullYear()}년 {signDate.getMonth() + 1}월 {signDate.getDate()}일 위 계약 내용에 동의하여 서명합니다.
          {first.ownerName && (
            <div>
              상담자: <strong>{first.ownerName}</strong>
            </div>
          )}
          계약자: <strong>{esign.signerName || first.customerName}</strong>
          {esign.signedAt && <span className="sub-text"> (서명일시 {new Date(esign.signedAt).toLocaleString('ko-KR')})</span>}
        </div>
        {esign.signature ? (
          <img src={esign.signature} alt="서명" className="doc-signature" />
        ) : (
          <div className="doc-signature empty">{esign.status === '서명완료' ? (esign.paperMarked ? '(종이 계약서로 서명 완료)' : '(서명 이미지 없음)') : '(서명 전)'}</div>
        )}
      </div>
    </div>
  );
}
