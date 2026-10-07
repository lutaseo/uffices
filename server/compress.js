// 응답 압축: 계약 목록처럼 큰 응답(수 MB)을 gzip 으로 줄여 보냄 (보통 1/10 이하)
//   브라우저가 gzip 을 받을 수 있다고 알려 줄 때만, 1KB 넘는 응답만
import zlib from 'node:zlib';

export function compressIfUseful(out, acceptEncoding = '') {
  const body = out.body || '';
  if (body.length < 1024 || !/\bgzip\b/.test(String(acceptEncoding))) return out;
  const zipped = zlib.gzipSync(Buffer.from(body, 'utf8'), { level: 6 });
  return { ...out, body: zipped, headers: { ...out.headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } };
}
