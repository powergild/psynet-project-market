import { notFound } from "next/navigation";
import DataBox from "@/components/DataBox";
import { getMatchSource } from "@/lib/matches";

export const dynamic = "force-dynamic";

// 특정 경기 맥락으로 박스를 여는 딥링크. 화면 구조는 메인과 같다.
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const src = getMatchSource();
  const [m, matches] = await Promise.all([src.getMatch(id), src.listMatches()]);
  if (!m) notFound();
  return <DataBox matches={matches} initialMatchId={m.id} />;
}
