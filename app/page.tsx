import Link from "next/link";
import DataBox from "@/components/DataBox";
import { getMatchSource, type Match } from "@/lib/matches";

export const dynamic = "force-dynamic";

const LABEL: Record<Match["status"], { t: string; c: string }> = {
  live: { t: "LIVE", c: "live" },
  scheduled: { t: "예정", c: "sched" },
  finished: { t: "종료", c: "fin" },
};

function timeText(m: Match) {
  if (m.status === "live") return m.minute ?? "진행 중";
  if (m.status === "finished") return "경기 종료";
  const d = new Date(m.startsAt);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")} 시작`;
}

export default async function HomePage() {
  const matches = await getMatchSource().listMatches();
  const live = matches.filter((m) => m.status === "live");
  const rest = matches.filter((m) => m.status !== "live");

  const card = (m: Match) => (
    <Link className="mcard" href={`/match/${m.id}`} key={m.id}>
      <div className="lg">
        <span className={`badge ${LABEL[m.status].c}`}>{LABEL[m.status].t}</span>
        <span>{m.sport} · {m.league}</span>
        <span style={{ marginLeft: "auto" }}>{timeText(m)}</span>
      </div>
      <div className="teams">
        <span className="nm">{m.home}</span>
        <span className="vs">vs</span>
        <span className="nm">{m.away}</span>
        <span className="sc num">
          {m.scoreHome === null ? "–" : `${m.scoreHome} : ${m.scoreAway}`}
        </span>
      </div>
    </Link>
  );

  return (
    <main className="app">
      <header className="topbar">
        <h1>데이터 박스</h1>
        <span className="spacer" />
        <span className="who">축을 교차시키면 AI가 채웁니다</span>
      </header>

      <div className="main">
        {live.length > 0 && (
          <>
            <div className="seclabel">진행 중</div>
            {live.map(card)}
          </>
        )}
        <div className="seclabel">{live.length ? "그 외 경기" : "경기"}</div>
        {rest.map(card)}

        <div className="note" style={{ paddingLeft: 2, paddingRight: 2 }}>
          경기를 고르면 그 경기 선수를 축으로 쓸 수 있고, 내 박스가 이 경기에 반응합니다.
          <br />우측 하단 버튼으로는 어디서나 박스를 열 수 있습니다.
        </div>
      </div>

      {/* 경기 밖 — 발광 없음, 선수 축 선택 불가 */}
      <DataBox match={null} />
    </main>
  );
}
