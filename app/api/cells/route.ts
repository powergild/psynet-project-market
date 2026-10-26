import { NextRequest, NextResponse } from "next/server";
import { computeCells, type AxisRef, type CellRequest, type MatchContext } from "@/lib/cellEngine";
import { getMatchSource } from "@/lib/matches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  matchId?: string | null;
  cond?: string;                 // 박스 전체에 걸린 조건(스포츠조각의 "조건")
  pairs?: { row: AxisRef; col: AxisRef }[];
};

/** 셀 배치 산출. 행/열 단위로 묶어 보내는 것을 전제로 한다(부분 재계산 F-16). */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const pairs = Array.isArray(body?.pairs) ? body!.pairs : [];

  if (!pairs.length) {
    return NextResponse.json({ ok: true, cells: [] });
  }
  // 한 번에 너무 많이 보내지 않도록 상한(격자가 화면을 채우므로 12행×8열 기준 여유)
  if (pairs.length > 160) {
    return NextResponse.json({ ok: false, error: "한 번에 160칸까지만 계산합니다." }, { status: 400 });
  }

  const valid: CellRequest[] = pairs.filter(
    (p) => p?.row?.id && p?.col?.id && p.row.name && p.col.name
  );

  let ctx: MatchContext = null;
  if (body?.matchId) {
    const m = await getMatchSource().getMatch(body.matchId);
    if (m) ctx = { sport: m.sport, league: m.league, home: m.home, away: m.away, status: m.status };
  }

  try {
    const cells = await computeCells(valid, ctx, (body?.cond ?? "").slice(0, 20));
    return NextResponse.json({ ok: true, cells });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "계산 실패" },
      { status: 500 }
    );
  }
}
