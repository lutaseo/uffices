// ============================================================
// 일정 / 기사 휴무 / 기사모바일 / 일정관리설정
//
// 휴무 규칙
//  - 휴무는 기사 1명당 하루 1건: 오전(AM) / 오후(PM) / 종일(DAY)
//  - 일정의 시간대: 시간이 있으면 설정의 '오전 기준시각'(기본 12:00) 이전=오전, 이후=오후.
//    시간이 없으면 '오전/오후(시간미정)' 선택값을 사용.
//  - 종일 휴무 → 그날 배정 불가
//  - 오전 휴무 → 오후 일정만 가능 / 오후 휴무 → 오전 일정만 가능
//    (시간대를 정하지 않은 일정은 어느 쪽인지 알 수 없으므로 배정 불가)
//  - 반대로, 이미 배정된 일정과 겹치는 휴무는 등록할 수 없음 (일정을 먼저 옮겨야 함)
//  - 팀배정: 팀원(사용 중인 소속 기사) 전원이 그 시간대에 휴무일 때만 배정 불가.
//    팀원 한 명이라도 일할 수 있으면 배정 가능. 팀원이 없는 팀은 검사하지 않음.
//    반대로 팀 일정이 있는 시간대에 마지막 남은 팀원이 휴무를 넣으려 하면 등록 불가.
// ============================================================

import { saveDb, nextId } from './runtime.js';
import {
  ApiError,
  authorize,
  authorizeAny,
  authorizeEngineer,
  clone,
  companyOf,
  nowIso,
  session,
  visibleContracts,
} from './core.js';
import { addHistory, assigneeOf, contractView } from './views.js';
import { numberOf } from './numbering.js';
import { DEFAULT_SCHEDULE_SETTINGS, MOBILE_STATUS, OFF_LABEL } from '../constants.js';
import { inRange, isDateKey, today } from '../utils/date.js';
import { calcAmounts } from '../utils/contract.js';
import { formatAddress } from '../utils/format.js';

export const settingsOf = (company) => ({ ...DEFAULT_SCHEDULE_SETTINGS, ...(company?.scheduleSettings || {}) });

// 일정의 시간대 ('AM' | 'PM' | null=미정)
export function slotOf(s, settings) {
  if (s.time) return s.time < settings.amEnd ? 'AM' : 'PM';
  if (s.ampm === 'AM' || s.ampm === 'PM') return s.ampm;
  return null;
}

// 휴무와 일정 시간대가 겹치는지
export const offBlocks = (period, slot) => period === 'DAY' || slot === null || slot === period;

const activeContracts = (db, companyId) =>
  db.contracts.filter((c) => c.companyId === companyId && !c.deletedAt && c.status !== '취소');

function engineerSchedules(db, companyId, engineerId, date) {
  const out = [];
  activeContracts(db, companyId).forEach((c) =>
    c.schedules.forEach((s, stepIndex) => {
      if (s.assignType !== 'team' && s.engineerId === engineerId && s.date === date) out.push({ c, s, stepIndex });
    }),
  );
  return out;
}

export const teamMembers = (db, companyId, teamId) =>
  db.engineers.filter((e) => e.companyId === companyId && e.active !== false && e.teamId === teamId);

// 팀원 전원이 해당 시간대에 휴무인지 (extraOff: 등록하려는 휴무를 미리 반영해 검사할 때)
function wholeTeamOff(db, companyId, teamId, date, slot, extraOff) {
  const members = teamMembers(db, companyId, teamId);
  if (!members.length) return false;
  return members.every((m) => {
    if (extraOff && extraOff.engineerId === m.id) return offBlocks(extraOff.period, slot);
    const off = db.engineerOffs.find((o) => o.companyId === companyId && o.engineerId === m.id && o.date === date);
    return off && offBlocks(off.period, slot);
  });
}

