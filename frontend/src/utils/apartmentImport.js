// 아파트 목록 붙여넣기 해석 — 예전 프로그램 아파트 화면을 복사한 글
//   한 줄: 번호 ⇥ 시도 / 시군구 ⇥ 아파트명
const ROW = /(?:^|[\t\n\r ])(\d+)\t([^\t\n\r/]+?)\s*\/\s*([^\t\n\r]*?)\t([^\t\n\r]+)/g;

// 예전 이름 → 지금 이름 (지역 목록과 맞춤)
const SIDO_ALIAS = { 강원도: '강원특별자치도', 전라북도: '전북특별자치도', 세종시: '세종특별자치시', 제주도: '제주특별자치도' };
export const normalizeSido = (s) => SIDO_ALIAS[String(s || '').trim()] || String(s || '').trim();

export function parseApartmentText(text) {
  const rows = [];
  for (const m of String(text || '').matchAll(ROW)) {
    rows.push({ no: Number(m[1]), sido: normalizeSido(m[2]), sigungu: m[3].trim(), name: m[4].trim() });
  }
  return rows.filter((r) => r.name).sort((a, b) => a.no - b.no); // 예전 번호 순으로 등록
}
