import Link from "next/link";
import { notFound } from "next/navigation";
import DataBox from "@/components/DataBox";
import { getMatchSource } from "@/lib/matches";

export const dynamic = "force-dynamic";

// 경기 상세 = 그 경기 단위로 묶인 데이터 박스.
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await getMatchSource().getMatch(id);
  if (!m) notFound();

  const status = m.status === "live" ? (m.minute ?? "진행 중")
    : m.status === "finished" ? "경기 종료" : "경기 예정";

  return (
    <main className="app">
      <header className="topbar">
        <Link className="back" href="/matches" aria-label="뒤로">←</Link>
        <h1>{m.home} vs {m.away}</h1>
      </header>

      <div className="matchbar">
        <span className={`badge ${m.status === "live" ? "live" : m.status === "finished" ? "fin" : "sched"}`}>
          {m.status === "live" ? "LIVE" : m.status === "finished" ? "종료" : "예정"}
        </span>
        <span className="mb-lg">{m.sport} · {m.league}</span>
        <span className="mb-sc num">
          {m.scoreHome === null ? status : `${m.scoreHome} : ${m.scoreAway} · ${status}`}
        </span>
      </div>

      <DataBox match={m} />
    </main>
  );
}
