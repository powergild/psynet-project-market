// 스포츠조각 — 서버 전용.
//
// 셀 하나가 곧 조각이다: (조건 + 행 축 + 열 축).
//   "비 · 음바페 × 득점 기대값" = 비 올 때 음바페가 득점 관점에서 유리하다는 주장.
// 경기가 끝나면 그 주장이 채점되고, 적중과 경험치가 **조각 단위로** 누적된다.
// 축 id가 아니라 **이름 + 조건**으로 묶는다 — 축 id는 박스를 다시 만들 때마다 바뀌어서
// 성적을 누적할 식별자가 못 되기 때문이다.

import { supabase } from "@/lib/supabase";
import type { Match, MatchStat } from "@/lib/matches";
import { condParts } from "@/lib/axes";

/* ── 등급 ─────────────────────────────────────────────────
   레벨 숫자 대신 등급으로 읽는다. 격자 안에서 숫자가 또 하나 늘어나면
   승률과 섞여 읽히기 때문이다 — 등급은 한눈에 "이 조각이 얼마나 검증됐나"만 말한다.

   쌓인 양(exp)만으로는 오르지 않는다. 보정 적중률이 함께 받쳐줘야 한다 —
   많이 틀리면서 오래 버틴 조각이 전설이 되면 등급이 거짓말을 한다. */
export const TIERS = ["일반", "희귀", "영웅", "전설"] as const;
export type Tier = (typeof TIERS)[number];

const TIER_RULES: { tier: Tier; exp: number; trust: number }[] = [
  { tier: "전설", exp: 600, trust: 70 },
  { tier: "영웅", exp: 300, trust: 60 },
  { tier: "희귀", exp: 100, trust: 50 },
];

export function tierOf(exp: number, trust: number): Tier {
  for (const r of TIER_RULES) if (exp >= r.exp && trust >= r.trust) return r.tier;
  return "일반";
}

/** 다음 등급까지 얼마나 남았는가. 0~1. */
export function tierProgress(exp: number, trust: number): number {
  const cur = tierOf(exp, trust);
  const i = TIERS.indexOf(cur);
  if (i >= TIERS.length - 1) return 1;
  const next = TIER_RULES.find((r) => r.tier === TIERS[i + 1]);
  if (!next) return 1;
  return Math.max(0, Math.min(1, exp / next.exp));
}

export type PieceKey = { cond: string; row: string; col: string };

export type PieceStats = {
  declared: number;      // 선언 횟수
  scored: number;        // 채점된 횟수
  hits: number;
  rate: number | null;   // 원시 적중률 (표본이 작으면 믿을 게 못 된다)
  trust: number;         // 보정 적중률 — 등급·가격은 이걸 쓴다
  exp: number;
  tier: Tier;
  progress: number;      // 다음 등급까지 0~1
};

/**
 * 보정 적중률.
 * 표본 2~3개짜리 100%를 그대로 믿으면 가격이 거짓말을 한다 —
 * 사전확률 50%에 가상 표본 4개를 섞어, 실제로 맞춘 횟수가 쌓여야 올라가게 한다.
 */
export function trustRate(hits: number, scored: number): number {
  const PRIOR = 0.5, WEIGHT = 4;
  return (hits + PRIOR * WEIGHT) / (scored + WEIGHT);
}

/* ── 경험치 ───────────────────────────────────────────────
   기획서의 배수 구조를 그대로 가져온다.
     기본   출전 5 + 특성 기록 있음 10 + 그 기록에서 주체가 우세 10  → 최대 25
     배수   적중 ×2 · 날씨 일치 ×1.5 · 상황 일치 ×1.3
   최대 25 × 2 × 1.5 × 1.3 ≈ 98 — "완벽히 맞아떨어진 한 번이면 거의 1레벨"이 된다. */

export type ExpInput = {
  hit: boolean;
  cond: string;
  colAxis: string;
  rowAxis: string;
  match: Match;
  stats: MatchStat[];
};

const num = (s: string) => {
  const n = parseFloat(String(s).replace(/[^\d.-]/g, ""));
  return isFinite(n) ? n : null;
};

export function expFor(i: ExpInput): number {
  let base = 5;                                   // 출전

  const st = i.stats.find((s) => s.key === i.colAxis);
  if (st) {
    base += 10;                                   // 그 특성이 실제 기록으로 남았다
    const h = num(st.home), a = num(st.away);
    if (h !== null && a !== null) {
      // 주체가 어느 쪽인가. "원정팀"만 원정을 가리키고 나머지는 홈 관점으로 읽는다
      // (선수가 어느 팀인지는 아직 데이터에 없다 — 연동되면 여기만 고치면 된다).
      const subjectHome = i.rowAxis !== "원정팀";
      if ((subjectHome && h > a) || (!subjectHome && a > h)) base += 10;
    }
  }

  // 조건은 겹쳐 걸 수 있다 — 날씨와 상황이 동시에 맞으면 배수도 겹친다.
  const parts = condParts(i.cond);
  let mult = 1;
  if (i.hit) mult *= 2;
  if (parts.includes(i.match.weather)) mult *= 1.5;
  if (parts.some((p) => i.match.situations.includes(p))) mult *= 1.3;

  return Math.round(base * mult);
}