// 기사/팀 배정 가능 여부 검사 (계약 저장·일정 수정 시 서버에서 호출)
export function assertAssignable(db, companyId, schedule, { contractId, stepIndex } = {}) {
  if (!schedule.date) return;
  if (schedule.assignType === 'team') {
    if (!schedule.teamId) return;
    const settings = settingsOf(db.companies.find((c) => c.id === companyId));
    const slot = slotOf(schedule, settings);
    if (wholeTeamOff(db, companyId, schedule.teamId, schedule.date, slot)) {
      const team = db.teams.find((t) => t.id === schedule.teamId);
      throw new ApiError(
        `${team?.name || '해당 팀'}은 ${schedule.date}${slot ? ` ${slot === 'AM' ? '오전' : '오후'}` : ''}에 팀원 전원이 휴무입니다.` +
          (slot === null ? '\n오전/오후 또는 시간을 지정하면 일할 수 있는 시간대로 배정할 수 있습니다.' : ''),
      );
    }
    return;
  }
  if (!schedule.engineerId) return;
  const engineer = db.engineers.find((e) => e.id === schedule.engineerId && e.companyId === companyId);
  if (!engineer) throw new ApiError('기사를 찾을 수 없습니다.');
  const settings = settingsOf(db.companies.find((c) => c.id === companyId));
  const slot = slotOf(schedule, settings);

  const off = db.engineerOffs.find(
    (o) => o.companyId === companyId && o.engineerId === engineer.id && o.date === schedule.date,
  );
  if (off && offBlocks(off.period, slot)) {
    let msg = `${engineer.name} 기사는 ${schedule.date} ${OFF_LABEL[off.period]} 휴무입니다.`;
    if (off.period !== 'DAY' && slot === null) {
      msg += `\n${off.period === 'AM' ? '오후' : '오전'} 시간 또는 '${off.period === 'AM' ? '오후' : '오전'}(시간미정)'을 선택하면 배정할 수 있습니다.`;
    }
    throw new ApiError(msg);
  }

  if (settings.maxPerDay > 0) {
    const count = engineerSchedules(db, companyId, engineer.id, schedule.date).filter(
      (x) => !(x.c.id === contractId && x.stepIndex === stepIndex),
    ).length;
    if (count >= settings.maxPerDay) {
      throw new ApiError(`${engineer.name} 기사는 ${schedule.date}에 이미 ${count}건이 배정되어 있습니다. (하루 최대 ${settings.maxPerDay}건)`);
    }
  }
}

// ------------------------------------------------------------
// 휴무 등록/취소 공통 로직
// ------------------------------------------------------------

