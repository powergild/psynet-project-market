// 규칙 기반 파서(nlToCommand)가 못 잡은 자유로운 문장을 Claude로 해석하는 폴백.
// AI는 "의도 + 키워드/스킬"만 구조화해 돌려주고, 실제 프로젝트 ID 매칭이나 DB 조작은
// 기존 결정적 코드(commands.ts)가 담당한다 — AI가 프로젝트 ID를 지어내지 못하게 하기 위함.
// 백엔드는 AI_BACKEND(env)로 선택: "cli"(claude -p 호출형, 구독 사용) / "api"(SDK, 크레딧 사용) / 미설정.
// 어느 백엔드든 실패·비활성 시 null 반환 → 규칙 파서만으로 정상 동작(우아한 폴백).

import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ALL_SKILLS } from "@/lib/projects";

const execFileP = promisify(execFile);

export type AiIntent =
  | "search" // 프로젝트 검색/매칭
  | "apply" // 신청/지원
  | "status" // 특정 프로젝트 현황
  | "count" // 프로젝트 개수
  | "my_applications" // 내 신청 목록
  | "my_projects" // 내가 PM인 프로젝트 신청자
  | "profile" // 내 프로필
  | "skill_set" // 스킬 전체 교체
  | "skill_add" // 스킬 추가
  | "skill_remove" // 스킬 삭제
  | "logout"
  | "help"
  | "unknown";

export type AiResult = {
  intent: AiIntent;
  keywords: string[]; // 검색/매칭용 자유 키워드 (프로젝트명 조각 등)
  skills: string[]; // ALL_SKILLS 중 매칭된 것
};

const SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "search",
        "apply",
        "status",
        "count",
        "my_applications",
        "my_projects",
        "profile",
        "skill_set",
        "skill_add",
        "skill_remove",
        "logout",
        "help",
        "unknown",
      ],
    },
    keywords: { type: "array", items: { type: "string" } },
    skills: { type: "array", items: { type: "string", enum: ALL_SKILLS } },
  },
  required: ["intent", "keywords", "skills"],
  additionalProperties: false,
} as const;

let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  client = key ? new Anthropic({ apiKey: key }) : null;
  return client;
}

const SYSTEM = `너는 사내 프로젝트 마켓 터미널의 명령 해석기야. 사용자의 한국어 문장을 아래 의도 중 하나로 분류하고, 검색 키워드와 스킬을 뽑아줘.

의도(intent):
- search: 프로젝트를 찾거나 추천받고 싶음 (예: "AI 관련 뭐 있어?", "디자인 쪽 할만한 거")
- apply: 특정 프로젝트에 신청/지원하고 싶음 (예: "거기 신청할래", "이거 참여하고 싶어")
- status: 특정 프로젝트의 신청 현황/상태를 보고 싶음
- count: 전체 프로젝트가 몇 개인지
- my_applications: 내가 신청한 목록
- my_projects: 내가 PM인 프로젝트에 누가 신청했는지
- profile: 내 프로필/스킬 조회
- skill_set: 내 스킬을 통째로 바꿈
- skill_add: 스킬 추가
- skill_remove: 스킬 삭제
- logout: 로그아웃
- help: 사용법/도움말
- unknown: 위 어디에도 해당 안 됨

keywords: 검색이나 프로젝트 지목에 쓸 자유 키워드(프로젝트명 조각, 주제어). 없으면 빈 배열.
skills: 문장에 등장한, 아래 목록에 있는 스킬만. 없으면 빈 배열.
사용 가능한 스킬: ${ALL_SKILLS.join(", ")}`;

function normalize(parsed: AiResult): AiResult {
  return {
    intent: parsed.intent,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean) : [],
    skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s) => ALL_SKILLS.includes(s as never)) : [],
  };
}

/** API 백엔드(@anthropic-ai/sdk) — ANTHROPIC_API_KEY 필요, API 크레딧 소모. */
async function interpretViaApi(line: string): Promise<AiResult | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: line }],
    });
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return null;
    return normalize(JSON.parse(text.text) as AiResult);
  } catch {
    return null; // API 오류 시 조용히 규칙 파서로 폴백
  }
}

/** 호출형(CLI) 백엔드 — `claude -p` 사용. API 크레딧 대신 Claude 구독으로 처리.
 *  claude CLI 가 설치·로그인된 호스트에서만 동작(Vercel 등 서버리스 불가). AI_BACKEND=cli 로 활성화.
 *  env: CLAUDE_BIN(기본 "claude"), AI_CLI_MODEL(기본 "claude-haiku-4-5"). */
async function interpretViaCli(line: string): Promise<AiResult | null> {
  // Windows에서 claude 는 .cmd 셔임이라 execFile 이 "claude" 로는 실행 못 함 → claude.cmd 기본값.
  const bin = process.env.CLAUDE_BIN || (process.platform === "win32" ? "claude.cmd" : "claude");
  const model = process.env.AI_CLI_MODEL || "claude-haiku-4-5";
  const sys =
    SYSTEM +
    "\n\n출력 규칙: 아래 JSON 스키마에 정확히 맞는 JSON 객체 하나만 출력해. 설명·코드펜스 금지.\n" +
    JSON.stringify(SCHEMA);
  try {
    const { stdout } = await execFileP(
      bin,
      ["-p", line, "--model", model, "--output-format", "json", "--append-system-prompt", sys],
      { timeout: 20_000, maxBuffer: 1 << 20 }
    );
    // --output-format json 은 {type:"result", result:"<모델출력>", ...} 봉투로 온다.
    let body = stdout;
    try {
      const env = JSON.parse(stdout) as { result?: unknown };
      if (typeof env.result === "string") body = env.result;
    } catch {
      /* 이미 평문이면 그대로 사용 */
    }
    const m = body.match(/\{[\s\S]*\}/);
    if (!m) return null;
    return normalize(JSON.parse(m[0]) as AiResult);
  } catch {
    return null; // CLI 없음/에러/타임아웃 시 조용히 규칙 파서로 폴백
  }
}

/** 자유 문장 → 구조화된 의도. 백엔드는 AI_BACKEND(env)로 선택.
 *  "cli" → claude -p 호출형 / "api" → SDK / 미설정 → 키 있으면 api, 없으면 비활성.
 *  어느 경우든 실패 시 null → 규칙 파서로 폴백. */
export async function interpret(line: string): Promise<AiResult | null> {
  const backend = (process.env.AI_BACKEND || (process.env.ANTHROPIC_API_KEY ? "api" : "none")).toLowerCase();
  if (backend === "cli") return interpretViaCli(line);
  if (backend === "api") return interpretViaApi(line);
  return null;
}
