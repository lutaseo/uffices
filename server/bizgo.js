// ============================================================
// 비즈고(Bizgo) 알림톡 발송 — 서버 전용 (API Key 는 Vercel 환경변수 BIZGO_API_KEY 에만)
//
//   공식 SDK(github.com/icomm-api/bizgo-sdk-comm-js)와 같은 방식:
//     주소   https://mars.ibapi.kr   (BIZGO_BASE_URL 로 바꿀 수 있음 — 시험 서버 https://sandbox-mars.ibapi.kr)
//     인증   Authorization: <API Key>  (접두어 없음)
//     발송   POST /api/comm/v1/send/omni
//            템플릿 자동 치환: senderKey + templateCode + sendType 'template', 수신자별 replaceWords
//            → 비즈고가 등록·승인된 템플릿 문구·버튼을 그대로 만들어 보냄 (문구 불일치 거절 없음)
//     발신프로필 목록  GET /api/comm/v1/account/kakao/sender/profiles
//   응답: { common: { authCode, authResult }, data: { code, result, data } } — 둘 다 'A000' 이어야 성공
// ============================================================

const DEFAULT_BASE = 'https://mars.ibapi.kr';
const TIMEOUT_MS = 20000;

const apiKey = () => String(process.env.BIZGO_API_KEY || '').trim();
const baseUrl = () => String(process.env.BIZGO_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '');

export class BizgoError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

async function request(method, path, { query, body } = {}) {
  const key = apiKey();
  if (!key) throw new BizgoError('비즈고 API Key 가 없습니다. Vercel 환경변수 BIZGO_API_KEY 를 확인해 주세요.', 'NO_KEY');
  const url = new URL(baseUrl() + path);
  Object.entries(query || {}).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, String(v)));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual', // 인증 헤더가 다른 곳으로 가지 않게
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new BizgoError(e.name === 'AbortError' ? '비즈고 응답이 없습니다 (시간 초과).' : `비즈고 서버에 연결하지 못했습니다: ${e.message}`, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new BizgoError(`비즈고 응답을 읽을 수 없습니다 (HTTP ${res.status}).`, `HTTP_${res.status}`);
  }
  const common = json.common || {};
  const data = json.data || {};
  if (common.authCode && common.authCode !== 'A000') {
    throw new BizgoError(`비즈고 인증 실패 [${common.authCode}] ${common.authResult || ''} — API Key 또는 허용 IP 설정을 확인해 주세요.`.trim(), common.authCode);
  }
  if (data.code && data.code !== 'A000') throw new BizgoError(`비즈고 오류 [${data.code}] ${data.result || ''}`.trim(), data.code);
  if (res.status >= 400) throw new BizgoError(`비즈고 요청 실패 (HTTP ${res.status}).`, `HTTP_${res.status}`);
  return data;
}

// 카카오 발신프로필 키: 영문·숫자만, 보통 40자리 (템플릿 코드 togisa_start01 같은 값을 잘못 넣는 것 방지)
export const looksLikeSenderKey = (v) => /^[0-9A-Za-z]{30,}$/.test(String(v || ''));

// 카카오 발신프로필(채널) 목록 — senderKey 를 몰라도 여기서 찾음
export async function listSenders() {
  const data = await request('GET', '/api/comm/v1/account/kakao/sender/profiles', { query: { page: 1, rows: 50 } });
  const list = data?.data?.channels || data?.channels || [];
  return list.map((c) => ({
    senderKey: c.senderKey || '',
    channelName: c.channelName || '',
    channelId: c.channelId || '',
    status: c.status || '',
    profileStatus: c.profileStatus || '',
  }));
}

// 발신프로필 키: 환경변수 BIZGO_SENDER_KEY 가 있으면 그것, 없으면 목록에서 채널 아이디/이름으로 찾음 (하나뿐이면 그것)
export async function resolveSenderKey(hint = '') {
  if (process.env.BIZGO_SENDER_KEY) return String(process.env.BIZGO_SENDER_KEY).trim();
  const list = await listSenders();
  const h = String(hint || '').replace(/^@/, '').toLowerCase();
  const found = (h && list.find((c) => [c.channelId, c.channelName].some((v) => String(v).replace(/^@/, '').toLowerCase() === h))) || (list.length === 1 ? list[0] : null);
  if (!found?.senderKey) {
    throw new BizgoError(
      list.length
        ? `발신프로필을 찾지 못했습니다 (이 키로 쓸 수 있는 채널: ${list.map((c) => c.channelId || c.channelName).join(', ')}). 채널을 골라 주세요.`
        : '이 API Key 로 조회되는 카카오 발신프로필(채널)이 없습니다. 비즈고의 카카오 발신프로필 관리 화면에서 발신프로필 키(senderKey)를 복사해 "발신프로필 키" 칸에 넣어 주세요.',
      'NO_SENDER',
    );
  }
  return found.senderKey;
}

// 알림톡 1건 (템플릿 자동 치환) — 접수 결과 반환 (최종 도착 여부는 비즈고 리포트)
export async function sendAlimtalk({ to, templateCode, replaceWords = {}, senderKey, channel = '', ref = '' }) {
  const phone = String(to || '').replace(/\D/g, '');
  if (phone.length < 10) throw new BizgoError('받는 번호가 올바르지 않습니다.', 'BAD_PHONE');
  if (!templateCode) throw new BizgoError('템플릿 코드가 없습니다.', 'NO_TEMPLATE');
  const direct = String(senderKey || '').trim();
  if (direct && !looksLikeSenderKey(direct)) {
    throw new BizgoError('발신프로필 키 형식이 아닙니다. 템플릿 코드가 아니라, 비즈고 카카오 발신프로필 관리 화면의 긴 영문·숫자 키(보통 40자리)를 넣어 주세요.', 'BAD_SENDER_KEY');
  }
  const key = direct || (await resolveSenderKey(channel));
  const words = Object.fromEntries(Object.entries(replaceWords).map(([k, v]) => [k, String(v ?? '')]));
  const data = await request('POST', '/api/comm/v1/send/omni', {
    body: {
      destinations: [{ to: phone, replaceWords: words }],
      messageFlow: [{ alimtalk: { senderKey: key, templateCode, sendType: 'template' } }],
      ...(ref ? { ref: String(ref).slice(0, 200) } : {}),
    },
  });
  const result = data?.data || data || {};
  const keys = result.msgKeys || (result.destinations || []).map((d) => d.msgKey).filter(Boolean);
  return { ok: true, msgKey: Array.isArray(keys) ? keys.join(',') : String(result.msgKey || ''), raw: result };
}

// 발송 결과(리포트) 조회 — 접수 후 실제 도착 여부. reportCode '10000' 이면 성공 (30일 이내)
export async function inquiryReport(msgKey) {
  const key = String(msgKey || '').trim();
  if (!/^[0-9A-Za-z_-]{1,80}$/.test(key)) throw new BizgoError('메시지 키가 올바르지 않습니다.', 'BAD_MSGKEY');
  const data = await request('GET', `/api/comm/v1/report/inquiry/${encodeURIComponent(key)}`);
  const list = data?.data?.report || data?.report || [];
  return list.map((r) => ({
    msgKey: r.msgKey || key,
    serviceType: r.serviceType || '',
    sendTime: r.sendTime || '',
    reportTime: r.reportTime || '',
    reportCode: String(r.reportCode || ''),
    reportText: r.reportText || '',
    ok: String(r.reportCode || '') === '10000',
  }));
}

export const bizgoConfigured = () => !!apiKey();
