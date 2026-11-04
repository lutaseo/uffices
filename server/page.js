// 업체 로그인 주소(/thegood, /thegood/t, /thegood/m, /thegood/c)를 열 때 보내는 첫 화면(index.html)에
//   주소에 맞는 이름을 넣어 줌 — 카톡 등 링크 미리보기, 안드로이드 '홈 화면에 추가' 이름은
//   화면 프로그램이 돌기 전의 HTML·앱 정보(manifest)만 읽기 때문 (브라우저 탭 이름은 화면이 따로 바꿈)

// 업체 주소가 아닌 첫 단어 (화면 이름 — frontend/src/router.js 의 PAGES 와 같게)
const PAGES = new Set(['c', 'e', 'm', 't', 'consult', 'contracts', 'customers', 'schedule', 'progress', 'stats', 'admin', 'settings', 'me', 'engineer', 'sign', 'api', 'assets']);
const KINDS = {
  '': { label: '일반화면', desc: '전자계약 · 시공일정 관리', short: (n) => n },
  t: { label: '상담실장', desc: '상담실장 전용 · 계약 등록과 상담 관리', short: (n) => `${n} 상담` },
  m: { label: '기사모바일', desc: '시공기사 전용 · 내 일정 확인과 완료 보고', short: (n) => `${n} 기사` },
  c: { label: '내 계약 확인', desc: '내 계약 · 시공 일정 확인', short: (n) => `${n} 내 계약` },
};

export const validCode = (code) => /^[a-z0-9-]{2,30}$/.test(String(code || '').toLowerCase()) && !PAGES.has(String(code).toLowerCase());
export const validKind = (kind) => Object.prototype.hasOwnProperty.call(KINDS, kind || '');

// 주소 → { title, short, desc, start } (업체 이름이 없으면 null)
export function pageMeta(code, kind = '', companyName = '') {
  const k = KINDS[kind || ''];
  const name = String(companyName || '').trim();
  if (!k || !name || !validCode(code)) return null;
  const c = String(code).toLowerCase();
  return {
    title: kind === 'c' ? `${k.label} · ${name}` : `${k.label} · ${name} VerityBase`,
    short: k.short(name),
    desc: `${name} ${k.desc}`,
    start: `/${c}${kind ? `/${kind}` : ''}`,
  };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// index.html 에 이름 넣기: <title>, 홈 화면 이름(iOS), 링크 미리보기(og), 앱 정보(manifest) 주소
export function injectMeta(html, meta) {
  if (!meta) return html;
  const manifest = `/api/page?manifest=1&code=${encodeURIComponent(meta.start.split('/')[1])}&kind=${encodeURIComponent(meta.start.split('/')[2] || '')}`;
  let out = String(html)
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${esc(meta.short)}$2`)
    .replace(/(<link rel="manifest" href=")[^"]*(")/, `$1${esc(manifest)}$2`);
  const og = [
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.desc)}" />`,
    `<meta property="og:site_name" content="VerityBase" />`,
    `<meta property="og:image" content="/icon-512.png" />`,
    `<meta name="description" content="${esc(meta.desc)}" />`,
  ].join('\n    ');
  out = out.replace('</head>', `    ${og}\n  </head>`);
  return out;
}

// 홈 화면 앱 정보 (안드로이드는 이 이름을 아이콘 아래에 씀). 주소마다 다른 앱으로 보이게 id·start_url 을 따로
export function manifestFor(meta) {
  return {
    name: meta ? meta.title : 'VerityBase',
    short_name: meta ? meta.short : 'VerityBase',
    ...(meta ? { id: meta.start, start_url: meta.start } : {}),
    icons: [
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    theme_color: '#1a6fe0',
    background_color: '#ffffff',
    display: 'browser',
  };
}
