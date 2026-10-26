import Link from "next/link";
import { getMatchSource, type Match } from "@/lib/matches";

// ⚠ force-dynamic 금지. CDN 캐시가 꺼져 요청마다 오리진이 HTML을 다시 만들고,
// 그 전송량이 Fast Origin Transfer로 쌓인다. 실제로 그것 때문에 배포가 정지됐다(2026-10-24).
export const revalidate = 60;   // 경기 상황은 1분이면 충분히 신선하다

const B: Record<Match["status"], { t: string; c: string }> = {
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

// 경기 목록 — 경기별 박스로 들어가는 입구.
export default async function MatchesPage() {
  const matches = await getMatchSource().listMatches();
  const live = matches.filter((m) => m.status === "live");
  const rest = matches.filter((m) => m.status !== "live");

  const card = (m: Match) => (
    <Link className="mcard" href={`/match/${m.id}`} key={m.id}>
      <div className="lg">
        <span className={`badge ${B[m.status].c}`}>{B[m.status].t}</span>
        <span>{m.sport} · {m.league}</span>
        <span style={{ marginLeft: "auto" }}>{timeText(m)}</span>
      </div>
      <div className="teams">
        <span className="nm">{m.home}</span>
        <span className="vs">vs</span>
        <span className="nm">{m.away}</span>
        <span className="sc num">{m.scoreHome === null ? "–" : `${m.scoreHome} : ${m.scoreAway}`}</span>
      </div>
    </Link>
  );

  return (
    <main className="app">
      <header className="topbar">
        <Link className="back" href="/" aria-label="뒤로">←</Link>
        <h1>경기</h1>
      </header>
      <div className="main">
        {live.length > 0 && (<><div className="seclabel">진행 중</div>{live.map(card)}</>)}
        <div className="seclabel">{live.length ? "그 외 경기" : "경기"}</div>
        {rest.map(card)}
        <p className="note" style={{ paddingLeft: 2, paddingRight: 2 }}>
          경기를 고르면 <b>그 경기 전용 박스</b>가 열립니다. 내 박스와는 별개로 쌓입니다.
        </p>
      </div>
    </main>
  );
}
