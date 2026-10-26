// 박스 영속 — 서버 전용.
//
// 발광(F-05)은 곧 예측 선언이고, 선언은 나중에 채점(F-06)되어 적중률(F-07)이 된다.
// 그러려면 "누가 언제 무엇을 주장했는가"가 브라우저가 아니라 DB에 남아야 한다.
// 박스 자체는 클라이언트(localStorage)가 소유하지만, 선언 시점에 박스 행을 만들어 둔다.

import { supabase } from "@/lib/supabase";
import type { GlowCandidate, GlowPick } from "@/lib/cellEngine";
import { expFor } from "@/lib/pieces";
import { getMatchSource } from "@/lib/matches";

/** 박스 행이 없으면 만든다. glow_records가 boxes를 참조하므로 선언 전에 반드시 호출. */
export async function ensureBox(boxId: string, owner: string, name: string): Promise<void> {
  await supabase
    .from("boxes")
    .upsert({ id: boxId, owner_phone: owner, name, updated_at: new Date().toISOString() },
            { onConflict: "id" });
}

/** 발광 = 예측 선언. 유저 별도 행동 없이 기록된다(기획서 1-5 단계 9). */
export async function recordGlow(
  boxId: string,
  matchId: string,
  picks: GlowPick[],
  cands: GlowCandidate[],
  cond = ""
): Promise<void> {
  if (!picks.length) return;

  // 축 id는 박스를 다시 만들 때마다 바뀐다 — unique 제약이 id 기준이라 같은 선언이 중복으로 쌓인다.
  // 다시 분석하면 아직 채점되지 않은 선언은 갈아치운다. 채점된 선언은 건드리지 않는다.
  await supabase
    .from("glow_records")
    .delete()
    .eq("box_id", boxId)
    .eq("match_id", matchId)
    .eq("scored", false);

  const byId = new Map(cands.map((c) => [c.rowId + "|" + c.colId, c]));
  const rows = picks.map((p) => {
    const c = byId.get(p.rowId + "|" + p.colId);
    return {
      box_id: boxId,
      match_id: matchId,
      condition: cond,
      row_axis_id: p.rowId,
      col_axis_id: p.colId,
      row_axis_name: c?.row ?? "",
      col_axis_name: c?.col ?? "",
      value_at_glow: c?.value ?? "",
      reason: p.why,
    };
  });
  const conflict = "box_id,match_id,row_axis_id,col_axis_id";
  const { error } = await supabase.from("glow_records").upsert(rows, { onConflict: conflict });

  // 2026-10-27 마이그레이션 전이면 condition 컬럼이 없다. 선언 기록이 통째로 막히는 것보다
  // 조건 없이라도 남기는 편이 낫다 — 마이그레이션을 돌리면 자동으로 정상 경로를 탄다.
  if (error?.message?.includes("condition")) {
    console.error("[glow] condition 컬럼 없음 — 2026-10-27-pieces.sql 실행 필요");
    const bare = rows.map(({ condition, ...r }) => r);
    await supabase.from("glow_records").upsert(bare, { onConflict: conflict });
  }
}

export type Declaration = {
  id: number;
  matchId: string;
  row: string;
  col: string;
  value: string;
  reason: string;
  declaredAt: string;
  scored: boolean;
  hit: boolean | null;
};

export async function listDeclarations(boxId: string, limit = 40): Promise<Declaration[]> {
  const { data, error } = await supabase
    .from("glow_records")
    .select("id,match_id,row_axis_name,col_axis_name,value_at_glow,reason,declared_at,scored,hit")
    .eq("box_id", boxId)
    .order("declared_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    matchId: String(r.match_id),
    row: String(r.row_axis_name ?? ""),
    col: String(r.col_axis_name ?? ""),
    value: String(r.value_at_glow ?? ""),
    reason: String(r.reason ?? ""),
    declaredAt: String(r.declared_at),
    scored: Boolean(r.scored),
    hit: r.hit === null || r.hit === undefined ? null : Boolean(r.hit),
  }));
}

export type BoxRecord = { declared: number; scored: number; hits: number; rate: number | null };

/** F-07 적중률 배지. 채점된 선언만 분모에 넣는다. */
export async function boxRecord(boxId: string): Promise<BoxRecord> {
  const { data, error } = await supabase
    .from("glow_records")
    .select("scored,hit")
    .eq("box_id", boxId);
  if (error || !data) return { declared: 0, scored: 0, hits: 0, rate: null };
  const rows = data as { scored: boolean; hit: boolean | null }[];
  const scored = rows.filter((r) => r.scored);
  const hits = scored.filter((r) => r.hit).length;
  return {
    declared: rows.length,
    scored: scored.length,
    hits,
    rate: scored.length ? Math.round((hits / scored.length) * 100) : null,
  };
}

/**
 * F-06 자동 채점.
 * 경기가 끝났으면 그 경기에 걸린 미채점 선언을 결과와 대조해 확정한다.
 * 선언값은 "그 기준이 유리할 확률"이므로, 홈 승리와 50% 기준선으로 판정한다.
 * 결과는 한 번 쓰면 고치지 않는다 — 사후에 바뀌는 성적은 성적이 아니다.
 */
export async function scoreMatch(
  matchId: string,
  home: string,
  scoreHome: number | null,
  scoreAway: number | null
): Promise<number> {
  if (scoreHome === null || scoreAway === null) return 0;
  const { data, error } = await supabase
    .from("glow_records")
    .select("id,row_axis_name,col_axis_name,condition,value_at_glow")
    .eq("match_id", matchId)
    .eq("scored", false);
  if (error || !data || !data.length) return 0;

  const src = getMatchSource();
  const match = await src.getMatch(matchId);
  const stats = match ? await src.getStats(matchId) : [];

  const draw = scoreHome === scoreAway;
  const homeWon = scoreHome > scoreAway;
  const now = new Date().toISOString();

  type R = { id: number; row_axis_name: string; col_axis_name: string; condition: string; value_at_glow: string };
  for (const r of data as R[]) {
    const v = parseFloat(r.value_at_glow);
    if (!isFinite(v)) continue;
    // 행 축이 주체다. "원정팀"만 원정을 가리키고, 나머지 기준은 홈 관점으로 읽는다.
    const subjectWon = r.row_axis_name === "원정팀" ? !homeWon : homeWon;
    // 무승부는 어느 쪽도 이기지 않았다 — 50 근처로 선언했을 때만 적중으로 본다.
    const hit = draw ? Math.abs(v - 50) <= 5 : (v >= 50) === subjectWon;

    // 맞았느냐로 끝내지 않는다 — 얼마나 맞아떨어졌는지가 조각을 키운다.
    const exp = match
      ? expFor({ hit, cond: r.condition ?? "", colAxis: r.col_axis_name,
                 rowAxis: r.row_axis_name, match, stats })
      : 0;

    await supabase.from("glow_records")
      .update({ scored: true, hit, exp, scored_at: now })
      .eq("id", r.id);
  }
  return data.length;
}

/** 관리자 대시보드용 집계. */
export async function getBoxStats() {
  const q = async (table: string, col: string) => {
    const { data, error } = await supabase.from(table).select(col).limit(5000);
    return error || !data ? 0 : data.length;
  };
  const [boxes, combos, glow] = await Promise.all([
    q("boxes", "id"),
    q("cell_cache", "combo_key"),
    q("glow_records", "id"),
  ]);
  return { boxes, cachedCombos: combos, glow };
}
