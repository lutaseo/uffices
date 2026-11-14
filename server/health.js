// 서버 연결 점검: 브라우저로 https://(사이트주소)/api/rpc 를 열면 표시됩니다.
//   비밀값 자체는 절대 보여주지 않고, "있음/없음"과 연결 결과만 알려줍니다.
import { getPool } from './pg.js';

const has = (k) => !!String(process.env[k] || '').trim();

// DB 연결 오류를 이해하기 쉬운 말로 (오류 원문에는 주소가 들어 있을 수 있어 그대로 내보내지 않음)
function explain(e) {
  const msg = String(e?.message || '');
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return 'DB 주소(호스트)를 찾을 수 없습니다. DATABASE_URL 의 @ 뒤 주소를 확인하세요.';
  if (e?.code === '28P01' || /password authentication failed/i.test(msg)) return 'DB 비밀번호가 틀립니다. Supabase 에서 비밀번호를 바꿨다면 DATABASE_URL 에도 새 비밀번호를 넣으세요.';
  if (/tenant or user not found/i.test(msg)) return 'DB 사용자 이름이 틀립니다. Supabase Connect 의 Transaction pooler 주소(postgres.프로젝트ID 형식)를 그대로 쓰세요.';
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || /timeout/i.test(msg)) return 'DB 에 연결되지 않습니다(시간 초과). 주소의 포트(6543)와 Supabase 프로젝트가 일시중지(Paused) 상태인지 확인하세요.';
  if (/invalid url|invalid connection/i.test(msg)) return 'DATABASE_URL 형식이 올바르지 않습니다. 비밀번호에 @ # / 같은 기호가 있으면 다른 비밀번호로 바꾸세요.';
  return `DB 연결 실패 (${e?.code || '원인 미상'})`;
}

export async function healthReport() {
  const secretLen = String(process.env.SESSION_SECRET || '').length;
  const mode = String(process.env.VITE_API_MODE || '').trim().toLowerCase();
  const report = {
    서버: '동작 중',
    설정값: {
      VITE_API_MODE: mode === 'server' ? '정상 (server)' : mode ? `값이 "server" 가 아닙니다` : '없음 → 화면이 데모 모드로 만들어집니다',
      DATABASE_URL: has('DATABASE_URL') ? '있음' : '없음',
      SESSION_SECRET: !secretLen ? '없음' : secretLen < 32 ? `너무 짧음 (${secretLen}자, 32자 이상 필요)` : '있음',
      INIT_SUPER_LOGIN: has('INIT_SUPER_LOGIN') ? '있음' : '없음',
      INIT_SUPER_PASSWORD: !has('INIT_SUPER_PASSWORD') ? '없음' : String(process.env.INIT_SUPER_PASSWORD).length < 8 ? '너무 짧음 (8자 이상 필요)' : '있음',
    },
    DB연결: '확인 전',
    사진저장소: has('SUPABASE_URL') && has('SUPABASE_SERVICE_ROLE_KEY') ? '설정됨 (새 사진은 Supabase Storage 에 저장)' : '설정 안 됨 (사진은 DB 에 저장) — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 필요',
  };
  if (!has('DATABASE_URL')) {
    report.DB연결 = 'DATABASE_URL 이 없어 확인할 수 없습니다.';
    return report;
  }
  try {
    const client = await getPool().connect();
    try {
      await client.query('SELECT 1');
      report.DB연결 = '정상';
      // DB 왕복 시간: 서버(서울)와 DB 위치가 멀면 느려짐 → Supabase 프로젝트 지역을 서울로 권장
      const times = [];
      for (let i = 0; i < 3; i++) {
        const t = Date.now();
        await client.query('SELECT 1');
        times.push(Date.now() - t);
      }
      const ms = Math.min(...times);
      report.DB응답시간 = `${ms}ms ${ms <= 30 ? '(빠름)' : ms <= 100 ? '(보통)' : '(느림 — Supabase 프로젝트 지역이 서울(ap-northeast-2)이 아닐 수 있습니다)'}`;
      // 멈춰 있는 DB 작업 (있으면 화면이 '불러오는 중...'에 머물 수 있음)
      try {
        const st = await client.query(`SELECT
            count(*) FILTER (WHERE state LIKE 'idle in transaction%' AND now() - state_change > interval '1 minute')::int AS stuck,
            count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS waiting
          FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()`);
        const { stuck, waiting } = st.rows[0];
        report.멈춘작업 = stuck || waiting ? `확인 필요: 멈춘 작업 ${stuck}개, 잠금 대기 ${waiting}개` : '없음';
      } catch {
        report.멈춘작업 = '확인 불가';
      }
      const t = await client.query(`SELECT to_regclass('public.users') IS NOT NULL AS ok`);
      if (!t.rows[0].ok) report.계정 = '아직 표가 없습니다 (첫 로그인 시도 때 자동 생성)';
      else {
        const { rows } = await client.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE data->>'role' = 'SUPER')::int AS s FROM users`);
        report.계정 = `전체 ${rows[0].n}개 (운영자 ${rows[0].s}개)`;
      }
    } finally {
      client.release();
    }
  } catch (e) {
    report.DB연결 = explain(e);
  }
  return report;
}
