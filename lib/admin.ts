import { supabase, type ApplicationRow, type UserRow } from "@/lib/supabase";
import { fetchProjects } from "@/lib/projectsDb";
import type { Project } from "@/lib/projects";

export type ProjectApplications = {
  project: Project;
  applications: ApplicationRow[];
};

export async function getAdminApplications(): Promise<ProjectApplications[]> {
  const projects = await fetchProjects();
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const byProject = new Map<string, ApplicationRow[]>();
  for (const row of data ?? []) {
    const list = byProject.get(row.project_id) ?? [];
    list.push(row);
    byProject.set(row.project_id, list);
  }

  const result: ProjectApplications[] = [];
  for (const project of projects) {
    const applications = byProject.get(project.id);
    if (applications && applications.length) result.push({ project, applications });
  }

  // 대기중인 신청이 있는 프로젝트를 위로
  result.sort((a, b) => {
    const aPending = a.applications.some((x) => x.status === "pending") ? 0 : 1;
    const bPending = b.applications.some((x) => x.status === "pending") ? 0 : 1;
    return aPending - bPending;
  });

  return result;
}

export async function getAllUsers(): Promise<UserRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("last_login_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as UserRow[];
}
