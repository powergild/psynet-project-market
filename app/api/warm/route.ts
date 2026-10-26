import { NextRequest, NextResponse } from "next/server";
import { computeCells, type MatchContext } from "@/lib/cellEngine";
import { cliEnabled } from "@/lib/cliEngine";
import { warmTargets, type WarmScope } from "@/lib/warm";
import { getMatchSource } from "@/lib/matches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Body = { scope?: WarmScope; matchId?: string; offset?: number; limit?: number };

/**
 * 캐시 예열. 표준 조합을 미리 계산해 cell_cache에 깔아둔다.
 *
 * 로컬 전용이다 — CLAUDE_CLI=1 일 때만 연다. 프로덕션에 열어두면
 * 아무나 대량 AI 호출을 유발할 수 있고, 예열은 구독으로 돌리는 게 목적이다.
 */
export async function POST(req: NextRequest) {
  if (!cliEnabled()) {
    return NextResponse.json(
      { ok: false, error: "예열은 로컬(CLAUDE_CLI=1)에서만 실행합니다." },
      { status: 403 }
    );
  }

  const body = (await req.json().catch(() => null)) as Body | null;
  const scope: WarmScope = body?.scope === "match" ? "match" : "global";
  const offset = Math.max(0, body?.offset ?? 0);
  const limit = Math.min(60, Math.max(1, body?.limit ?? 40));

  // 경기 예열은 한 경기씩 돌린다 — 맥락을 한 묶음에 하나만 실을 수 있기 때문이다.
  if (scope === "match" && !body?.matchId) {
    return NextResponse.json({ ok: false, error: "matchId가 필요합니다." }, { status: 400 });
  }

  const all = await warmTargets(scope, body?.matchId);
  const batch = all.slice(offset, offset + limit);
  if (!batch.length) {
    return NextResponse.json({ ok: true, total: all.length, done: true, cache: 0, ai: 0, failed: 0 });
  }

  // 경기 맥락은 묶음 단위로 하나다(한 경기씩 예열하므로).
  let ctx: MatchContext = null;
  if (scope === "match" && body?.matchId) {
    const m = await getMatchSource().getMatch(body.matchId);
    if (m) ctx = { sport: m.sport, league: m.league, home: m.home, away: m.away, status: m.status };
  }

  let res;
  try {
    res = await computeCells(batch, ctx);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "예열 실패" },
      { status: 500 }
    );
  }
  const count = (k: string) => res.filter((r) => r.from === k).length;

  return NextResponse.json({
    ok: true,
    total: all.length,
    offset,
    done: offset + batch.length >= all.length,
    cache: count("cache"),
    ai: count("ai"),
    failed: count("failed"),
  });
}

/** 예열 대상 경기 목록. LIVE스코어가 붙으면 여기 그대로 따라온다. */
export async function GET() {
  if (!cliEnabled()) {
    return NextResponse.json({ ok: false, error: "로컬 전용" }, { status: 403 });
  }
  const matches = await getMatchSource().listMatches();
  return NextResponse.json({ ok: true, matches: matches.map((m) => ({ id: m.id, sport: m.sport })) });
}
