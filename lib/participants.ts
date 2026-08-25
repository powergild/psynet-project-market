// 프로젝트 참여자 조회/관리. 실명↔프로젝트 매핑(project_participants)을 다룬다.
// 호감 성사 시 상대의 참여 프로젝트 리스트를 뽑고, 관리자에서 추가/삭제한다.
// 카탈로그(data/projects.json)에 존재하는 프로젝트만 노출한다 — 제외된 프로젝트
// (보안 등)의 참여 기록은 리스트에 안 나옴.

import { supabase, type ProjectParticipantRow } from "@/lib/supabase";
import { fetchProjects } from "@/lib/projectsDb";

export type ParticipantProject = {
  projectId: string;
  title: string;
  role: string;
};

/** 이름으로 그 사람이 참여한(카탈로그에 있는) 프로젝트 목록. */
export async function getProjectsByParticipant(name: string): Promise<ParticipantProject[]> {
  const { data, error } = await supabase
    .from("project_participants")
    .select("project_id, role")
    .eq("name", name);
  if (error) throw new Error(error.message);
  const titleById = new Map((await fetchProjects()).map((p) => [p.id, p.title]));
  const out: ParticipantProject[] = [];
  for (const row of (data ?? []) as Pick<ProjectParticipantRow, "project_id" | "role">[]) {
    const title = titleById.get(row.project_id);
    if (!title) continue; // 카탈로그에 없는 프로젝트는 제외
    out.push({ projectId: row.project_id, title, role: row.role });
  }
  // PM을 위로, 그다음 제목순
  out.sort((a, b) => (a.role === "PM" ? -1 : b.role === "PM" ? 1 : a.title.localeCompare(b.title)));
  return out;
}

/** 특정 프로젝트의 참여자 목록(관리자용). */
export async function listParticipants(projectId: string): Promise<ProjectParticipantRow[]> {
  const { data, error } = await supabase
    .from("project_participants")
    .select("*")
    .eq("project_id", projectId)
    .order("role", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectParticipantRow[];
}

/** 참여자 추가(관리자). 중복이면 무시. */
export async function addParticipant(projectId: string, name: string, role: string): Promise<void> {
  const { error } = await supabase
    .from("project_participants")
    .upsert({ project_id: projectId, name, role }, { onConflict: "project_id,name" });
  if (error) throw new Error(error.message);
}

/** 참여자 삭제(관리자). */
export async function removeParticipant(id: number): Promise<void> {
  const { error } = await supabase.from("project_participants").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
