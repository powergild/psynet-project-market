import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminPasswordConfigured, isValidAdminToken } from "@/lib/adminAuth";
import { getAdminApplications, getAllUsers } from "@/lib/admin";
import AdminLogin from "@/components/AdminLogin";
import AdminLogout from "@/components/AdminLogout";
import AdminApplicationActions from "@/components/AdminApplicationActions";
import AdminParticipants from "@/components/AdminParticipants";
import { fetchProjects } from "@/lib/projectsDb";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "대기중",
  accepted: "수락됨",
  rejected: "거절됨",
};

export default async function AdminPage() {
  if (!adminPasswordConfigured()) {
    return (
      <main className="cards-page">
        <h1>관리자 페이지</h1>
        <p className="sub">ADMIN_PASSWORD 환경변수가 설정되지 않았어.</p>
      </main>
    );
  }

  const store = await cookies();
  const token = store.get(ADMIN_COOKIE)?.value;

  if (!isValidAdminToken(token)) {
    return <AdminLogin />;
  }

  const [projectApps, users, allProjects] = await Promise.all([
    getAdminApplications(),
    getAllUsers(),
    fetchProjects(),
  ]);
  const pendingTotal = projectApps.reduce(
    (s, p) => s + p.applications.filter((a) => a.status === "pending").length,
    0
  );

  return (
    <main className="cards-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>관리자 — 신청 현황</h1>
        <AdminLogout />
      </div>
      <a href="/">← 홈으로</a>

      <h2 style={{ marginTop: 28, marginBottom: 8 }}>전체 사용자 ({users.length}명)</h2>
      {users.length === 0 ? (
        <p className="sub">아직 가입한 사용자 없음.</p>
      ) : (
        <div className="card" style={{ display: "block", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["이름", "전화번호", "이메일", "스킬", "가입일", "최근 로그인"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      padding: "6px 8px",
                      fontSize: 12,
                      color: "#8c887e",
                      borderBottom: "1px solid #2a2a26",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={{ padding: "6px 8px 6px 0", fontSize: 13 }}>{u.name}</td>
                  <td style={{ padding: "6px 8px", fontSize: 13 }}>{u.phone}</td>
                  <td style={{ padding: "6px 8px", fontSize: 13 }}>{u.email ?? "-"}</td>
                  <td style={{ padding: "6px 8px", fontSize: 13 }}>
                    {u.skills.length ? u.skills.join(", ") : "-"}
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 12, color: "#8c887e" }}>
                    {new Date(u.created_at).toLocaleDateString("ko-KR")}
                  </td>
                  <td style={{ padding: "6px 8px", fontSize: 12, color: "#8c887e" }}>
                    {new Date(u.last_login_at).toLocaleDateString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 style={{ marginTop: 28, marginBottom: 8 }}>프로젝트 참여자 관리</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        프로젝트를 고르고 참여자를 추가/삭제해. 미토크리에이트에서 서로 호감이면 상대의 참여 프로젝트 리스트로 뜬다.
      </p>
      <AdminParticipants projects={allProjects.map((p) => ({ id: p.id, title: p.title }))} />

      <h2 style={{ marginTop: 28, marginBottom: 8 }}>프로젝트 신청 현황</h2>
      <p className="sub" style={{ marginTop: 0 }}>
        신청 있는 프로젝트 {projectApps.length}건 · 대기중인 신청 {pendingTotal}건
      </p>

      {projectApps.length === 0 ? (
        <p className="sub">아직 신청 없음.</p>
      ) : (
        projectApps.map(({ project, applications }) => (
          <div className="card" key={project.id} style={{ display: "block" }}>
            <div className="title">{project.title}</div>
            <div className="meta" style={{ marginBottom: 10 }}>
              PM: {project.pm} · {applications.length}명 신청
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td style={{ padding: "6px 8px 6px 0", fontSize: 13 }}>{a.applicant}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12, color: "#8c887e" }}>{a.role}</td>
                    <td style={{ padding: "6px 8px", fontSize: 12, color: "#8c887e" }}>
                      {STATUS_LABEL[a.status]}
                    </td>
                    <td style={{ padding: "6px 0", textAlign: "right" }}>
                      {a.status === "pending" && <AdminApplicationActions id={a.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </main>
  );
}
