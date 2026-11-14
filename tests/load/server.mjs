// 부하 시험용 API 서버 한 개 (run.mjs 가 여러 개 띄움 — Vercel 처럼 서버 여러 대가 같은 DB 를 씀)
import http from 'node:http';
import { handleRpc } from '../../server/handler.js';

const PORT = Number(process.argv[2]);
http
  .createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      const out = await handleRpc({ body: JSON.parse(raw || '{}'), headers: req.headers });
      res.writeHead(out.status, out.headers).end(out.body);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: e.message } }));
    }
  })
  .listen(PORT, () => process.send?.('ready'));
