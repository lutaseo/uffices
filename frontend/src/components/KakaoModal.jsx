import React, { useState } from 'react';
import { notifications } from '../api/index.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { BRANDS } from '../constants.js';
import { formatAddress } from '../utils/format.js';
import { backdrop } from '../utils/backdrop.js';

// 템플릿 정의. 비즈고에 승인된 템플릿이 늘어나면 여기에 추가합니다.
const TEMPLATES = {
  기사배정: {
    label: '기사배정 안내',
    targets: ['고객', '기사'],
    render: ({ brand, contract, engineer, target }) =>
      target === '기사'
        ? `[${brand}] ${engineer?.assigneeName || '기사'}님, 신규 시공 건이 배정되었습니다.\n일정: ${engineer?.date || '미정'} ${engineer?.time || (engineer?.ampm === 'AM' ? '오전' : engineer?.ampm === 'PM' ? '오후' : '')}\n현장: ${formatAddress(contract)}\n고객: ${contract.customerName} (${contract.customerPhone})`
        : `[${brand}] ${contract.customerName}님, 담당 시공기사(${engineer?.assigneeName || '배정중'})님이 배정되었습니다.\n시공일정: ${engineer?.date || '미정'} ${engineer?.time || (engineer?.ampm === 'AM' ? '오전' : engineer?.ampm === 'PM' ? '오후' : '')}`,
  },
  계약완료: {
    label: '계약완료 안내',
    targets: ['고객'],
    render: ({ brand, contract }) => `[${brand}] ${contract.customerName}님, 전자계약 작성이 정상적으로 완료되었습니다.`,
  },
  서명요청: {
    label: '전자계약 서명요청',
    targets: ['고객'],
    render: ({ brand, contract, signUrl }) =>
      `[${brand}] ${contract.customerName}님, 아래 링크에서 계약 내용을 확인하시고 서명해 주세요.\n${signUrl || '(서명요청 후 링크가 생성됩니다)'}`,
  },
};

export default function KakaoModal({ contract, initialTemplate = '기사배정', initialTarget = '고객', initialStep = 0, initialBrand, signUrl, onClose }) {
  const { handleError } = useAuth();
  const [brand, setBrand] = useState(initialBrand || contract.brand || BRANDS[0]);
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
  const message = tpl.render({ brand, contract, engineer, target: effectiveTarget, signUrl });

  const handleSend = async () => {
    setSending(true);
    try {
      for (const phone of receiver.phones) {
        await notifications.send({
          contractId: contract.id,
          template,
          target: effectiveTarget,
          brand,
          receiverName: receiver.name,
          receiverPhone: phone,
          message,
        });
      }
      const to = receiver.phones.length > 1 ? ` (${receiver.phones.join(', ')} 두 번호 모두)` : '';
      alert(`${receiver.name}님에게${to} [${tpl.label}] 알림톡 발송을 요청했습니다.\n(현재는 테스트 모드로 실제 발송되지 않습니다)`);
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
            <div className="radio-btn-group">{BRANDS.map((b) => tag('talkBrand', b, brand, setBrand))}</div>
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
          <div className="preview-text">{message}</div>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-cancel" onClick={onClose}>
            취소
          </button>
          <button type="button" className="btn-confirm" onClick={handleSend} disabled={sending || !receiver.phones.length}>
            {sending ? '발송 중...' : `${effectiveTarget}에게 알림톡 발송`}
          </button>
        </div>
      </div>
    </div>
  );
}
