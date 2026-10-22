// 캐시 예열 — 서버 전용.
//
// 조합 캐시가 비어 있으면 유저가 격자를 열 때마다 AI를 때린다. 그건 느리고 비싸다.
// 표준 축(행 기준 × 열 지표)의 조합은 **유저가 오기 전에 미리 다 계산해 둔다.**
// 그러면 프로덕션은 캐시를 읽기만 하고, AI는 유저가 새로 만든 조합에만 돈다.
//
// 예열은 로컬에서 구독(Claude Code CLI)으로 돌린다 — /api/warm 참고.

import { ROW_AXES, COL_AXES, catalogFor, type Sport } from "@/lib/axes";
import type { CellRequest } from "@/lib/cellEngine";
import { getMatchSource, type Match } from "@/lib/matches";

export type WarmScope = "global" | "match";

/** 축 이름을 그대로 id로 쓴다 — 예열은 화면에 붙지 않으므로 안정적인 이름이 낫다. */
const ref = (name: string, ctx: string | null) => ({ id: name, name, ctx, src: null });

/**
 * 메인(경기 무관) 박스에서 나올 수 있는 모든 조합.
 * 메인은 종목을 가리지 않으므로 전 지표를 다 돈다.
 */
export function globalCombos(): CellRequest[] {
  const out: CellRequest[] = [];
  for (const r of ROW_AXES) {
    for (const c of COL_AXES) out.push({ row: ref(r.name, null), col: ref(c.name, null) });
  }
  return out;
}

/**
 * 한 경기의 박스에서 나올 수 있는 조합.
 * 경기 안에서는 그 종목 지표만 보이고, 선수 축이 행에 추가된다.
 * ctx(대상)가 캐시 키에 들어가므로 경기마다 따로 쌓인다 — 같은 "홈팀 × 득점 기대값"이라도
 * 경기가 다르면 다른 값이어야 하기 때문이다.
 */
export function matchCombos(m: Match): CellRequest[] {
  const ctx = `${m.home}·${m.away}`;
  const sport = m.sport as Sport;
  const rows = catalogFor("row", m.players, sport).flatMap((g) => g.items.map((i) => i.name));
  const cols = catalogFor("col", undefined, sport).flatMap((g) => g.items.map((i) => i.name));

  const out: CellRequest[] = [];
  for (const r of rows) {
    for (const c of cols) out.push({ row: ref(r, ctx), col: ref(c, ctx) });
  }
  return out;
}

/** 예열 대상 전체. scope=match면 그 경기 하나, matchId가 없으면 전 경기. */
export async function warmTargets(scope: WarmScope, matchId?: string): Promise<CellRequest[]> {
  if (scope === "global") return globalCombos();

  const src = getMatchSource();
  if (matchId) {
    const m = await src.getMatch(matchId);
    return m ? matchCombos(m) : [];
  }
  const all = await src.listMatches();
  return all.flatMap(matchCombos);
}
