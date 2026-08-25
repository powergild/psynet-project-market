// 서버 전용 — projects 테이블 조회/생성. service role key를 쓰므로 client에서 import 금지.
import { supabase } from "@/lib/supabase";
import type { Project } from "@/lib/projects";

type ProjectRow = {
  id: string;
  title: string;
  pm: string | null;
  pm_phone: string | null;
  max_participants: number | null;
  required_skills: string[] | null;
  status: string | null;
  summary: string | null;
};

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    title: r.title,
    pm: r.pm ?? "",
    max_participants: r.max_participants ?? null,
    required_skills: r.required_skills ?? [],
    status: r.status ?? "모집중",
    summary: r.summary ?? "",
  };
}

/** 전체 프로젝트(최신 등록순). 테이블 없거나 오류면 빈 배열(서비스 안 죽게). */
export async function fetchProjects(): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ProjectRow[]).map(rowToProject);
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id.toLowerCase())
    .maybeSingle();
  if (error || !data) return undefined;
  return rowToProject(data as ProjectRow);
}

/** 이름 마스킹: 성 + ** (공개 노출용). project_pm_map에는 실명 저장. */
export function maskName(name: string): string {
  const n = name.trim();
  if (!n) return "익명";
  return n[0] + "*".repeat(Math.max(1, n.length - 1));
}

export type CreateProjectInput = {
  title: string;
  summary?: string;
  required_skills?: string[];
  pmName: string;   // 실명(마스킹해서 저장)
  pmPhone: string;  // 소유자 식별
};

/** 프로젝트 생성. id 자동 생성, status '모집중'. 반환: 생성된 Project. */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const id = `prj-u-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const row = {
    id,
    title: input.title.trim(),
    pm: maskName(input.pmName),
    pm_phone: input.pmPhone,
    max_participants: null as number | null,
    required_skills: input.required_skills ?? [],
    status: "모집중",
    summary: (input.summary ?? "").trim(),
  };
  const { data, error } = await supabase.from("projects").insert(row).select("*").single();
  if (error) throw new Error(`프로젝트 생성 실패: ${error.message}`);
  return rowToProject(data as ProjectRow);
}

/** 프로젝트 제목 변경. */
export async function updateProjectTitle(id: string, title: string): Promise<void> {
  const { error } = await supabase.from("projects").update({ title: title.trim() }).eq("id", id.toLowerCase());
  if (error) throw new Error(`제목 변경 실패: ${error.message}`);
}

/** 프로젝트 상태 변경. */
export async function updateProjectStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase.from("projects").update({ status }).eq("id", id.toLowerCase());
  if (error) throw new Error(`상태 변경 실패: ${error.message}`);
}

/** 소유자(등록자) phone. 없으면 null(레거시/미상). */
export async function getProjectOwnerPhone(id: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("pm_phone")
    .eq("id", id.toLowerCase())
    .maybeSingle();
  if (error || !data) return null;
  return (data as { pm_phone: string | null }).pm_phone ?? null;
}

/** 프로젝트 + 연관 데이터(신청·참여자·PM매핑) 삭제. */
export async function deleteProjectCascade(id: string): Promise<void> {
  const pid = id.toLowerCase();
  await supabase.from("applications").delete().eq("project_id", pid);
  await supabase.from("project_participants").delete().eq("project_id", pid);
  await supabase.from("project_pm_map").delete().eq("project_id", pid);
  const { error } = await supabase.from("projects").delete().eq("id", pid);
  if (error) throw new Error(`프로젝트 삭제 실패: ${error.message}`);
}
