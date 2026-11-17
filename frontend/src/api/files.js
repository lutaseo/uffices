// ============================================================
// 회사 자료 백업 (설정 > 회사 자료 백업, 기능 companyFiles)
//
// PDF · PPT · 엑셀 · 사진 등 회사 자료를 올려 두고 어디서든 내려받기
//   - 파일 자체는 파일 저장소(Supabase Storage)에 — 화면이 저장소로 직접 올림 (서버 크기 제한 없이)
//   - 목록(이름·크기·올린 사람)은 업체 정보의 files 에 보관
//   - 올리기: [add] 자리 만들기 + 올릴 주소 → 화면이 저장소에 올림 → [confirm] 완료 표시
//   - 보기: 관리자 · 실장 (기사 제외) / 올리기 · 지우기: 관리자 또는 '기초설정' 권한
//   - 저장소 연결은 runtime.fileStore() — 서버에서만 (브라우저 데모 모드는 사용 불가)
// ============================================================

import { saveDb, fileStore } from './runtime.js';
import { ApiError, session, nowIso, requireFeature } from './core.js';
import { ROLES, can } from '../auth/permissions.js';

export const FILE_MAX_MB = 50;
const FILE_MAX = FILE_MAX_MB * 1024 * 1024;
const FILES_PER_COMPANY = 300; // 목록은 업체 정보에 담겨 매 요청 함께 읽히므로 적당히
const PENDING_HOURS = 6; // 올리다 멈춘 자리는 이 시간 뒤 정리

async function office(manage = false) {
  const { db, user } = await session();
  if (user.role !== ROLES.ADMIN && user.role !== ROLES.MANAGER) throw new ApiError('권한이 없습니다.', 'FORBIDDEN');
  requireFeature(db, user, 'companyFiles');
  if (manage && user.role !== ROLES.ADMIN && !can(user, 'settings.manage')) throw new ApiError('자료를 올리거나 지울 권한이 없습니다.', 'FORBIDDEN');
  const company = db.companies.find((c) => c.id === user.companyId);
  if (!company) throw new ApiError('업체를 찾을 수 없습니다.', 'NOT_FOUND');
  return { db, user, company };
}

function store() {
  const s = fileStore();
  if (!s || !s.configured()) throw new ApiError('파일 저장소가 연결되어 있지 않습니다. 운영자에게 문의해 주세요.');
  return s;
}

const view = (f) => ({ id: f.id, name: f.name, size: f.size, type: f.type, memo: f.memo || '', byName: f.byName, createdAt: f.createdAt });

export const companyFiles = {
  // 올려 둔 자료 목록 (최근 것부터) + 내려받기 주소 (몇 시간 동안 열림)
  async list() {
    const { company } = await office();
    const ready = (company.files || []).filter((f) => f.ready).sort((a, b) => b.id - a.id);
    const s = fileStore();
    const urls = s && s.configured() && ready.length ? await s.downloadUrls(ready.map((f) => ({ path: f.path, name: f.name }))) : {};
    return ready.map((f) => ({ ...view(f), url: urls[f.path] || '' }));
  },

  // 올릴 자리 만들기 → { id, uploadUrl } (화면이 uploadUrl 로 파일을 직접 올린 뒤 confirm)
  async add({ name, size, type, memo } = {}) {
    const { db, user, company } = await office(true);
    const s = store();
    const fileName = String(name || '').trim().replace(/[\\/]/g, '_').slice(0, 200);
    const bytes = Number(size) || 0;
    if (!fileName) throw new ApiError('파일 이름이 없습니다.');
    if (bytes <= 0) throw new ApiError('빈 파일은 올릴 수 없습니다.');
    if (bytes > FILE_MAX) throw new ApiError(`파일은 ${FILE_MAX_MB}MB 까지 올릴 수 있습니다. (${fileName})`);
    const cutoff = Date.now() - PENDING_HOURS * 3600 * 1000;
    const files = (company.files || []).filter((f) => f.ready || new Date(f.createdAt).getTime() > cutoff);
    if (files.length >= FILES_PER_COMPANY) throw new ApiError(`자료는 ${FILES_PER_COMPANY}개까지 둘 수 있습니다. 필요 없는 자료를 지워 주세요.`);
    const id = files.reduce((m, f) => Math.max(m, f.id), company.filesSeq || 0) + 1;
    const ext = (/\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1] || 'bin').toLowerCase();
    const path = `files/${company.id}/${id}-${Math.random().toString(36).slice(2, 10)}.${ext}`; // 저장소 경로는 영문만 (한글 이름은 목록에)
    const entry = { id, name: fileName, size: bytes, type: String(type || '').slice(0, 100), memo: String(memo || '').trim().slice(0, 200), path, ready: false, byName: user.name, createdAt: nowIso() };
    company.files = [...files, entry];
    company.filesSeq = id;
    const uploadUrl = await s.uploadUrl(path);
    saveDb(db);
    return { id, uploadUrl };
  },

  // 올리기 끝 → 목록에 보이게
  async confirm(id) {
    const { db, company } = await office(true);
    const f = (company.files || []).find((x) => x.id === Number(id));
    if (!f) throw new ApiError('자료를 찾을 수 없습니다.', 'NOT_FOUND');
    f.ready = true;
    saveDb(db);
    return view(f);
  },

  // 지우기 (저장소의 파일도 함께)
  async remove(id) {
    const { db, company } = await office(true);
    const f = (company.files || []).find((x) => x.id === Number(id));
    if (!f) throw new ApiError('자료를 찾을 수 없습니다.', 'NOT_FOUND');
    company.files = company.files.filter((x) => x !== f);
    saveDb(db);
    const s = fileStore();
    if (s && s.configured()) await s.remove([f.path]).catch(() => {}); // 저장소 삭제가 실패해도 목록에서는 빠짐
    return { ok: true };
  },
};