/* ── 집계 ─────────────────────────────────────────────── */

type Row = { scored: boolean; hit: boolean | null; exp: number };

function aggregate(rows: Row[]): PieceStats {
  const scoredRows = rows.filter((r) => r.scored);
  const hits = scoredRows.filter((r) => r.hit).length;
  const exp = rows.reduce((a, r) => a + (r.exp ?? 0), 0);
  const trust = Math.round(trustRate(hits, scoredRows.length) * 100);
  return {
    declared: rows.length,
    scored: scoredRows.length,
    hits,
    rate: scoredRows.length ? Math.round((hits / scoredRows.length) * 100) : null,
    trust,
    exp,
    tier: tierOf(exp, trust),
    progress: tierProgress(exp, trust),
  };
}

const EMPTY: PieceStats = {
  declared: 0, scored: 0, hits: 0, rate: null, trust: 50, exp: 0, tier: "일반", progress: 0,
};

/** 조각 하나의 누적 성적. 전 유저 공통 — 조각의 성적은 조각의 것이지 박스의 것이 아니다. */
export async function pieceStats(k: PieceKey): Promise<PieceStats> {
  const { data, error } = await supabase
    .from("glow_records")
    .select("scored,hit,exp")
    .eq("row_axis_name", k.row)
    .eq("col_axis_name", k.col)
    .eq("condition", k.cond);
  if (error || !data) return EMPTY;
  return aggregate(data as Row[]);
}

/** 여러 조각을 한 번에. 격자 전체의 레벨을 표시할 때 쓴다. */
export async function pieceStatsMany(keys: PieceKey[]): Promise<Map<string, PieceStats>> {
  const out = new Map<string, PieceStats>();
  if (!keys.length) return out;

  const conds = Array.from(new Set(keys.map((k) => k.cond)));
  const rows = Array.from(new Set(keys.map((k) => k.row)));
  const cols = Array.from(new Set(keys.map((k) => k.col)));

  const { data, error } = await supabase
    .from("glow_records")
    .select("row_axis_name,col_axis_name,condition,scored,hit,exp")
    .in("condition", conds)
    .in("row_axis_name", rows)
    .in("col_axis_name", cols);
  if (error || !data) return out;

  const bucket = new Map<string, Row[]>();
  for (const r of data as (Row & { row_axis_name: string; col_axis_name: string; condition: string })[]) {
    const id = pieceId({ cond: r.condition, row: r.row_axis_name, col: r.col_axis_name });
    if (!bucket.has(id)) bucket.set(id, []);
    bucket.get(id)!.push(r);
  }
  for (const [id, rs] of bucket) out.set(id, aggregate(rs));
  return out;
}

export function pieceId(k: PieceKey): string {
  return `${k.cond}|${k.row}|${k.col}`;
}

/* ── 계산식 (F-23) ────────────────────────────────────────
   조정한 가중치가 곧 그 사람의 자산이다. 적중률을 끌어올린 계산식이 비싸진다. */

export type Weights = Record<string, number>;

export async function saveFormula(
  owner: string, k: PieceKey, weights: Weights, baseValue: string
): Promise<void> {
  await supabase.from("piece_formulas").upsert(
    {
      owner, condition: k.cond, row_axis: k.row, col_axis: k.col,
      weights, base_value: baseValue, updated_at: new Date().toISOString(),
    },
    { onConflict: "owner,condition,row_axis,col_axis" }
  );
}

export async function loadFormula(owner: string, k: PieceKey): Promise<Weights | null> {
  const { data, error } = await supabase
    .from("piece_formulas")
    .select("weights")
    .eq("owner", owner).eq("condition", k.cond)
    .eq("row_axis", k.row).eq("col_axis", k.col)
    .maybeSingle();
  if (error || !data) return null;
  return (data as { weights: Weights }).weights;
}

/**
 * 조각 가격 (F-10 변동 가격).
 * 등급이 뼈대고 보정 적중률이 그 안에서 값을 가른다 —
 * 같은 희귀 등급이라도 더 잘 맞히는 조각이 비싸야 한다.
 */
const TIER_BASE: Record<Tier, number> = { "일반": 10, "희귀": 30, "영웅": 70, "전설": 150 };

export function priceOfPiece(s: PieceStats): number {
  const base = TIER_BASE[s.tier];
  return Math.max(5, Math.round((base * (0.6 + s.trust / 100)) / 5) * 5);
}
