import { supabase, type UserRow } from "@/lib/supabase";

export async function getAllUsers(): Promise<UserRow[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("last_login_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as UserRow[];
}

export type BoxStats = {
  boxes: number;
  cachedCombos: number;
  cacheHits: number;
  glowTotal: number;
  glowScored: number;
  glowHit: number;
  /** 테이블 미생성 등으로 집계 불가한 경우 */
  unavailable: boolean;
};

/**
 * 데이터 박스 운영 지표.
 * ⚠️ 테이블 존재 확인은 반드시 컬럼명을 명시해 select 할 것 —
 *    head+count 방식은 없는 테이블도 오류 없이 null을 돌려줘 오탐난다(2026-08 실측).
 */
export async function getBoxStats(): Promise<BoxStats> {
  const empty: BoxStats = {
    boxes: 0, cachedCombos: 0, cacheHits: 0,
    glowTotal: 0, glowScored: 0, glowHit: 0, unavailable: true,
  };

  const boxes = await supabase.from("boxes").select("id");
  if (boxes.error) return empty;

  const cache = await supabase.from("cell_cache").select("combo_key,hits");
  const glow = await supabase.from("glow_records").select("id,scored,hit");

  const cacheRows = (cache.data ?? []) as { combo_key: string; hits: number }[];
  const glowRows = (glow.data ?? []) as { id: number; scored: boolean; hit: boolean | null }[];

  return {
    boxes: (boxes.data ?? []).length,
    cachedCombos: cacheRows.length,
    cacheHits: cacheRows.reduce((s, r) => s + (r.hits ?? 0), 0),
    glowTotal: glowRows.length,
    glowScored: glowRows.filter((g) => g.scored).length,
    glowHit: glowRows.filter((g) => g.hit === true).length,
    unavailable: false,
  };
}
