// ============================================================
// 업체 자료 기억해 두기 (기능 dbCache) — DB 전송량(Supabase egress) 절약
//
// 예전: 요청마다 그 업체의 계약 등 표 전체를 DB 에서 읽음 (계약 5천 건이면 요청마다 수 MB)
// 지금: 서버(인스턴스)가 표를 기억해 두고, 지난번 이후 바뀐 줄·지워진 줄만 DB 에서 읽음
//
// 바뀐 줄 찾기: 줄마다 쓴 트랜잭션 번호(vx, 트리거가 넣음), 지운 줄은 row_deletes 표(트리거가 기록)
//   기준선(wm) = 읽기 직전 '아직 끝나지 않은 가장 오래된 트랜잭션 번호'
//   → 그 번호 이상인 줄을 다음에 다시 읽으므로, 늦게 끝난(커밋된) 트랜잭션의 줄도 놓치지 않음
// 안전장치: 20분마다 표 전체를 다시 읽음, VB_DB_CACHE=0 이면 전부 끔
// ============================================================

const TTL_MS = 20 * 60 * 1000;
const entries = new Map(); // `${table}:${companyId}` → { rows: Map<id, json>, list: json[] | null, wm, at }
const locks = new Map(); // 같은 표를 동시에 고치지 않게 (요청 순서대로)

export const cacheOff = () => process.env.VB_DB_CACHE === '0';
export const clearRowCache = () => entries.clear();

async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  const chain = prev.then(() => mine);
  locks.set(key, chain);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}

// 업체 표의 줄들(JSON 글자, id 순서) — 요청의 트랜잭션(client) 안에서 읽어 그 순간의 최신 상태
export async function companyRows(client, table, companyId) {
  const key = `${table}:${companyId}`;
  return withLock(key, async () => {
    const wm = (await client.query('SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS wm')).rows[0].wm;
    let e = entries.get(key);
    if (!e || Date.now() - e.at > TTL_MS) {
      const r = await client.query(`SELECT id, data::text AS j FROM ${table} WHERE company_id = $1`, [companyId]);
      e = { rows: new Map(r.rows.map((x) => [Number(x.id), x.j])), list: null, wm, at: Date.now() };
      entries.set(key, e);
    } else {
      const del = await client.query(`SELECT row_id FROM row_deletes WHERE tbl = $1 AND company_id = $2 AND vx >= $3::xid8`, [table, companyId, e.wm]);
      const upd = await client.query(`SELECT id, data::text AS j FROM ${table} WHERE company_id = $1 AND vx >= $2::xid8`, [companyId, e.wm]);
      // 지운 줄 먼저, 지금 있는 줄을 나중에 (지웠다가 되돌린 줄은 다시 들어감)
      del.rows.forEach((x) => {
        if (e.rows.delete(Number(x.row_id))) e.list = null;
      });
      upd.rows.forEach((x) => {
        const id = Number(x.id);
        if (e.rows.get(id) !== x.j) {
          e.rows.set(id, x.j);
          e.list = null;
        }
      });
      e.wm = wm;
    }
    if (!e.list) e.list = [...e.rows.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]); // 새 배열 (이미 넘겨준 배열은 그대로)
    const list = e.list;
    // 시험용: 기억해 둔 자료가 DB 를 직접 읽은 것과 같은지 매번 비교 (VB_VERIFY_CACHE=1)
    if (process.env.VB_VERIFY_CACHE === '1') {
      const direct = (await client.query(`SELECT data::text AS j FROM ${table} WHERE company_id = $1 ORDER BY id`, [companyId])).rows.map((x) => x.j);
      if (direct.length !== list.length || direct.some((j, i) => j !== list[i])) throw new Error(`[자료 기억 비교] ${table}:${companyId} 가 DB 와 다름`);
    }
    return list;
  });
}
