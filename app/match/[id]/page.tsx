import Link from "next/link";
import { notFound } from "next/navigation";
import DataBox from "@/components/DataBox";
import { getMatchSource } from "@/lib/matches";

// ⚠ force-dynamic 금지. CDN 캐시가 꺼져 요청마다 오리진이 HTML을 다시 만들고,
// 그 전송량이 Fast Origin Transfer로 쌓인다. 실제로 그것 때문에 배포가 정지됐다(2026-10-24).
export const revalidate = 60;

/** 알려진 경기는 빌드 때 미리 만든다. 새 경기는 처음 요청 때 만들어 캐시한다. */
export async function generateStaticParams() {
  const all = await getMatchSource().listMatches();
  return all.map((m) => ({ id: m.id }));
}

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