function setOff(db, companyId, engineerId, { date, period, reason }, actor) {
  if (!isDateKey(date)) throw new ApiError('날짜를 선택해 주세요.');
  if (!OFF_LABEL[period]) throw new ApiError('휴무 구분(오전/오후/종일)을 선택해 주세요.');
  if (!String(reason || '').trim()) throw new ApiError('휴무 사유를 입력해 주세요.');
  const engineer = db.engineers.find((e) => e.id === Number(engineerId) && e.companyId === companyId);
  if (!engineer) throw new ApiError('기사를 선택해 주세요.');

  const settings = settingsOf(db.companies.find((c) => c.id === companyId));
  const conflicts = engineerSchedules(db, companyId, engineer.id, date).filter(({ s }) =>
    offBlocks(period, slotOf(s, settings)),
  );
  if (conflicts.length) {
    const list = conflicts
      .map(({ c, s }) => `· No.${numberOf(db, c)} ${c.customerName} ${s.time || (s.ampm === 'AM' ? '오전' : s.ampm === 'PM' ? '오후' : '시간미정')}`)
      .join('\n');
    throw new ApiError(
      `${engineer.name} 기사는 ${date} ${OFF_LABEL[period]} 시간대에 배정된 일정이 있어 휴무를 등록할 수 없습니다.\n${list}\n일정을 다른 기사/날짜로 옮긴 후 다시 등록해 주세요.`,
    );
  }

  // 이 휴무로 팀원 전원이 쉬게 되는 팀 일정이 있으면 등록 불가
  if (engineer.teamId) {
    const extraOff = { engineerId: engineer.id, period };
    const teamConflicts = [];
    activeContracts(db, companyId).forEach((c) =>
      c.schedules.forEach((s) => {
        if (s.assignType === 'team' && s.teamId === engineer.teamId && s.date === date) {
          const slot = slotOf(s, settings);
          if (offBlocks(period, slot) && wholeTeamOff(db, companyId, s.teamId, date, slot, extraOff)) teamConflicts.push({ c, s });
        }
      }),
    );
    if (teamConflicts.length) {
      const team = db.teams.find((t) => t.id === engineer.teamId);
      const list = teamConflicts.map(({ c, s }) => `· No.${numberOf(db, c)} ${c.customerName} ${s.time || (s.ampm === 'AM' ? '오전' : s.ampm === 'PM' ? '오후' : '시간미정')}`).join('\n');
      throw new ApiError(
        `${engineer.name} 기사까지 휴무하면 ${team?.name || '소속 팀'} 팀원 전원이 쉬게 되어, 배정된 팀 일정을 진행할 수 없습니다.\n${list}\n일정을 옮기거나 다른 팀원과 조정해 주세요.`,
      );
    }
  }

  let off = db.engineerOffs.find((o) => o.companyId === companyId && o.engineerId === engineer.id && o.date === date);
  if (off) {
    Object.assign(off, { period, reason: reason.trim(), updatedBy: actor.id, updatedAt: nowIso() });
  } else {
    off = {
      id: nextId(db, 'engineerOffs'),
      companyId,
      engineerId: engineer.id,
      date,
      period,
      reason: reason.trim(),
      createdBy: actor.id,
      createdByRole: actor.role,
      createdAt: nowIso(),
    };
    db.engineerOffs.push(off);
  }
  saveDb(db);
  return clone(off);
}

function removeOff(db, companyId, engineerId, date) {
  db.engineerOffs = db.engineerOffs.filter(
    (o) => !(o.companyId === companyId && o.engineerId === Number(engineerId) && o.date === date),
  );
  saveDb(db);
}

function offView(db, o) {
  const e = db.engineers.find((x) => x.id === o.engineerId);
  return { ...clone(o), engineerName: e?.name || '', engineerCategory: e?.category || '' };
}

// ============================================================
// 직원용 휴무 관리   GET/PUT/DELETE /api/engineer-offs
// ============================================================

export const engineerOffs = {
  // 계약 작성 화면에서도 기사 선택 시 휴무를 보여주기 위해 계약 등록/수정 권한으로도 조회 허용
  async list({ from, to, engineerId } = {}) {
    const { db, user } = await authorizeAny(['schedule.view', 'contract.create', 'contract.edit']);
    return db.engineerOffs
      .filter((o) => o.companyId === user.companyId && inRange(o.date, from, to))
      .filter((o) => !engineerId || o.engineerId === Number(engineerId))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((o) => offView(db, o));
  },

  async set({ engineerId, date, period, reason }) {
    const { db, user } = await authorize('schedule.edit');
    return setOff(db, user.companyId, engineerId, { date, period, reason }, user);
  },

  async remove({ engineerId, date }) {
    const { db, user } = await authorize('schedule.edit');
    removeOff(db, user.companyId, engineerId, date);
  },
};

// ============================================================
// 일정 (계약의 시공일정을 날짜 단위로 펼친 뷰)   GET /api/schedules?from=&to=
//   별도 테이블이 아니라 계약서의 schedules 가 원본이므로
//   계약에서 수정하면 달력에 바로 반영됩니다.
// ============================================================

export const schedules = {
  async list({ from, to, category, engineerId, status } = {}) {
    const { db, user } = await authorize('schedule.view');
    const engineer = engineerId && engineerId !== 'none' ? db.engineers.find((e) => e.id === Number(engineerId)) : null;
    const out = [];
    visibleContracts(db, user)
      .filter((c) => !c.deletedAt)
      .filter((c) => (!category || c.category === category) && (!status || c.status === status))
      .forEach((c) => {
        c.schedules.forEach((s, stepIndex) => {
          if (!s.date || !inRange(s.date, from, to)) return;
          const assigned = s.assignType === 'team' ? !!s.teamId : !!s.engineerId;
          if (engineerId === 'none' && assigned) return;
          if (engineer) {
            const mine = s.assignType === 'team' ? engineer.teamId && s.teamId === engineer.teamId : s.engineerId === engineer.id;
            if (!mine) return;
          }
          const view = contractView(c, user, db);
          out.push({ ...view.schedules[stepIndex], stepIndex, contract: view });
        });
      });
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  },
};

