// Vercel 서버 함수: POST /api/rpc  (실제 처리는 server/handler.js)
import { handleRpc } from '../server/handler.js';
import { healthReport } from '../server/health.js';
import { compressIfUseful } from '../server/compress.js';

export default async function handler(req, res) {
  // 주소창에서 열면(GET) 서버 연결 점검 결과 표시
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const report = await healthReport();
    // 자동 깨우기(vercel.json crons, 매일 새벽 3시): Supabase 무료 요금제가 7일 동안 안 쓰면 일시정지되는 것 방지
    if (/vercel-cron/i.test(String(req.headers['user-agent'] || ''))) console.log(`[자동 깨우기] DB연결: ${report.DB연결}`);
    res.status(200).send(JSON.stringify(report, null, 2));
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: { message: 'POST 요청만 허용됩니다.', code: 'METHOD' } });
    return;
  }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const out = compressIfUseful(await handleRpc({ body, headers: req.headers }), req.headers['accept-encoding']);
  Object.entries(out.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.status(out.status).send(out.body);
}
