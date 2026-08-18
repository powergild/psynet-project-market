// 규칙 기반 파서(nlToCommand)가 못 잡은 자유로운 문장을 Claude로 해석하는 폴백.
// AI는 "의도 + 키워드/스킬"만 구조화해 돌려주고, 실제 프로젝트 ID 매칭이나 DB 조작은
// 기존 결정적 코드(commands.ts)가 담당한다 — AI가 프로젝트 ID를 지어내지 못하게 하기 위함.
// ANTHROPIC_API_KEY가 없으면 아무 것도 안 하고 null 반환(규칙 파서만으로 동작).

import Anthropic from "@anthropic-ai/sdk";
import { ALL_SKILLS } from "@/lib/projects";

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

/** 자유 문장 → 구조화된 의도. 실패/키없음 시 null. */
export async function interpret(line: string): Promise<AiResult | null> {
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
    const parsed = JSON.parse(text.text) as AiResult;
    return {
      intent: parsed.intent,
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter(Boolean) : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills.filter((s) => ALL_SKILLS.includes(s as never)) : [],
    };
  } catch {
    return null; // API 오류 시 조용히 규칙 파서로 폴백
  }
}
