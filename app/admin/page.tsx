import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminPasswordConfigured, isValidAdminToken } from "@/lib/adminAuth";
import { getAllUsers, getBoxStats } from "@/lib/admin";
import AdminLogin from "@/components/AdminLogin";
import AdminLogout from "@/components/AdminLogout";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!adminPasswordConfigured()) {
    return (
      <main className="app">
        <header className="topbar"><h1>관리자</h1></header>
        <div className="main"><p className="note">ADMIN_PASSWORD 환경변수가 설정되지 않았어.</p></div>
      </main>
    );
  }

  const store = await cookies();
  if (!isValidAdminToken(store.get(ADMIN_COOKIE)?.value)) return <AdminLogin />;

  const [users, stats] = await Promise.all([getAllUsers(), getBoxStats()]);
  const hitRate = stats.glowScored > 0 ? Math.round((stats.glowHit / stats.glowScored) * 100) : null;

  const cell: React.CSSProperties = { padding: "7px 8px", fontSize: 13 };
  const th: React.CSSProperties = {
    textAlign: "left", padding: "6px 8px", fontSize: 11,
    color: "var(--ink-soft)", borderBottom: "1px solid var(--line)",
  };

  return (
    <main className="app">
      <header className="topbar">
        <h1>관리자 — 데이터 박스</h1>
        <span className="spacer" />
        <AdminLogout />
      </header>

      <div className="main">
        <div className="seclabel">운영 지표</div>
        {stats.unavailable ? (
          <div className="mcard" style={{ cursor: "default" }}>
            <p className="note" style={{ padding: 0 }}>
              박스 테이블이 아직 없습니다. Supabase SQL Editor에서{" "}
              <b>supabase/migrations/2026-10-20-databox.sql</b> 을 실행하세요.
            </p>
          </div>
        ) : (
          <div className="mcard" style={{ cursor: "default" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                <tr><td style={cell}>생성된 박스</td><td className="num" style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{stats.boxes}</td></tr>
                <tr><td style={cell}>캐시된 축 조합</td><td className="num" style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{stats.cachedCombos}</td></tr>
                <tr><td style={cell}>캐시 누적 히트<br /><span style={{ fontSize: 11, color: "var(--ink-soft)" }}>AI 호출을 아낀 횟수</span></td><td className="num" style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{stats.cacheHits}</td></tr>
                <tr><td style={cell}>발광 선언</td><td className="num" style={{ ...cell, textAlign: "right", fontWeight: 700 }}>{stats.glowTotal}</td></tr>
                <tr>
                  <td style={cell}>채점 완료 / 적중</td>
                  <td className="num" style={{ ...cell, textAlign: "right", fontWeight: 700 }}>
                    {stats.glowScored} / {stats.glowHit}
                    {hitRate !== null && <span style={{ color: "var(--amber-deep)" }}> ({hitRate}%)</span>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="seclabel">전체 사용자 ({users.length}명)</div>
        {users.length === 0 ? (
          <div className="empty-state">아직 가입한 사용자 없음.</div>
        ) : (
          <div className="mcard" style={{ cursor: "default", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>{["이름", "전화번호", "이메일", "최근 로그인"].map((h) => <th key={h} style={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={cell}>{u.name}</td>
                    <td style={cell} className="num">{u.phone}</td>
                    <td style={{ ...cell, color: "var(--ink-soft)" }}>{u.email ?? "-"}</td>
                    <td style={{ ...cell, fontSize: 12, color: "var(--ink-soft)" }}>
                      {new Date(u.last_login_at).toLocaleDateString("ko-KR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
