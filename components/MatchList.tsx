import Link from "next/link";
import type { Match } from "@/lib/matches";

// 경기 목록. 메인(`/`)과 `/matches`가 같은 markup을 쓴다 —
// 두 군데에 베껴 두면 한쪽만 고쳐져 조용히 갈라진다.

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

function Card({ m }: { m: Match }) {
  return (
    <Link className="mcard" href={`/match/${m.id}`}>
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
}

export default function MatchList({ matches }: { matches: Match[] }) {
  const live = matches.filter((m) => m.status === "live");
  const rest = matches.filter((m) => m.status !== "live");

  return (
    <>
      {live.length > 0 && (
        <>
          <div className="seclabel">진행 중</div>
          {live.map((m) => <Card key={m.id} m={m} />)}
        </>
      )}
      <div className="seclabel">{live.length ? "그 외 경기" : "경기"}</div>
      {rest.map((m) => <Card key={m.id} m={m} />)}
      <p className="note" style={{ paddingLeft: 2, paddingRight: 2 }}>
        경기를 고르면 <b>그 경기 전용 박스</b>가 열립니다. 내 박스와는 별개로 쌓입니다.
      </p>
    </>
  );
}