// ============================================================
// 일정관리설정   GET/PUT /api/schedule-settings
// ============================================================

export const scheduleSettings = {
  async get() {
    const { db, user } = await session();
    return settingsOf(companyOf(db, user));
  },

  async save(data) {
    const { db, user } = await authorize('settings.manage');
    const time = (v) => /^\d{2}:\d{2}$/.test(v || '');
    if (![data.amEnd, data.startTime, data.endTime].every(time)) throw new ApiError('시간 형식이 올바르지 않습니다.');
    if (data.startTime >= data.endTime) throw new ApiError('시작 시각은 종료 시각보다 빨라야 합니다.');
    const interval = Number(data.interval);
    if (![10, 15, 20, 30, 60].includes(interval)) throw new ApiError('시간 간격을 선택해 주세요.');
    const maxPerDay = Math.max(0, Math.floor(Number(data.maxPerDay) || 0));
    const company = companyOf(db, user);
    company.scheduleSettings = { amEnd: data.amEnd, startTime: data.startTime, endTime: data.endTime, interval, maxPerDay };
    saveDb(db);
    return clone(company.scheduleSettings);
  },
};

// ============================================================
// 기사모바일 (기사 계정 전용)   /api/engineer-app/*
// ============================================================

function mySchedule(db, me, c, s, stepIndex) {
  const a = calcAmounts(c);
  return {
    contractId: c.id,
    no: numberOf(db, c),
    engineerNote: c.engineerNote || '',
    stepIndex,
    date: s.date,
    time: s.time,
    ampm: s.ampm,
    memo: s.memo,
    mobileStatus: s.mobileStatus || '',
    mobileMemo: s.mobileMemo || '',
    reportedAt: s.reportedAt,
    viaTeam: s.assignType === 'team',
    ...assigneeOf(db, s),
    category: c.category,
    workType: c.workType,
    status: c.status,
    customerName: c.customerName,
    customerPhone: c.customerPhone,
    address: formatAddress(c),
    items: [...(c.lineItems || []).map((l) => `${l.name}${l.qty > 1 ? ` x${l.qty}` : ''}`), c.items].filter(Boolean).join('\n'),
    balance: a.balance, // 현장 잔금 수령용
  };
}

// 같은 계약자·현장 (계약 상세 묶음과 같은 기준)
const siteKey = (c) => [c.customerId, c.aptName, c.dong, c.ho].join('|');

function engineerContractView(db, me, c) {
  const a = calcAmounts(c);
  return {
    id: c.id,
    no: numberOf(db, c),
    brand: c.brand,
    category: c.category,
    receptionType: c.receptionType || '',
    workType: c.workType,
    status: c.status,
    completedDate: c.completedDate || '',
    contractDate: c.contractDate,
    ownerName: db.users.find((u) => u.id === c.ownerId)?.name || '',
    customerName: c.customerName,
    customerPhone: c.customerPhone,
    customerPhone2: c.customerPhone2 || '',
    aptName: c.aptName || '',
    dong: c.dong || '',
    ho: c.ho || '',
    aptType: c.aptType || '',
    area: c.area || '',
    address: formatAddress(c),
    moveInDate: c.moveInDate || '',
    lineItems: (c.lineItems || []).map((l) => ({ name: l.name, detail: l.detail || '', qty: l.qty })),
    items: c.items || '',
    customerNote: c.customerNote || '',
    engineerNote: c.engineerNote || '',
    amounts: { actual: a.actual - a.canceled, paid: a.paid - a.refund, balance: a.balance }, // 현장 잔금 수령용 요약
    schedules: c.schedules.map((s, i) => ({
      stepIndex: i,
      mine: isMine(me, s),
      date: s.date,
      time: s.time,
      ampm: s.ampm,
      memo: isMine(me, s) ? s.memo || '' : '',
      assigneeName: assigneeOf(db, s).assigneeName,
      mobileStatus: s.mobileStatus || '',
      mobileMemo: isMine(me, s) ? s.mobileMemo || '' : '',
      reportedAt: s.reportedAt,
    })),
  };
}

