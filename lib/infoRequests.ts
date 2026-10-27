// 정보 요청 — 서버 전용.
//
// 모르는 대상의 칸에서 유저가 요청을 남긴다. 같은 칸이 여러 번 요청되면 누적된다.
// "어떤 선수·팀의 데이터를 먼저 붙여야 하는가"를 추측하지 않고 유저에게서 받는다.

import { supabase } from "@/lib/supabase";

export type InfoRequestKey = {
  cond: string; row: string; col: string; matchId: string | null;
};

export async function logInfoRequest(k: InfoRequestKey): Promise<void> {
  const now = new Date().toISOString();
  const { data } = await supabase
    .from("info_requests")
    .select("id,requests")
    .eq("condition", k.cond).eq("row_axis", k.row).eq("col_axis", k.col)
    .maybeSingle();

  if (data) {
    await supabase.from("info_requests")
      .update({ requests: (data as { requests: number }).requests + 1, last_at: now })
      .eq("id", (data as { id: number }).id);
    return;
  }
  await supabase.from("info_requests").insert({
    condition: k.cond, row_axis: k.row, col_axis: k.col,
    match_id: k.matchId, first_at: now, last_at: now,
  });
}

export type HotRequest = { row: string; col: string; cond: string; requests: number };

/** 많이 요청된 것부터. 데이터 연동 우선순위로 쓴다. */
export async function hotRequests(limit = 30): Promise<HotRequest[]> {
  const { data, error } = await supabase
    .from("info_requests")
    .select("row_axis,col_axis,condition,requests")
    .eq("resolved", false)
    .order("requests", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    row: String(r.row_axis), col: String(r.col_axis),
    cond: String(r.condition ?? ""), requests: Number(r.requests),
  }));
}
