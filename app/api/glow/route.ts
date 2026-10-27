import { NextRequest, NextResponse } from "next/server";
import { analyzeGlow, type GlowCandidate, type MatchContext } from "@/lib/cellEngine";
import { ensureBox, recordGlow, boxRecord, scoreMatch } from "@/lib/boxDb";
import { getMatchSource } from "@/lib/matches";
import { pieceStatsMany, pieceId } from "@/lib/pieces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  matchId?: string;
  boxId?: string;
  owner?: string;
  boxName?: string;
  cond?: string;                 // 박스 조건 — 조각 식별자의 일부다
  cells?: GlowCandidate[];
};

/**
 * F-05 경기 맥락 발광.
 * 경기를 읽고 유효한 셀을 고른 뒤, 그 선택을 예측 선언으로 기록한다(F-06의 입력).
 * 경기가 이미 끝났다면 먼저 미채점 선언을 채점한다.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const matchId = body?.matchId;
  const boxId = body?.boxId;
  const cells = Array.isArray(body?.cells) ? body!.cells!.slice(0, 160) : [];
  const cond = (body?.cond ?? "").slice(0, 20);

  if (!matchId || !boxId) {
    return NextResponse.json({ ok: false, error: "경기와 박스가 필요합니다." }, { status: 400 });
  }

  const m = await getMatchSource().getMatch(matchId);
  if (!m) return NextResponse.json({ ok: false, error: "없는 경기입니다." }, { status: 404 });

  const ctx: MatchContext = {
    sport: m.sport, league: m.league, home: m.home, away: m.away, status: m.status,
  };

  try {
    if (!cells.length) {
      return NextResponse.json({ ok: true, analyzed: true, cells: [], line: "", record: await boxRecord(boxId) });
    }

    const glow = await analyzeGlow(cells, ctx);

    // 격자의 모든 셀이 그 경기의 선언이다 — 발광 여부와 무관하게 성적이 쌓인다.
    await ensureBox(boxId, body?.owner || "anon", body?.boxName || "내 박스");
    await recordGlow(boxId, matchId, glow.cells, cells, cond);

    // 채점은 기록 뒤에 한다 — 끝난 경기는 방금 한 선언도 바로 채점되어야 한다.
    if (m.status === "finished") {
      await scoreMatch(matchId, m.home, m.scoreHome, m.scoreAway);
    }

    // 격자 전체의 등급을 돌려준다 — 모든 셀이 조각이므로 모든 셀에 등급이 붙는다.
    const stats = await pieceStatsMany(cells.map((c) => ({ cond, row: c.row, col: c.col })));
    const tiers = cells.map((c) => {
      const s = stats.get(pieceId({ cond, row: c.row, col: c.col }));
      return {
        rowId: c.rowId, colId: c.colId,
        tier: s?.tier ?? "일반",
        trust: s?.trust ?? null,
        scored: s?.scored ?? 0,
      };
    });

    return NextResponse.json({
      ok: true,
      analyzed: glow.ok,          // false = 분석 자체를 못 했다(빈 결과와 구분해야 한다)
      cells: glow.cells,
      tiers,
      line: glow.line,
      record: await boxRecord(boxId),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "분석 실패" },
      { status: 500 }
    );
  }
}
