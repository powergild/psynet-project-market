import Link from "next/link";
import DataBox from "@/components/DataBox";
import { getMatchSource } from "@/lib/matches";

// ⚠ force-dynamic 금지. CDN 캐시가 꺼져 요청마다 오리진이 HTML을 다시 만들고,
// 그 전송량이 Fast Origin Transfer로 쌓인다. 실제로 그것 때문에 배포가 정지됐다(2026-10-24).
// 이 페이지는 서버 데이터가 없다 — 박스는 localStorage에 있고 셀은 /api/cells가 채운다.

// 메인 = 내 데이터 박스. 경기에 묶이지 않은 일반 격자.
export default async function HomePage() {
  // 조각은 "아무 팀에서나 관심 있는 선수"를 고른다 — 메인에서도 선수를 주체로 세울 수 있어야 한다.
  const matches = await getMatchSource().listMatches();
  const players = Array.from(new Set(matches.flatMap((m) => m.players))).slice(0, 40);

  return (
    <main className="app">
      <header className="topbar">
        <h1>내 박스</h1>
        <span className="spacer" />
        <Link className="ctxbtn" href="/market">마켓</Link>
        <Link className="ctxbtn" href="/matches">경기 →</Link>
      </header>
      <DataBox match={null} players={players} />
    </main>
  );
}
