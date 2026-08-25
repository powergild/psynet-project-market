// 순수 타입/헬퍼만 — supabase(서비스키) import 금지. client 컴포넌트에서도 안전하게 import 가능.
// DB 조회/생성은 서버 전용 lib/projectsDb.ts 에 있음.

export type Project = {
  id: string;
  title: string;
  pm: string;
  max_participants: number | null;
  required_skills: string[];
  status: string;
  summary: string;
};

export function gradeFor(mySkills: string[], required: string[]): "A" | "B" | "C" | "D" {
  if (!required.length) return "B";
  const overlap = required.filter((r) => mySkills.includes(r)).length;
  const ratio = overlap / required.length;
  if (ratio >= 0.8) return "A";
  if (ratio >= 0.5) return "B";
  if (ratio >= 0.25) return "C";
  return "D";
}

export const GRADE_COLOR: Record<string, string> = {
  A: "#5FD98A",
  B: "#FFB800",
  C: "#FF5A4E",
  D: "#FF5A4E",
  신규: "#8C887E",
};

export const ALL_SKILLS = [
  "기획",
  "디자인",
  "프론트엔드",
  "백엔드",
  "데이터분석",
  "AI/ML",
  "마케팅",
  "운영",
  "영상편집",
  "번역",
];
