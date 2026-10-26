// Claude Code CLI 백엔드 — 서버 전용.
//
// API 키(종량 과금) 대신 로컬에 설치된 Claude Code를 `-p`로 돌려 **구독으로** 산출한다.
// 켜는 법: .env.local에 CLAUDE_CLI=1 (키가 있어도 CLI를 우선한다).
//
// ⚠️ 이건 **로컬 전용이다.** Vercel 서버리스에는 Claude Code가 없고 자식 프로세스도 못 띄운다.
//    프로덕션은 ANTHROPIC_API_KEY 경로로 돌아간다. 둘 중 아무것도 없으면 셀은 "—"가 된다.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const TIMEOUT_MS = 120_000;

/** npm 전역 설치의 Node 엔트리. .cmd 셔임을 쓰면 shell이 필요해지고 개행 인자가 깨진다. */
function entryPath(): string | null {
  const explicit = process.env.CLAUDE_CLI_ENTRY;
  if (explicit && existsSync(explicit)) return explicit;

  const appData = process.env.APPDATA;
  const candidates = [
    appData && path.join(appData, "npm/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs"),
    "/usr/local/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs",
    "/usr/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs",
    process.env.HOME && path.join(process.env.HOME, ".npm-global/lib/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs"),
  ].filter(Boolean) as string[];

  return candidates.find((p) => existsSync(p)) ?? null;
}

let resolved: string | null | undefined;
export function cliEnabled(): boolean {
  if (process.env.CLAUDE_CLI !== "1") return false;
  if (resolved === undefined) resolved = entryPath();
  return resolved !== null;
}

/** ```json 펜스로 감싸서 오는 경우가 잦다. */
function unfence(s: string): string {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (m ? m[1] : s).trim();
}

/**
 * 모델에게 JSON 하나를 받아온다. 실패하면 null — 호출부가 "—"로 처리한다.
 * CLI는 json_schema 강제를 지원하지 않으므로 시스템 프롬프트로 형식을 못박고 파싱에서 거른다.
 */
export async function cliAskJson(system: string, user: string): Promise<string | null> {
  if (!cliEnabled() || !resolved) return null;

  const args = [
    resolved, "-p", user,
    "--output-format", "json",
    "--model", "claude-haiku-4-5",
    "--system-prompt", system,
    "--strict-mcp-config",
  ];

  return new Promise((resolve) => {
    // cwd를 임시 폴더로 둔다 — 프로젝트 안에서 돌리면 CLAUDE.md·settings가 통째로 딸려와 느려진다.
    const child = spawn(process.execPath, args, {
      cwd: tmpdir(),
      windowsHide: true,
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "databox" },
    });

    // stdin을 바로 닫는다 — 안 닫으면 CLI가 3초간 입력을 기다린다.
    child.stdin.end();

    let out = "";
    let err = "";
    let done = false;
    const finish = (v: string | null) => { if (!done) { done = true; resolve(v); } };

    const timer = setTimeout(() => { child.kill(); finish(null); }, TIMEOUT_MS);

    child.stdout.on("data", (d) => { out += String(d); });
    child.stderr.on("data", (d) => { err += String(d); });
    child.on("error", () => { clearTimeout(timer); finish(null); });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const env = JSON.parse(out) as {
          result?: string; is_error?: boolean;
          duration_api_ms?: number; stop_reason?: string;
        };
        // API를 아예 말걸지 않고 돌아오면 사용량 한도다. 형식 오류와 섞이면 진단이 안 된다.
        if (env.duration_api_ms === 0 && !env.result) {
          console.error("[cli] 구독 사용량 한도에 걸린 것으로 보입니다(API 호출 0ms).");
          return finish(null);
        }
        if (env.is_error || typeof env.result !== "string") {
          console.error("[cli] 응답 오류", JSON.stringify(env).slice(0, 200));
          return finish(null);
        }
        return finish(unfence(env.result));
      } catch {
        console.error("[cli] 파싱 실패", out.slice(0, 300), err.slice(0, 200));
        return finish(null);
      }
    });
  });
}
