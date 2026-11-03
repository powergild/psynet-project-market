// 자체 호스팅 구동기 — `STANDALONE=1 npm run build` 뒤에 쓴다.
//
//   node scripts/serve.mjs            (기본 3100 포트)
//   PORT=8080 node scripts/serve.mjs
//
// 왜 server.js를 직접 안 부르고 이걸 거치나:
//  1) standalone 번들은 .env 파일을 **스스로 읽지 않는다.** 환경변수를 넣어줘야 한다.
//  2) `.env.local`에는 `CLAUDE_CLI`가 들어 있는데, 이게 운영에 켜지면
//     `/api/warm`이 인증 없는 무제한 AI 호출 창구가 된다. 여기서 반드시 떨군다.
//  3) 빌드가 빠뜨리기 쉬운 `.next/static` 복사를 확인해 준다.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STANDALONE = path.join(ROOT, ".next", "standalone");

/** 운영에 절대 들어가면 안 되는 키. 있으면 조용히 빼고 경고한다. */
const BANNED = ["CLAUDE_CLI", "CLAUDE_CLI_ENTRY"];

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    let v = line.slice(eq + 1).trim();
    // 따옴표로 감싼 값은 벗긴다.
    if (v.length > 1 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

if (!fs.existsSync(path.join(STANDALONE, "server.js"))) {
  console.error("자립형 번들이 없다. 먼저 빌드할 것:\n  STANDALONE=1 npm run build");
  process.exit(1);
}

// 빌드는 .next/static을 번들 안으로 복사해 주지 않는다. 없으면 CSS·JS가 통째로 404다.
const src = path.join(ROOT, ".next", "static");
const dst = path.join(STANDALONE, ".next", "static");
if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });

// 뒤에 오는 것이 이긴다. 실제 셸 환경변수가 파일보다 우선이다.
const env = {
  ...readEnvFile(path.join(ROOT, ".env.local")),
  ...readEnvFile(path.join(ROOT, ".env.production.local")),
  ...process.env,
};

const dropped = BANNED.filter((k) => env[k] !== undefined);
for (const k of dropped) delete env[k];
if (dropped.length) console.warn(`[serve] 운영 금지 키를 제거했다: ${dropped.join(", ")}`);

const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ADMIN_PASSWORD"].filter((k) => !env[k]);
if (missing.length) console.warn(`[serve] ⚠ 비어 있는 환경변수: ${missing.join(", ")}`);

env.NODE_ENV = "production";
env.PORT = process.env.PORT ?? "3100";
// Tunnel이 같은 PC에서 붙으므로 루프백으로 충분하다. 사내망에 열려면 0.0.0.0.
env.HOSTNAME = process.env.HOSTNAME ?? "127.0.0.1";

console.log(`[serve] http://${env.HOSTNAME}:${env.PORT} 에서 시작`);

spawn(process.execPath, [path.join(STANDALONE, "server.js")], {
  cwd: STANDALONE,
  env,
  stdio: "inherit",
}).on("exit", (code) => process.exit(code ?? 0));
