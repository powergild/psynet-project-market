import Link from "next/link";
import DataBox from "@/components/DataBox";

export const dynamic = "force-dynamic";

// 메인 = 내 데이터 박스. 경기에 묶이지 않은 일반 지표 격자.
export default function HomePage() {
  return (
    <main className="app">
      <header className="topbar">
        <h1>내 박스</h1>
        <span className="spacer" />
        <Link className="ctxbtn" href="/matches">경기별로 보기 →</Link>
      </header>
      <DataBox match={null} />
    </main>
  );
}
