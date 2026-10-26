import Link from "next/link";
import { notFound } from "next/navigation";
import BoxDetail from "@/components/BoxDetail";
import { getMarket, getMarketBox } from "@/lib/market";

// ⚠ force-dynamic 금지. CDN 캐시가 꺼져 요청마다 오리진이 HTML을 다시 만들고,
// 그 전송량이 Fast Origin Transfer로 쌓인다. 실제로 그것 때문에 배포가 정지됐다(2026-10-24).
// 마켓 박스는 코드 상수다 — 빌드 때 다 만들어 둔다.
export function generateStaticParams() {
  return getMarket().map((b) => ({ id: b.id }));
}

// SCR-005 박스 상세 — 타인 박스 그리드 열람 (F-19)
export default async function BoxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const box = getMarketBox(id);
  if (!box) notFound();

  return (
    <main className="app">
      <header className="topbar">
        <Link className="back" href="/market" aria-label="뒤로">←</Link>
        <h1>{box.name}</h1>
      </header>
      <BoxDetail box={box} />
    </main>
  );
}
