// AI 셀 엔진 — 서버 전용.
// 축 × 축 교차 값을 산출한다. 프로토타입의 mockVal() 목업을 대체하는 실제 계산 레이어.
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

/** 전역 조합 캐시 키. 박스가 달라도 같은 조합이면 재사용(F-03). */
export function comboKey(row: AxisRef, col: AxisRef): string {
  const r = `${row.name}|${row.ctx ?? ""}`;
  const c = `${col.name}|${col.ctx ?? ""}`;
  return `${r} :: ${c}`;
}

// ── 결정적 폴백 ────────────────────────────────────────────
// 같은 조합이면 항상 같은 값. AI 없이도 격자가 일관되게 보인다.
function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}
export function fallbackValue(row: AxisRef, col: AxisRef): string {
  const h = hash(comboKey(row, col));
  const m = h % 100;
  if (m < 8) return "—";
  if (m < 62) return ((h % 780) / 10 + 2.1).toFixed(1) + "%";
  if (m < 85) return ((h % 420) / 100 + 0.31).toFixed(2);
  return String((h % 90) + 7);
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

// ── AI 산출 ───────────────────────────────────────────────
let client: Anthropic | null | undefined;
function getClient(): Anthropic | null {
  if (client !== undefined) return client;
  const key = process.env.ANTHROPIC_API_KEY;
  client = key ? new Anthropic({ apiKey: key }) : null;
  return client;
}

const SCHEMA = {
  type: "object",
  properties: {
    cells: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          value: { type: "string" },
        },
        required: ["i", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["cells"],
  additionalProperties: false,
} as const;

const SYSTEM = `너는 스포츠 데이터 분석 엔진이다. "행 축 × 열 축" 교차에 대해 하나의 수치를 산출한다.

출력 형식 규칙(엄격히 지킬 것):
- 비율·확률 → "62.4%" 처럼 소수 1자리 + %
- 기대값·지수 → "1.73" 처럼 소수 2자리
- 횟수·개수 → "23" 처럼 정수
- 두 축이 논리적으로 교차 불가하거나 산출 근거가 없으면 → "—" (em dash 한 글자)

판단 기준:
- 행 축이 "주체"(팀·선수·환경·상황), 열 축이 "측정 대상"(기대값·기록)인 경우가 많다
- 종목이 다른 축끼리의 교차(예: 안타 × 유효슈팅)는 "—"
- 대상(ctx)이 붙어 있으면 그 경기 맥락에서의 값으로 본다
- 값은 그럴듯한 범위여야 한다. 점유율 95%, 기대득점 9.9 같은 비현실적 값 금지

입력의 각 항목 i를 그대로 돌려주고, cells 배열 길이는 입력 길이와 같아야 한다.`;

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
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: `${ctxLine}\n\n교차 목록:\n${list}` }],
    });
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return out;
    const parsed = JSON.parse(text.text) as { cells: { i: number; value: string }[] };
    for (const cell of parsed.cells ?? []) {
      if (typeof cell.i === "number" && typeof cell.value === "string" && cell.value.trim()) {
        out.set(cell.i, cell.value.trim().slice(0, 12));
      }
    }
  } catch {
    /* 조용히 폴백 */
  }
  return out;
}

/**
 * 셀 배치 산출. 캐시 히트는 즉시, 나머지만 AI로 묶어 호출한다(행/열 단위 배치).
 * 어떤 경우에도 입력 개수만큼 결과를 돌려준다.
 */
export async function computeCells(reqs: CellRequest[], ctx: MatchContext): Promise<CellResult[]> {
  if (!reqs.length) return [];

  const keys = reqs.map((r) => comboKey(r.row, r.col));
  const cached = await readCache(Array.from(new Set(keys)));

  const missIdx: number[] = [];
  reqs.forEach((_, i) => {
    if (!cached.has(keys[i])) missIdx.push(i);
  });

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

  // 중복 키 제거 후 캐시 적재
  const dedup = new Map(fresh.map((f) => [f.combo_key, f]));
  await writeCache(Array.from(dedup.values()));

  return results;
}
