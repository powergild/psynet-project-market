import Link from "next/link";
import { notFound } from "next/navigation";
import DataBox from "@/components/DataBox";
import { getMatchSource } from "@/lib/matches";

export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const src = getMatchSource();
  const m = await src.getMatch(id);
  if (!m) notFound();
  const stats = await src.getStats(id);

  const statusText =
    m.status === "live" ? (m.minute ?? "진행 중")
    : m.status === "finished" ? "경기 종료"
    : "경기 예정";

  return (
    <main className="app">
      <header className="topbar">
        <Link className="back" href="/" aria-label="뒤로">←</Link>
        <h1>{m.home} vs {m.away}</h1>
      </header>

      <div className="main">
        <div className="mcard" style={{ cursor: "default" }}>
          <div className="lg">
            <span className={`badge ${m.status === "live" ? "live" : m.status === "finished" ? "fin" : "sched"}`}>
              {m.status === "live" ? "LIVE" : m.status === "finished" ? "종료" : "예정"}
            </span>
            <span>{m.sport} · {m.league}</span>
            <span style={{ marginLeft: "auto" }}>{statusText}</span>
          </div>
          <div className="teams">
            <span className="nm">{m.home}</span>
            <span className="vs">vs</span>
            <span className="nm">{m.away}</span>
            <span className="sc num">
              {m.scoreHome === null ? "–" : `${m.scoreHome} : ${m.scoreAway}`}
            </span>
          </div>
        </div>

        {stats.length > 0 && (
          <>
            <div className="seclabel">경기 기록</div>
            <div className="mcard" style={{ cursor: "default" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.key}>
                      <td className="num" style={{ padding: "7px 0", fontSize: 14, fontWeight: 600, width: 60 }}>
                        {s.home}
                      </td>
                      <td style={{ padding: "7px 0", fontSize: 12, color: "var(--ink-soft)", textAlign: "center" }}>
                        {s.key}
                      </td>
                      <td className="num" style={{ padding: "7px 0", fontSize: 14, fontWeight: 600, width: 60, textAlign: "right" }}>
                        {s.away}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <div className="note" style={{ paddingLeft: 2, paddingRight: 2 }}>
          이 경기 선수를 축으로 쓸 수 있습니다. 우측 하단 버튼으로 박스를 여세요.
        </div>
      </div>

      <DataBox match={m} />
    </main>
  );
}
