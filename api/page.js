// Vercel 서버 함수: 업체 로그인 주소의 첫 화면 (실제 처리는 server/page.js)
//   vercel.json 에서 /:업체, /:업체/(t|m|c), /:업체/c/:고유값 → /api/page?code=&kind=
//   ?manifest=1 이면 그 주소의 홈 화면 앱 정보(manifest)
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { handleRpc } from '../server/handler.js';
import { injectMeta, manifestFor, pageMeta, validCode, validKind } from '../server/page.js';

let cachedHtml = null; // 같은 배포 동안 index.html 은 바뀌지 않음

async function companyName(code, host) {
  if (!validCode(code)) return '';
  try {
    const out = await handleRpc({ body: { service: 'companies', method: 'publicInfo', args: [code] }, headers: { host } });
    return JSON.parse(out.body)?.result?.name || '';
  } catch {
    return ''; // DB 가 잠깐 안 돼도 화면은 열리게 (이름만 기본값)
  }
}

// 빌드된 index.html: 함수에 함께 담긴 파일(vercel.json includeFiles) → 안 되면 같은 사이트에서 받아 옴
async function indexHtml(req, host) {
  if (cachedHtml) return cachedHtml;
  try {
    cachedHtml = await readFile(path.join(process.cwd(), 'frontend/dist/index.html'), 'utf8');
  } catch {
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const r = await fetch(`${proto}://${host}/index.html`, { headers: { cookie: req.headers.cookie || '' } }); // 미리보기 배포 보호 쿠키 전달
    if (!r.ok) throw new Error(`index.html ${r.status}`);
    cachedHtml = await r.text();
  }
  return cachedHtml;
}

// 그래도 실패하면: 브라우저가 index.html 을 직접 받아 그대로 띄움 (주소는 그대로라 화면이 정상으로 열림)
const FALLBACK = '<!doctype html><meta charset="utf-8"><title>VerityBase</title><script>fetch("/index.html").then(function(r){return r.text()}).then(function(h){document.open();document.write(h);document.close()})</script>';

export default async function handler(req, res) {
  const code = String(req.query.code || '').toLowerCase();
  const kind = validKind(req.query.kind) ? String(req.query.kind || '') : '';
  const host = req.headers['x-forwarded-host'] || req.headers.host;

  if (req.query.manifest) {
    const meta = pageMeta(code, kind, await companyName(code, host));
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=600');
    res.status(200).send(JSON.stringify(manifestFor(meta)));
    return;
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  try {
    const [html, name] = await Promise.all([indexHtml(req, host), companyName(code, host)]);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300'); // 5분 동안 같은 주소는 다시 만들지 않음 (배포하면 새로)
    res.status(200).send(injectMeta(html, pageMeta(code, kind, name)));
  } catch (e) {
    console.error('[page]', e.message);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(FALLBACK);
  }
}
