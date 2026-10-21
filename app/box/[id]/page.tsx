import Link from "next/link";
import { notFound } from "next/navigation";
import BoxDetail from "@/components/BoxDetail";
import { getMarketBox } from "@/lib/market";

export const dynamic = "force-dynamic";

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
