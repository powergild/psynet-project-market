// AI 셀 엔진 — 서버 전용.
//
// 셀 = 행(기준) × 열(지표)에 계산식을 적용한 결과이고, 그 결과는 **승률(%)** 이다.
//   "홈팀 × 득점 기대값" = 득점 기대값 관점에서 봤을 때 홈팀이 이길 확률.
// 지표마다 단위가 달라지면 격자를 가로세로로 읽을 수 없다. 단위는 하나여야 한다.
//
// 설계 원칙(기존 서비스에서 확립한 하이브리드 패턴과 동일):
//   캐시 우선 → 없으면 AI(Haiku) 배치 산출 → 키/크레딧 없거나 실패하면 결정적 폴백.
// AI가 죽어도 격자는 항상 채워진다. 서비스가 멈추지 않는 것이 우선.

import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";

export type AxisRef = {
  id: string;
  name: string;
  ctx?: string | null;   // 대상 바인딩 (예: 프랑스·모로코)
  src?: string | null;   // 축 출처 (타인 계산식이면 @핸들) — F-14 축 스택
};

export type CellRequest = { row: AxisRef; col: AxisRef };
export type CellResult = { rowId: string; colId: string; value: string; from: "cache" | "ai" | "fallback" };

export type MatchContext = {
  sport: string;
  league: string;
  home: string;
  away: string;
  status: string;
} | null;

/** 전역 조합 캐시 키. 박스가 달라도 같은 조합이면 재사용(F-03). wr2 = 승률 체계. */
export function comboKey(row: AxisRef, col: AxisRef): string {
  const r = `${row.name}|${row.ctx ?? ""}|${row.src ?? ""}`;
  const c = `${col.name}|${col.ctx ?? ""}|${col.src ?? ""}`;
  return `wr2:${r} :: ${c}`;
}

// ── 결정적 폴백 ────────────────────────────────────────────
// 같은 조합이면 항상 같은 값. AI 없이도 격자가 일관되게 보인다.
function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 승률 폴백 — 28.0% ~ 76.0%. 극단값은 믿기 어려우므로 만들지 않는다. */
export function fallbackValue(row: AxisRef, col: AxisRef): string {
  const h = hash(comboKey(row, col));
  return (28 + (h % 481) / 10).toFixed(1) + "%";
}

/** 승률 문자열 → 숫자. 못 읽으면 null. */
export function pct(v: string | undefined | null): number | null {
  if (!v || v === "—") return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

// ── 캐시 ──────────────────────────────────────────────────
async function readCache(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  const { data, error } = await supabase
    .from("cell_cache")
    .select("combo_key,value")
    .in("combo_key", keys);
  if (error || !data) return out;
  for (const r of data as { combo_key: string; value: string }[]) out.set(r.combo_key, r.value);
  return out;
}

async function writeCache(rows: { combo_key: string; value: string }[]): Promise<void> {
  if (!rows.length) return;
  await supabase.from("cell_cache").upsert(rows, { onConflict: "combo_key" });
}

// ── AI ────────────────────────────────────────────────────
let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  client = key ? new Anthropic({ apiKey: key }) : null;
  return client;
}

const CELL_SCHEMA = {
  type: "object",
  properties: {
    cells: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, winRate: { type: "number" } },
        required: ["i", "winRate"],
        additionalProperties: false,
      },
    },
  },
  required: ["cells"],
  additionalProperties: false,
} as const;