function isMine(me, s) {
  return s.assignType === 'team' ? !!me.teamId && s.teamId === me.teamId : s.engineerId === me.engineerId;
}

export const engineerApp = {
  async mySchedules({ from, to } = {}) {
    const { db, user } = await authorizeEngineer();
    const out = [];
    activeContracts(db, user.companyId).forEach((c) =>
      c.schedules.forEach((s, i) => {
        if (s.date && inRange(s.date, from, to) && isMine(user, s)) out.push(mySchedule(db, user, c, s, i));
      }),
    );
    return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  },

  // 계약 상세 (기사 본인에게 배정된 계약만) — 실장 계약 상세처럼 같은 계약자·현장 시공 묶음으로
  //   단가·입금 상세(카드번호 등)·내부 메모·상담내역·변경이력은 보내지 않음
  async contract(contractId) {
    const { db, user } = await authorizeEngineer();
    const assigned = (c) => c.companyId === user.companyId && !c.deletedAt && c.schedules.some((s) => isMine(user, s));
    const base = db.contracts.find((x) => x.id === Number(contractId));
    if (!base || !assigned(base)) throw new ApiError('본인에게 배정된 계약이 아닙니다.', 'FORBIDDEN');
    const key = siteKey(base);
    const contracts = db.contracts
      .filter((c) => assigned(c) && siteKey(c) === key)
      .sort((x, y) => x.id - y.id)
      .map((c) => engineerContractView(db, user, c));
    return { selectedId: base.id, contracts };
  },

  // 기사 현장 보고 → 계약서 '모바일웹 ①②③' 에 표시
  async report({ contractId, stepIndex, mobileStatus, memo }) {
    const { db, user } = await authorizeEngineer();
    const c = db.contracts.find((x) => x.id === Number(contractId) && x.companyId === user.companyId && !x.deletedAt);
    const s = c?.schedules[stepIndex];
    if (!s || !isMine(user, s)) throw new ApiError('본인에게 배정된 일정이 아닙니다.', 'FORBIDDEN');
    if (mobileStatus && !MOBILE_STATUS.includes(mobileStatus)) throw new ApiError('상태를 선택해 주세요.');
    const before = s.mobileStatus || '입력 전';
    s.mobileStatus = mobileStatus || '';
    s.mobileMemo = memo || '';
    s.reportedAt = nowIso();
    s.reportedBy = user.name;
    addHistory(c, user, `기사 보고 (${stepIndex + 1}차)`, [
      { label: `모바일웹 ${stepIndex + 1}`, from: before, to: s.mobileStatus || '입력 전' },
    ]);
    saveDb(db);
    return mySchedule(db, user, c, s, stepIndex);
  },

  async myOffs({ from, to } = {}) {
    const { db, user } = await authorizeEngineer();
    return db.engineerOffs
      .filter((o) => o.companyId === user.companyId && o.engineerId === user.engineerId && inRange(o.date, from, to))
      .map((o) => offView(db, o));
  },

  async setMyOff({ date, period, reason }) {
    const { db, user } = await authorizeEngineer();
    if (date < today()) throw new ApiError('지난 날짜는 휴무를 등록할 수 없습니다.');
    return setOff(db, user.companyId, user.engineerId, { date, period, reason }, user);
  },

  async cancelMyOff(date) {
    const { db, user } = await authorizeEngineer();
    if (date < today()) throw new ApiError('지난 날짜의 휴무는 취소할 수 없습니다.');
    removeOff(db, user.companyId, user.engineerId, date);
  },
};
