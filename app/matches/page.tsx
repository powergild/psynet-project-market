import Link from "next/link";
import MatchList from "@/components/MatchList";
import { getMatchSource } from "@/lib/matches";

// ⚠ force-dynamic 금지. CDN 캐시가 꺼져 요청마다 오리진이 HTML을 다시 만들고,
// 그 전송량이 Fast Origin Transfer로 쌓인다. 실제로 그것 때문에 배포가 정지됐다(2026-10-24).
export const revalidate = 60;   // 경기 상황은 1분이면 충분히 신선하다

// 경기 목록 전용 화면. 메인에도 같은 목록이 있지만, `/match/[id]`에서 돌아올 자리와
// 바깥에서 들어오는 링크가 필요해서 경로는 남겨 둔다.
export default async function MatchesPage() {
  const matches = await getMatchSource().listMatches();

  return (
    <main className="app">
      <header className="topbar">
        <Link className="back" href="/" aria-label="뒤로">←</Link>
        <h1>경기</h1>
      </header>
      <div className="main">
        <MatchList matches={matches} />
      </div>
    </main>
  );
}
