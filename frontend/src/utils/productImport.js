// 상품 목록 붙여넣기 해석 — 예전 프로그램 상품 화면을 복사한 글
//   한 줄: 번호 ⇥ 상품명 ⇥ 구분 ⇥ 품목 ⇥ 상세품목 ⇥ 노출여부(Y/N) [⇥ 관리]
//   머리줄·빈 줄은 건너뛰고, 두 줄이 붙어 복사된 경우(…N ⇥ 19 ⇥ …)도 나눠서 읽음
const ROW = /(?:^|[\t\n\r ])(\d+)\t([^\t\n\r]*)\t(패키지|추가시공품목|무료시공)\t([^\t\n\r]*)\t([^\t\n\r]*)\t\s*([YN])(?=[\t\n\r ]|$)/g;

export function parseProductText(text) {
  const rows = [];
  for (const m of String(text || '').matchAll(ROW)) {
    rows.push({ no: Number(m[1]), name: m[2].trim(), kind: m[3], category: m[4].trim(), detail: m[5].trim(), visible: m[6] === 'Y' });
  }
  return rows.filter((r) => r.name).sort((a, b) => a.no - b.no); // 예전 번호 순으로 등록 (1번이 먼저)
}
