// 규칙 기반 파서(nlToCommand)가 못 잡은 자유로운 문장을 Claude로 해석하는 폴백.
// AI는 "의도 + 키워드/스킬"만 구조화해 돌려주고, 실제 프로젝트 ID 매칭이나 DB 조작은
// 기존 결정적 코드(commands.ts)가 담당한다 — AI가 프로젝트 ID를 지어내지 못하게 하기 위함.
// ANTHROPIC_API_KEY가 없으면 아무 것도 안 하고 null 반환(규칙 파서만으로 동작).

import Anthropic from "@anthropic-ai/sdk";
import { ALL_SKILLS } from "@/lib/projects";

export type AiIntent =
  | "search" // 프로젝트 검색/매칭
  | "apply" // 신청/지원
  | "register" // 새 프로젝트 등록/구인
  | "delete" // 내 프로젝트 삭제
  | "rename" // 내 프로젝트 제목 수정
  | "status_change" // 내 프로젝트 상태 변경(모집중/마감/완료 등)
  | "status" // 특정 프로젝트 현황
  | "count" // 프로젝트 개수
  | "stats" // 지금 접속/대기 인원, 대화방, 등록 유저 등 현황
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
  title?: string; // register 전용 — 프로젝트 제목
  summary?: string; // register 전용 — 한줄 소개
};

const SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: [
        "search",
        "apply",
        "register",
        "delete",
        "rename",
        "status_change",
        "status",
        "count",
        "stats",
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
    title: { type: "string" },
    summary: { type: "string" },
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
- register: 자기가 새 프로젝트를 열고 사람을 구하고 싶음 (예: "프로젝트 등록할래", "AI 챗봇 만들 사람 구해요", "새 프로젝트 올리고 싶어"). 주의: 등록 "의사"만 있으면 register — 제목이 확실하지 않아도 됨.
- delete: 자기가 등록한 프로젝트를 삭제/내리고 싶음 (예: "이거 삭제해줘", "그 프로젝트 내려줘", "방금 등록한 거 지워")
- rename: 자기 프로젝트의 제목을 바꾸고 싶음 (예: "제목 바꿔줘", "이거 제목 수정할래")
- status_change: 자기 프로젝트의 상태를 바꾸고 싶음 — 모집 마감/완료/보류/진행중/다시 모집 등 (예: "이거 마감해줘", "모집 마감할래", "상태 완료로 바꿔줘")
- status: 특정 프로젝트의 신청 현황/상태를 보고 싶음
- count: 전체 프로젝트가 몇 개인지
- stats: 지금 접속/대기 인원, 대화 중인 방, 등록된 유저 수 등 서비스 현황 (예: "지금 몇 명 접속했어?", "대기 인원 얼마나 돼?", "사람 몇 명 있어?", "현황판 보여줘")
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
title: intent가 register일 때만 — 등록할 프로젝트의 간결한 제목(예: "AI 사내 상담봇"). 문장에서 군더더기·구인 표현을 빼고 핵심 명사구로. 그 외 intent면 빈 문자열.
summary: intent가 register일 때만 — 프로젝트를 한 줄로 설명. 없으면 빈 문자열.
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
      title: typeof parsed.title === "string" ? parsed.title : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  } catch {
    return null; // API 오류 시 조용히 규칙 파서로 폴백
  }
}
