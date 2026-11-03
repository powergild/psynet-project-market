import Link from "next/link";
import DataBox from "@/components/DataBox";
import MatchList from "@/components/MatchList";
import { getMatchSource } from "@/lib/matches";

// ⚠ force-dynamic 금지. CDN 캐시가 꺼져 요청마다 오리진이 HTML을 다시 만들고,
// 그 전송량이 Fast Origin Transfer로 쌓인다. 실제로 그것 때문에 배포가 정지됐다(2026-10-24).
// 박스는 localStorage에 있고 셀은 /api/cells가 채운다. 서버가 주는 건 경기 목록뿐이다.
export const revalidate = 60;   // 경기 상황은 1분이면 충분히 신선하다

// 메인 = 내 박스 + 그 아래 경기 목록.
// 마켓은 따로 들어가는 곳이 아니라 맨 아래 링크 하나로 둔다 — 늘 쓰는 건 박스와 경기다.
export default async function HomePage() {
  const matches = await getMatchSource().listMatches();
  // 조각은 "아무 팀에서나 관심 있는 선수"를 고른다 — 메인에서도 선수를 주체로 세울 수 있어야 한다.
  const players = Array.from(new Set(matches.flatMap((m) => m.players))).slice(0, 40);

  return (
    <main className="app">
      <header className="topbar">
        <h1>내 박스</h1>
        <span className="spacer" />
        <Link className="ctxbtn" href="/wallet">SCO</Link>
      </header>

      <div className="homescroll">
        {/* 격자 구역의 높이는 **뷰포트 기준 고정**이다. 내용 따라 늘어나게 두면
            화면 채우기가 자기 꼬리를 쫓는다(한 번 47행까지 불었다). globals.css의 .boxsec 참고. */}
        <section className="boxsec">
          <DataBox match={null} players={players} />
        </section>

        <section className="matchsec">
          <MatchList matches={matches} />
          <Link className="morelink" href="/market">박스 마켓 →</Link>
        </section>
      </div>
    </main>
  );
}
