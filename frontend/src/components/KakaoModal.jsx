import React, { useEffect, useState } from 'react';
import { contracts as contractApi, notifications } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { BRANDS } from '../constants.js';
import { buildAlimtalk, templateKeyOf } from '../utils/alimtalk.js';
import { backdrop } from '../utils/backdrop.js';

// 화면에서 고르는 템플릿 (받는 사람별 실제 문구는 utils/alimtalk.js — 비즈고 승인 문구와 동일)
const TEMPLATES = {
  기사배정: { label: '기사배정 안내', targets: ['고객', '기사'] },
  계약완료: { label: '계약완료 안내', targets: ['고객'] },
  서명요청: { label: '전자계약 서명요청', targets: ['고객'] },
};

export default function KakaoModal({ contract, initialTemplate = '기사배정', initialTarget = '고객', initialStep = 0, initialBrand, signUrl, onClose }) {
  const { handleError, company } = useAuth();
  const brands = company?.brands?.length ? company.brands : BRANDS; // 업체에 등록된 브랜드
  const [brand, setBrand] = useState(initialBrand || contract.brand || brands[0]);
  const [template, setTemplate] = useState(initialTemplate);
  const [target, setTarget] = useState(initialTarget);
  const [step, setStep] = useState(initialStep);
  const [sending, setSending] = useState(false);

  const tpl = TEMPLATES[template];
  const effectiveTarget = tpl.targets.includes(target) ? target : tpl.targets[0];
  const engineer = contract.schedules[step];
  // 고객 연락처가 2개(연락처②)면 두 번호 모두에게 발송
  const receiver =
    effectiveTarget === '기사'
      ? { name: engineer?.engineerName || '', phones: [engineer?.engineerPhone].filter(Boolean) }
      : { name: contract.customerName, phones: [...new Set([contract.customerPhone, contract.customerPhone2].filter(Boolean))] };
  const key = templateKeyOf(template, effectiveTarget);
  // 고객모바일 바로가기 링크 (알림톡 '내 계약 확인' 버튼)
  const [customerToken, setCustomerToken] = useState('');
  useEffect(() => {
    if (effectiveTarget !== '고객') return;
    contractApi
      .customerLink(contract.id)
      .then((r) => setCustomerToken(r.token))
      .catch(() => {});
  }, [contract.id, effectiveTarget]);
  const msg = buildAlimtalk(key, { contract, schedule: engineer, signUrl, customerToken });
  const message = msg.text;
  const needSign = template === '서명요청' && !signUrl;

  const handleSend = async () => {
    setSending(true);
    try {
      let live = false;
      for (const phone of receiver.phones) {
        const log = await notifications.send({
          contractId: contract.id,
          template,
          templateKey: key,
          variables: msg.variables,
          buttons: msg.buttons,
          target: effectiveTarget,
          brand,
          receiverName: receiver.name,
          receiverPhone: phone,
          message,
        });
        live = live || log.result === 'SENT';
      }
      const to = receiver.phones.length > 1 ? ` (${receiver.phones.join(', ')} 두 번호 모두)` : '';
      alert(
        live
          ? `${receiver.name}님에게${to} [${tpl.label}] 알림톡을 보냈습니다.`
          : `${receiver.name}님에게${to} [${tpl.label}] 알림톡 발송을 요청했습니다.\n(비즈고 연결 전이라 실제로는 발송되지 않았습니다)`,
      );
      onClose();
    } catch (e) {
      handleError(e);
      setSending(false);
    }
  };

  const tag = (group, value, current, setter, label = value, extra = '') => (
    <label key={value} className={`radio-tag ${extra} ${current === value ? (extra ? 'selected-target' : 'selected') : ''}`}>
      <input type="radio" name={group} value={value} checked={current === value} onChange={() => setter(value)} />
      {label}
    </label>
  );

  return (
    <div className="modal-overlay" {...backdrop(onClose)}>
      <div className="modal-content talk-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>카카오 알림톡 발송</h3>
        <div className="talk-select-section">
          <div className="form-group">
            <label>발송 브랜드</label>
            <div className="radio-btn-group">{brands.map((b) => tag('talkBrand', b, brand, setBrand))}</div>
          </div>
          <div className="form-group">
            <label>알림톡 템플릿</label>
            <div className="radio-btn-group">
              {Object.entries(TEMPLATES).map(([k, t]) => tag('talkTemplate', k, template, setTemplate, t.label))}
            </div>
          </div>
          {tpl.targets.length > 1 && (
            <div className="form-group">
              <label>수신 대상</label>
              <div className="radio-btn-group">
                {tag('talkTarget', '고객', effectiveTarget, setTarget, '👤 고객용', 'target')}
                {tag('talkTarget', '기사', effectiveTarget, setTarget, '🔧 시공기사용', 'target')}
              </div>
            </div>
          )}
          {template === '기사배정' && contract.schedules.length > 1 && (
            <div className="form-group">
              <label>시공 회차</label>
              <div className="radio-btn-group">
                {contract.schedules.map((s, i) => tag('talkStep', i, step, setStep, `${i + 1}차 ${s.assigneeName || '미배정'}`))}
              </div>
            </div>
          )}
        </div>

        <div className="talk-preview-box">
          <p>
            <strong>수신자:</strong> {receiver.name || '-'} ({receiver.phones.join(', ') || '연락처 없음'})
            {receiver.phones.length > 1 && <span className="sub-text"> — 두 번호 모두 발송</span>}
          </p>
          {/* 카카오톡에 실제로 보이는 모양 */}
          <div className="kakao-bubble">
            <div className="kakao-bubble-head">알림톡 도착</div>
            {msg.title && (
              <div className="kakao-bubble-emph">
                <small>{msg.subtitle}</small>
                <b>{msg.title}</b>
              </div>
            )}
            <div className="kakao-bubble-body">{message}</div>
            {msg.buttons.map((b) => (
              <div key={b.name} className="kakao-bubble-btn" title={b.url}>{b.name}</div>
            ))}
          </div>
          {effectiveTarget === '기사' && !receiver.phones.length && (
            <p className="talk-warn">⚠ {engineer?.viaTeam || engineer?.assignType === 'team' ? '팀 배정은 팀원 개인 번호가 없어 보낼 수 없습니다. 기사를 직접 배정해 주세요.' : '기사 연락처가 없습니다. 설정 > 기사관리에서 휴대폰 번호를 입력해 주세요.'}</p>
          )}
          {needSign && <p className="talk-warn">⚠ 서명 링크가 아직 없습니다. 계약서 보기에서 '전자서명 요청하기'를 먼저 눌러 주세요.</p>}
          {msg.missing.length > 0 && !needSign && <p className="talk-warn">⚠ 빈 칸: {msg.missing.join(', ')}</p>}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn-confirm" onClick={handleSend} disabled={sending || !receiver.phones.length || needSign}>
            {sending ? '발송 중...' : `${effectiveTarget}에게 알림톡 발송`}
          </button>
        </div>
      </div>
    </div>
  );
}