const SYSTEM = `너는 스포츠 예측 엔진이다. "기준 × 지표" 교차마다 **승률 하나**를 산출한다.

읽는 법: 각 항목은 "기준 × 지표"다.
- 기준 = 누구를/어떤 조건을 보는가 (홈팀, 강수량, 주전 공격수, 휴식일 수 …)
- 지표 = 어떤 관점으로 재는가 (득점 기대값, 점유율, 역전 빈도 …)
- 산출값 = **그 지표 관점에서 봤을 때 그 기준이 유리할 확률(승률)**
  예: "홈팀 × 득점 기대값" → 득점 기대값만 놓고 보면 홈팀이 이길 확률
  예: "강수량 × 유효슈팅" → 비가 오는 조건에서 유효슈팅 관점의 승률

가장 중요한 원칙: 너는 **추정치를 만들어내는 엔진**이다. 실제 DB를 조회하는 것이 아니라,
스포츠 도메인 지식에 근거해 그럴듯한 승률을 산출한다. "데이터가 없다"는 이유로 비우지 마라.

출력 규칙(엄격히 지킬 것):
- winRate는 **0~100 사이의 숫자**다. 단위 기호 없이 숫자만. (예: 58.4)
- 현실적 범위를 지켜라. 보통 **30~72** 안에 들어온다. 5나 97 같은 값은 금지.
- 기준이 유리하면 50보다 크고, 불리하면 50보다 작다. 전부 50 근처로 몰지 마라 —
  조합마다 유불리가 다르므로 값도 달라야 한다.
- 입력의 각 항목 i를 그대로 돌려주고, cells 배열 길이는 입력 길이와 같아야 한다.`;

/** 모델 응답 정규화. 승률 범위를 벗어나면 null → 호출부가 폴백을 쓴다. */
function coerce(n: number): string | null {
  if (!isFinite(n)) return null;
  if (n > 0 && n <= 1) n = n * 100;            // 0.58로 준 경우
  if (n < 5 || n > 95) return null;
  return n.toFixed(1) + "%";
}

async function aiCompute(reqs: CellRequest[], ctx: MatchContext): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const c = getClient();
  if (!c || !reqs.length) return out;

  const ctxLine = ctx
    ? `경기 맥락: ${ctx.sport} ${ctx.league} / ${ctx.home} vs ${ctx.away} (${ctx.status})`
    : "경기 맥락: 없음 (일반 지표)";

  const list = reqs
    .map((r, i) => {
      const rn = r.row.name + (r.row.ctx ? ` [${r.row.ctx}]` : "");
      const cn = r.col.name + (r.col.ctx ? ` [${r.col.ctx}]` : "");
      return `${i}. ${rn} × ${cn}`;
    })
    .join("\n");

  try {
    const res = await c.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { format: { type: "json_schema", schema: CELL_SCHEMA } },
      messages: [{ role: "user", content: `${ctxLine}\n\n교차 목록:\n${list}` }],
    });
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return out;
    const parsed = JSON.parse(text.text) as { cells: { i: number; winRate: number }[] };
    for (const cell of parsed.cells ?? []) {
      if (typeof cell.i !== "number" || typeof cell.winRate !== "number") continue;
      const v = coerce(cell.winRate);
      if (v) out.set(cell.i, v);
    }
  } catch {
    /* 조용히 폴백 */
  }
  return out;
}

/**
 * 셀 배치 산출. 캐시 히트는 즉시, 나머지만 AI로 묶어 호출한다.
 * 어떤 경우에도 입력 개수만큼 결과를 돌려준다.
 */
export async function computeCells(reqs: CellRequest[], ctx: MatchContext): Promise<CellResult[]> {
  if (!reqs.length) return [];

  const keys = reqs.map((r) => comboKey(r.row, r.col));
  const cached = await readCache(Array.from(new Set(keys)));

  const missIdx: number[] = [];
  reqs.forEach((_, i) => { if (!cached.has(keys[i])) missIdx.push(i); });

  const aiVals = missIdx.length ? await aiCompute(missIdx.map((i) => reqs[i]), ctx) : new Map<number, string>();

  const fresh: { combo_key: string; value: string }[] = [];
  const results: CellResult[] = reqs.map((r, i) => {
    const hit = cached.get(keys[i]);
    if (hit !== undefined) return { rowId: r.row.id, colId: r.col.id, value: hit, from: "cache" };

    const pos = missIdx.indexOf(i);
    const ai = pos >= 0 ? aiVals.get(pos) : undefined;
    const value = ai ?? fallbackValue(r.row, r.col);
    fresh.push({ combo_key: keys[i], value });
    return { rowId: r.row.id, colId: r.col.id, value, from: ai ? "ai" : "fallback" };
  });

  const dedup = new Map(fresh.map((f) => [f.combo_key, f]));
  await writeCache(Array.from(dedup.values()));

  return results;
}

