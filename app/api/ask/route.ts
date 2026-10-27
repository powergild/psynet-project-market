import { NextRequest, NextResponse } from "next/server";
import { computeCells, type MatchContext } from "@/lib/cellEngine";
import { UNKNOWN, NO_VALUE } from "@/lib/axes";
import { getMatchSource } from "@/lib/matches";
import { logInfoRequest } from "@/lib/infoRequests";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  matchId?: string | null;
  cond?: string;
  row?: { id: string; name: string; ctx?: string | null; src?: string | null };
  col?: { id: string; name: string; ctx?: string | null; src?: string | null };
};

/**
 * 한 칸만 다시 묻는다(정보 요청).
 *
 * 격자 전체를 한 번에 물으면 모델의 주의가 흩어져 모르는 대상에 같은 값을 복사해
 * 넣는 일이 생긴다. 한 칸만 떼어 물으면 달라질 여지가 있으므로 먼저 그걸 시도하고,
 * 그래도 모른다고 하면 **요청으로 기록한다.** 그 목록이 곧 데이터 연동의 우선순위다.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body?.row?.name || !body?.col?.name) {
    return NextResponse.json({ ok: false, error: "행과 열이 필요합니다." }, { status: 400 });
  }
  // 같은 이름이 행과 열에 동시에 오면 물을 것이 없다 — 요청으로도 받지 않는다.
  if (body.row.name === body.col.name) {
    return NextResponse.json({ ok: true, resolved: false, value: null, from: "blocked" });
  }
  const cond = (body.cond ?? "").slice(0, 40);

  let ctx: MatchContext = null;
  if (body.matchId) {
    const m = await getMatchSource().getMatch(body.matchId);
    if (m) ctx = {
      sport: m.sport, league: m.league, home: m.home, away: m.away, status: m.status,
      startsAt: m.startsAt, weather: m.weather,
    };
  }

  try {
    // 캐시에 "모름"이 박혀 있으면 지우고 다시 묻는다 — 요청의 뜻이 그것이다.
    await supabase.from("cell_cache").delete().eq("value", UNKNOWN)
      .like("combo_key", `%${body.row.name}|%`);

    const [cell] = await computeCells([{ row: body.row, col: body.col }], ctx, cond);
    const resolved = !!cell && cell.value !== UNKNOWN && cell.value !== NO_VALUE;

    if (!resolved) {
      await logInfoRequest({
        cond, row: body.row.name, col: body.col.name, matchId: body.matchId ?? null,
      });
    }
    return NextResponse.json({
      ok: true,
      resolved,
      value: resolved ? cell.value : null,
      from: cell?.from ?? "failed",
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "요청 실패" },
      { status: 500 }
    );
  }
}
