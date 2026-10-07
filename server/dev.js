// 로컬 개발용 API 서버 (http://localhost:3001) — 화면 개발 서버(vite)가 /api 요청을 여기로 넘깁니다.
//   사용: npm run dev:api   (루트 .env 의 DATABASE_URL, SESSION_SECRET 사용)
import http from 'node:http';
import { handleRpc } from './handler.js';
import { healthReport } from './health.js';
import { compressIfUseful } from './compress.js';

const PORT = Number(process.env.API_PORT || 3001);

http
  .createServer(async (req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/api/rpc')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(await healthReport(), null, 2));
      return;
    }
    if (req.method !== 'POST' || !req.url.startsWith('/api/rpc')) {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body;
    try {
      body = JSON.parse(raw || '{}');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const out = compressIfUseful(await handleRpc({ body, headers: req.headers }), req.headers['accept-encoding']);
    res.writeHead(out.status, out.headers).end(out.body);
  })
  .listen(PORT, () => console.log(`UFFICE API 서버: http://localhost:${PORT}/api/rpc`));
