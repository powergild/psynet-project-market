import { NextResponse } from "next/server";
import { fetchProjects } from "@/lib/projectsDb";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "구인 중" = 형성/개발 단계 + 사용자 등록(모집중)이라 협업자 합류가 가능한 프로젝트.
// 상용(라이브)·보류는 제외. max_participants는 대부분 기본값이라 신뢰도 낮아 상태 기반으로 판단.
const RECRUITING_STATUS = new Set(["기획", "예정", "개발", "모집중"]);

export async function GET() {
  const projects = (await fetchProjects()).filter((p) => RECRUITING_STATUS.has(p.status));

  // 프로젝트별 현재 참여자 수(DB). 테이블 없거나 오류면 count 생략(null).
  const counts = new Map<string, number>();
  try {
    const { data, error } = await supabase.from("project_participants").select("project_id");
    if (!error && data) {
      for (const row of data as { project_id: string }[]) {
        counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
      }
    }
  } catch {
    /* 무시 — count 없이 진행 */
  }

  const items = projects.map((p) => ({
    id: p.id,
    title: p.title,
    pm: p.pm,
    status: p.status,
    requiredSkills: p.required_skills,
    participantCount: counts.size ? counts.get(p.id) ?? 0 : null,
  }));

  return NextResponse.json({ ok: true, count: items.length, items });
}
