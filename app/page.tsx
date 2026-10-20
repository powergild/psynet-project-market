import DataBox from "@/components/DataBox";
import { getMatchSource } from "@/lib/matches";

export const dynamic = "force-dynamic";

// 데이터 박스가 메인 서비스다. 첫 화면이 곧 내 박스.
export default async function HomePage() {
  const matches = await getMatchSource().listMatches();
  return <DataBox matches={matches} />;
}
