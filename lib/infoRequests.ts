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

// `hotRequests()`는 2026-11-09에 지웠다. 읽는 쪽이 `/admin` 하나뿐이었고
// 그 화면이 피벗 전 프로젝트의 것이라 함께 사라졌다.
// 요청은 계속 쌓이므로 우선순위가 필요해지면 Supabase에서 직접 조회한다:
//   select row_axis, col_axis, requests from info_requests
//   where resolved = false order by requests desc;
