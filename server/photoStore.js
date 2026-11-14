// ============================================================
// 사진 전용 저장소 (Supabase Storage)
//
// 영수증·실물 계약서·AS 사진을 DB 대신 사진 저장소에 보관합니다.
//   - 저장할 때(persistChanges): 새 사진(data:image/...)을 저장소에 올리고 DB 에는 'vbstore:경로' 만 남김
//   - 보낼 때(handler 응답): 'vbstore:경로' → 4시간 동안만 열리는 주소(서명 주소)로 바꿔서 보냄
//   - 업무 코드(frontend/src/api)는 바뀐 게 없음 — 사진 값이 글자 하나로 바뀔 뿐
//   - 설정이 없거나 올리기에 실패하면 예전처럼 DB 에 저장 (사진이 사라지지 않게)
//   - 예전에 DB 에 저장된 사진은 그대로 보임
//
// 필요한 환경변수 (Vercel 에만, 코드·채팅에 넣지 않음):
//   SUPABASE_URL               예) https://프로젝트ID.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Supabase > Settings > API Keys 의 Secret key (sb_secret_...) 또는 예전 service_role 키
//   PHOTO_BUCKET               (선택) 저장소 이름, 기본 'photos' — 없으면 비공개로 자동 생성
// ============================================================

export const STORE_PREFIX = 'vbstore:';
const SIGN_SECONDS = 4 * 3600; // 화면을 오래 열어 둬도 사진이 열리게 4시간

const base = () => String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const key = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const bucket = () => String(process.env.PHOTO_BUCKET || 'photos').trim();
export const photoStoreConfigured = () => !!(base() && key());

// 새 방식 비밀 키(sb_secret_...)는 apikey 머리글로만, 예전 service_role 키(JWT)는 Authorization 에도
const headers = (extra = {}) => (key().startsWith('sb_') ? { apikey: key(), ...extra } : { Authorization: `Bearer ${key()}`, apikey: key(), ...extra });

let bucketReady = null; // 인스턴스마다 한 번만 확인
async function ensureBucket() {
  if (!bucketReady) {
    bucketReady = fetch(`${base()}/storage/v1/bucket`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id: bucket(), name: bucket(), public: false }),
    })
      .then(async (r) => {
        // 이미 있으면 409/400 — 괜찮음
        if (!r.ok && r.status !== 409 && r.status !== 400) throw new Error(`저장소 만들기 실패 ${r.status}`);
      })
      .catch((e) => {
        bucketReady = null;
        throw e;
      });
  }
  return bucketReady;
}

// 사진 1장 올리기 → 'vbstore:경로' (실패하면 null)
export async function uploadPhoto(dataUrl, path) {
  const m = /^data:(image\/(jpeg|png|webp));base64,(.+)$/.exec(String(dataUrl));
  if (!m) return null;
  try {
    await ensureBucket();
    const r = await fetch(`${base()}/storage/v1/object/${bucket()}/${path}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': m[1], 'x-upsert': 'true', 'Cache-Control': 'max-age=31536000' }),
      body: Buffer.from(m[3], 'base64'),
    });
    if (!r.ok) throw new Error(`올리기 실패 ${r.status} ${(await r.text()).slice(0, 100)}`);
    return `${STORE_PREFIX}${path}`;
  } catch (e) {
    console.error('[사진 저장소] 실패 — DB 에 저장합니다:', e.message);
    return null;
  }
}

// 응답 안의 'vbstore:경로' 를 모두 서명 주소로 (한 번에 요청)
export async function signPhotosIn(body) {
  if (!body.includes(STORE_PREFIX)) return body;
  const paths = [...new Set([...body.matchAll(/"vbstore:([^"\\]+)"/g)].map((m) => m[1]))];
  if (!paths.length) return body;
  const urls = new Map();
  try {
    const r = await fetch(`${base()}/storage/v1/object/sign/${bucket()}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: SIGN_SECONDS, paths }),
    });
    if (!r.ok) throw new Error(`주소 만들기 실패 ${r.status}`);
    for (const x of await r.json()) {
      if (x.signedURL && x.path) urls.set(x.path, `${base()}/storage/v1${x.signedURL.startsWith('/') ? '' : '/'}${x.signedURL}`);
    }
  } catch (e) {
    console.error('[사진 저장소] 주소 만들기 실패:', e.message);
  }
  return body.replace(/"vbstore:([^"\\]+)"/g, (all, p) => (urls.has(p) ? JSON.stringify(urls.get(p)) : all));
}
