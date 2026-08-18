#!/usr/bin/env node
// connect 실시간 매칭 마이그레이션을 Supabase(Postgres)에 적용한다.
// DDL(함수 생성)은 supabase-js(PostgREST)로 불가하므로 Postgres 직결(pg)로 실행한다.
//
// 필요: 환경변수 SUPABASE_DB_URL = Postgres 연결 문자열
//   Supabase 대시보드 → Project Settings → Database → Connection string(URI)
//   예) postgresql://postgres:<PW>@db.<ref>.supabase.co:5432/postgres  (또는 pooler 6543)
//   .env.local 에 SUPABASE_DB_URL 로 넣어두면 됨(연결문자열엔 DB 비밀번호 포함 → git 커밋 금지).
//
// 실행:  node scripts/apply-connect-liveness.mjs
// pg 미설치 시:  npm i -D pg   후 재실행.
// (자동 적용이 번거로우면 supabase/migrations/2026-08-18-connect-liveness.sql 을
//  Supabase SQL Editor 에 붙여넣고 Run 해도 동일하다.)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SQL_PATH = path.join(ROOT, "supabase", "migrations", "2026-08-18-connect-liveness.sql");

// .env.local 로드(있으면)
try {
  for (const line of readFileSync(path.join(ROOT, ".env.local"), "utf-8").split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i === -1) continue;
    process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {
  /* .env.local 없으면 무시 */
}

const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const sql = readFileSync(SQL_PATH, "utf-8");

if (!dbUrl) {
  console.error(
    [
      "SUPABASE_DB_URL(또는 DATABASE_URL) 가 없습니다.",
      "",
      "방법 A) 자동 적용:",
      "  1) Supabase → Project Settings → Database → Connection string(URI) 복사",
      "  2) .env.local 에  SUPABASE_DB_URL=postgresql://postgres:<PW>@db.<ref>.supabase.co:5432/postgres  추가",
      "  3) (필요시) npm i -D pg   후   node scripts/apply-connect-liveness.mjs",
      "",
      "방법 B) 수동 적용(가장 간단):",
      `  ${path.relative(ROOT, SQL_PATH)} 전체를 Supabase SQL Editor 에 붙여넣고 Run.`,
    ].join("\n")
  );
  process.exit(1);
}

let pg;
try {
  pg = await import("pg");
} catch {
  console.error("pg 모듈이 없습니다. 'npm i -D pg' 후 다시 실행하거나, SQL Editor 로 수동 적용하세요.");
  process.exit(1);
}

const { Client } = pg.default ?? pg;
const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log("✅ connect 실시간 매칭 마이그레이션 적용 완료 (connect_match_or_queue 갱신 + 유령 정리).");
} catch (e) {
  console.error("적용 실패:", e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
