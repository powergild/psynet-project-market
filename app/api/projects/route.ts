import { NextResponse } from "next/server";
import { fetchProjects } from "@/lib/projectsDb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 전체 프로젝트(공개 안전 필드만 — pm_phone 등 비공개 필드 제외).
export async function GET() {
  const projects = await fetchProjects();
  const items = projects.map((p) => ({
    id: p.id,
    title: p.title,
    pm: p.pm,
    status: p.status,
    required_skills: p.required_skills,
    summary: p.summary,
  }));
  return NextResponse.json({ ok: true, count: items.length, items });
}