/* ── F-05 경기 맥락 발광 ───────────────────────────────────
   경기 맥락을 읽고 "지금 이 경기에서 유효한 셀"을 고른다.
   발광 셀은 곧 예측 선언이므로(기획서 1-5 단계 9) 고른 즉시 기록으로 남긴다. */

export type GlowCandidate = { rowId: string; colId: string; row: string; col: string; value: string };
export type GlowPick = { rowId: string; colId: string; why: string };
export type GlowResult = { cells: GlowPick[]; line: string };

const GLOW_SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { i: { type: "integer" }, why: { type: "string" } },
        required: ["i", "why"],
        additionalProperties: false,
      },
    },
    line: { type: "string" },
  },
  required: ["picks", "line"],
  additionalProperties: false,
} as const;

const GLOW_SYSTEM = `너는 경기 맥락 분석기다. 유저가 만든 격자의 셀 중에서
**지금 이 경기에 특히 유효한 셀**만 골라낸다.

- 셀은 "기준 × 지표"의 승률이다.
- 고르는 기준: 이 경기의 종목·팀·현재 상황(점수, 진행 단계)에 비춰
  그 조합이 실제로 결과를 설명하는가. 승률이 50에서 멀수록 주장이 강하다.
- **1~3개만** 골라라. 많이 고르면 신호가 아니라 소음이 된다.
- why는 그 셀이 왜 지금 유효한지 한 문장(20자 내외, 명사형 종결).
  예: "후반 수비 붕괴 구간과 맞아떨어짐"
- line은 격자 전체에 대한 요약 한 문장(25자 내외).
- 맞는 셀이 하나도 없으면 picks를 빈 배열로 두어라. 억지로 고르지 마라.`;

/** 폴백 발광 — AI가 없어도 경기마다 같은 셀이 일관되게 빛난다. */
function fallbackGlow(cands: GlowCandidate[], ctx: MatchContext): GlowResult {
  const seed = hash((ctx?.home ?? "") + (ctx?.away ?? "") + cands.map((c) => c.rowId + c.colId).join());
  // 승률이 50에서 가장 먼 셀 = 주장이 가장 강한 셀
  const ranked = [...cands].sort(
    (a, b) => Math.abs((pct(b.value) ?? 50) - 50) - Math.abs((pct(a.value) ?? 50) - 50)
  );
  const n = Math.min(ranked.length, 1 + (seed % 3));
  const LINES = [
    "이 조합이 최근 흐름을 설명함",
    "후반 수비 붕괴 구간과 맞아떨어짐",
    "홈 우위가 이 셀에서만 유지됨",
    "교체 타이밍이 이 지표를 흔듦",
  ];
  return {
    cells: ranked.slice(0, n).map((c) => ({
      rowId: c.rowId,
      colId: c.colId,
      why: `${c.col} 관점에서 ${c.row}의 우위가 뚜렷함`,
    })),
    line: LINES[seed % LINES.length],
  };
}

export async function analyzeGlow(cands: GlowCandidate[], ctx: MatchContext): Promise<GlowResult> {
  if (!cands.length) return { cells: [], line: "" };
  const c = getClient();
  if (!c || !ctx) return fallbackGlow(cands, ctx);

  const list = cands.map((x, i) => `${i}. ${x.row} × ${x.col} = ${x.value}`).join("\n");
  try {
    const res = await c.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: GLOW_SYSTEM,
      output_config: { format: { type: "json_schema", schema: GLOW_SCHEMA } },
      messages: [{
        role: "user",
        content: `경기: ${ctx.sport} ${ctx.league} / ${ctx.home} vs ${ctx.away} (${ctx.status})\n\n격자:\n${list}`,
      }],
    });
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return fallbackGlow(cands, ctx);
    const parsed = JSON.parse(text.text) as { picks: { i: number; why: string }[]; line: string };
    const cells = (parsed.picks ?? [])
      .filter((p) => cands[p.i])
      .slice(0, 3)
      .map((p) => ({ rowId: cands[p.i].rowId, colId: cands[p.i].colId, why: p.why }));
    return { cells, line: parsed.line || fallbackGlow(cands, ctx).line };
  } catch {
    return fallbackGlow(cands, ctx);
  }
}
