// AI 셀 엔진 — 서버 전용.
//
// 셀 = 행(기준) × 열(지표)에 계산식을 적용한 결과이고, 그 결과는 **승률(%)** 이다.
//   "홈팀 × 득점 기대값" = 득점 기대값 관점에서 봤을 때 홈팀이 이길 확률.
// 지표마다 단위가 달라지면 격자를 가로세로로 읽을 수 없다. 단위는 하나여야 한다.
//
// 설계 원칙(기존 서비스에서 확립한 하이브리드 패턴과 동일):
//   캐시 우선 → 없으면 AI(Haiku) 배치 산출 → 실패하면 그 셀은 "—".
// 산출하지 못한 칸을 그럴듯한 숫자로 메우지 않는다. 유저는 이 값으로 예측 판단을 하므로,
// 계산된 값과 지어낸 값이 구분되지 않는 순간 격자 전체를 믿을 수 없게 된다.

import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "@/lib/supabase";
import { NO_VALUE, UNKNOWN, condParts } from "@/lib/axes";
import { deriveConditioned, applyObserved } from "@/lib/estimator";
import { pieceStatsMany, pieceId } from "@/lib/pieces";
import { promptLineOf } from "@/lib/sentence";
import { FORTUNE_COLS, computeFortune } from "@/lib/fortune";
import { birthOf } from "@/lib/people";
// cliEngine은 node:child_process를 쓴다. 정적 import하면 Node 런타임이 아닌 호스팅으로
// 옮길 수 없고 번들도 무거워진다. 켜져 있을 때만 동적으로 불러온다.
const cliOn = () => process.env.CLAUDE_CLI === "1";

export type AxisRef = {
  id: string;
  name: string;
  ctx?: string | null;   // 대상 바인딩 (예: 프랑스·모로코)
  src?: string | null;   // 축 출처 (타인 계산식이면 @핸들) — F-14 축 스택
};

export type CellRequest = { row: AxisRef; col: AxisRef };

/** 박스 전체에 걸린 조건(스포츠조각의 "조건"). 빈 문자열 = 조건 없음. */
export type Condition = string;
export type CellResult = {
  rowId: string; colId: string; value: string;
  // unknown = 모델이 그 대상을 모른다고 답한 칸. failed(산출 실패)와 다르다 —
  // 재시도해도 안 나오므로, 재시도 배너가 아니라 "정보 요청" 경로로 보낸다.
  from: "cache" | "derived" | "ai" | "unknown" | "failed";
};

export type MatchContext = {
  sport: string;
  league: string;
  home: string;
  away: string;
  status: string;
  startsAt?: string;    // 운세는 날짜로 계산한다
  weather?: string;     // 날씨 궁합의 입력
} | null;

/** 전역 조합 캐시 키. 박스가 달라도 같은 조합이면 재사용(F-03). wr2 = 승률 체계. */
export function comboKey(row: AxisRef, col: AxisRef, cond: Condition = "", day = ""): string {
  const r = `${row.name}|${row.ctx ?? ""}|${row.src ?? ""}`;
  const c = `${col.name}|${col.ctx ?? ""}|${col.src ?? ""}`;
  // 날짜는 재미 열에만 붙는다. 운세는 날마다 달라야 하므로 날짜가 키의 일부다.
  const d = day ? `#${day}` : "";
  // 조건이 없으면 접두사를 붙이지 않는다 — 이미 예열해 둔 2,500여 건을 그대로 쓰기 위해서다.
  return cond ? `wr2${d}@${cond}:${r} :: ${c}` : `wr2${d}:${r} :: ${c}`;
}

function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** 승률 문자열 → 숫자. 못 읽으면 null. */
export function pct(v: string | undefined | null): number | null {
  if (!v || v === "—") return null;
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
}

// ── 캐시 ──────────────────────────────────────────────────
// PostgREST는 .in()을 URL 쿼리로 실어 보낸다. 그런데 한글은 퍼센트 인코딩되면 한 글자가 9바이트다.
// 조합 키에 대상(ctx)까지 들어가므로 몇 십 개만 묶어도 URL이 터져 요청이 통째로 실패한다.
// 그걸 조용히 삼키면 **캐시가 비어 보여** 전 셀이 AI로 재계산된다 — 예열해 둔 게 무의미해진다.
// 그래서 **개수가 아니라 인코딩 길이로** 쌓는다. 팀이름이 긴 경기에서 실제로 터졌다.
const URL_BUDGET = 6000;        // 실측 한계는 약 8KB(8,086B 성공 / 8,822B 실패) — 여유를 둔다
const MAX_KEYS = 40;

function chunkKeys(keys: string[]): string[][] {
  const chunks: string[][] = [];
  let cur: string[] = [];
  let size = 0;
  for (const k of keys) {
    const cost = encodeURIComponent(k).length + 3;   // 구분자·따옴표 여유
    if (cur.length && (size + cost > URL_BUDGET || cur.length >= MAX_KEYS)) {
      chunks.push(cur); cur = []; size = 0;
    }
    cur.push(k); size += cost;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

async function readCache(keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;

  const results = await Promise.all(
    chunkKeys(keys).map((c) =>
      supabase.from("cell_cache").select("combo_key,value").in("combo_key", c)
    )
  );
  for (const { data, error } of results) {
    if (error) { console.error("[cache] 읽기 실패", error.message); continue; }
    for (const r of (data ?? []) as { combo_key: string; value: string }[]) {
      out.set(r.combo_key, r.value);
    }
  }
  return out;
}

async function writeCache(rows: { combo_key: string; value: string }[]): Promise<void> {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase
      .from("cell_cache")
      .upsert(rows.slice(i, i + 100), { onConflict: "combo_key" });
    if (error) console.error("[cache] 쓰기 실패", error.message);
  }
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
        properties: {
          i: { type: "integer" },
          winRate: { type: "number" },
          known: { type: "boolean" },
        },
        required: ["i", "winRate", "known"],
        additionalProperties: false,
      },
    },
  },
  required: ["cells"],
  additionalProperties: false,
} as const;

const CELL_EXAMPLE = `{"cells":[{"i":0,"winRate":58.4},{"i":1,"winRate":41.2}]}`;

const SYSTEM = `너는 스포츠 예측 엔진이다. **질문 문장마다 확률 하나**를 산출한다.

각 항목은 완성된 질문이다. 그 문장이 묻는 것에 그대로 답하면 된다.
문장 속 대상(팀·선수)을 **실제로 알지 못하면 known=false로 답하라.** 모르는 대상에
그럴듯한 숫자를 붙이는 것이 가장 나쁘다 — 지어낸 값과 아는 값이 섞이면 격자 전체를
믿을 수 없게 된다. 모를 때는 winRate에 50을 넣고 known=false로 둬라.
**여러 대상에 같은 값을 복사해 넣지 마라.** 그건 모른다는 뜻이고, 그러면 known=false다.
  "비일 때, 음바페가 득점에서 앞설 확률"           → 58.4
  "최근 5경기 폼만 놓고 보면 홈팀이 ~할 확률"      → 54.0
  "모로코가 파울을 덜 범할 확률"                   → 44.0

문장은 모두 **높을수록 그 주체에게 유리**하도록 쓰여 있다. 파울·실책처럼 많을수록
불리한 것은 "덜 범할"로 뒤집혀 있으니 문장 그대로 읽어라.

가장 중요한 원칙: 너는 **추정치를 만들어내는 엔진**이다. 실제 DB를 조회하는 것이 아니라,
스포츠 도메인 지식에 근거해 그럴듯한 승률을 산출한다. "데이터가 없다"는 이유로 비우지 마라.

출력 규칙(엄격히 지킬 것):
- winRate는 **0~100 사이의 숫자**다. 단위 기호 없이 숫자만. (예: 58.4)
- 현실적 범위를 지켜라. 보통 **30~72** 안에 들어온다. 5나 97 같은 값은 금지.
- **50 근처로 몰지 마라.** 45~55는 "모르겠다"는 뜻이고 그 답은 쓸모가 없다.
  문장마다 유불리가 분명히 다르므로 값도 분명히 갈려야 한다. 아는 만큼 밀어라.
- 주체가 그 종목의 강팀·주전이면 올리고 약팀·백업이면 내려라. 문장에 담긴
  조건(날씨·상황)이 그 주체에게 유리한지 불리한지도 반드시 반영하라.
- 입력의 각 항목 i를 그대로 돌려주고, cells 배열 길이는 입력 길이와 같아야 한다.`;

/** 모델 응답 정규화. 승률 범위를 벗어나면 null → 호출부가 폴백을 쓴다. */
function coerce(n: number): string | null {
  if (!isFinite(n)) return null;
  if (n > 0 && n <= 1) n = n * 100;            // 0.58로 준 경우
  if (n < 5 || n > 95) return null;
  return n.toFixed(1) + "%";
}

/**
 * 모델에게 JSON 하나를 받는다. 백엔드는 CLI(구독) 우선, 없으면 SDK(API 키).
 * 둘 다 없으면 null — 호출부가 "—"로 처리한다.
 */
async function askJson(
  system: string, user: string, schema: Record<string, unknown>, example: string
): Promise<string | null> {
  if (cliOn()) {
    // CLI엔 json_schema 강제가 없다 — 형식을 프롬프트로 못박아야 제목·설명을 붙여 낸다.
    const { cliAskJson } = await import("@/lib/cliEngine");
    return cliAskJson(`${system}\n\n[출력 형식 — 반드시 지킬 것]\nJSON 객체 **하나만** 출력한다. 코드블록·제목·설명·머리말 전부 금지.\n첫 글자는 {, 마지막 글자는 } 여야 한다.\n예시: ${example}`, user);
  }

  const c = getClient();
  if (!c) return null;
  try {
    const res = await c.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      system,
      output_config: { format: { type: "json_schema", schema } },
      messages: [{ role: "user", content: user }],
    });
    const text = res.content.find((b) => b.type === "text");
    return text && text.type === "text" ? text.text : null;
  } catch {
    return null;
  }
}

/** 산출 백엔드가 하나도 없으면 시도하지 않는다. */
export function aiAvailable(): boolean {
  return cliOn() || getClient() !== null;
}

async function aiCompute(
  reqs: CellRequest[], ctx: MatchContext, cond: Condition = ""
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!reqs.length || !aiAvailable()) return out;

  const ctxLine = ctx
    ? `경기 맥락: ${ctx.sport} ${ctx.league} / ${ctx.home} vs ${ctx.away} (${ctx.status})`
    : "경기 맥락: 없음 (일반 지표)";

  // 문장이 곧 질문이다 — 축 이름만 던지면 모델이 무엇을 재는지 모른 채 50 근처로 답한다.
  const list = reqs
    .map((r, i) =>
      promptLineOf(i, { cond, row: r.row.name, col: r.col.name, scope: r.row.ctx ?? null })
    )
    .join("\n");

  const raw = await askJson(SYSTEM, `${ctxLine}\n\n질문:\n${list}`, CELL_SCHEMA, CELL_EXAMPLE);
  if (!raw) return out;
  try {
    const parsed = JSON.parse(raw) as { cells: { i: number; winRate: number; known?: boolean }[] };
    const got: { i: number; v: string }[] = [];
    for (const cell of parsed.cells ?? []) {
      if (typeof cell.i !== "number" || typeof cell.winRate !== "number") continue;
      if (cell.known === false) { out.set(cell.i, UNKNOWN); continue; }
      const v = coerce(cell.winRate);
      if (v) got.push({ i: cell.i, v });
    }

    for (const g of got) out.set(g.i, g.v);
  } catch {
    /* 형식이 깨졌으면 산출 실패로 다룬다 */
  }
  return out;
}

/**
 * 셀 배치 산출. 캐시 히트는 즉시, 나머지만 AI로 묶어 호출한다.
 * 어떤 경우에도 입력 개수만큼 결과를 돌려준다.
 */
export async function computeCells(
  reqs: CellRequest[], ctx: MatchContext, cond: Condition = ""
): Promise<CellResult[]> {
  if (!reqs.length) return [];

  // 재미 열은 날짜가 키에 들어간다 — 오늘 값은 캐시하되 내일은 새로 뽑는다.
  const today = new Date().toISOString().slice(0, 10);
  const dayOf = (i: number) => (FORTUNE_COLS.has(reqs[i].col.name) ? today : "");

  const keys = reqs.map((r, i) => comboKey(r.row, r.col, cond, dayOf(i)));

  /* 재미 지표(운세·궁합·징크스)는 **규칙으로 계산한다.** AI에게 물으면 매번 다른 숫자를
     지어낼 뿐이고 그건 재미도 데이터도 아니다. 생년월일이 없으면 계산할 수 없으므로
     "—"가 되고 데이터 요청으로 간다 — 지어내지 않는다는 원칙은 여기에도 적용된다. */
  const fortune = new Map<number, string>();
  if (ctx) {
    const fctx = {
      at: new Date(ctx.startsAt ?? Date.now()),
      weather: ctx.weather ?? "",
      opponent: ctx.away ?? "",
    };
    reqs.forEach((r, i) => {
      if (!FORTUNE_COLS.has(r.col.name)) return;
      const birth = birthOf(r.row.name);
      const f = birth && computeFortune(r.col.name, birth, fctx);
      if (f) fortune.set(i, f);     // 생년월일이 없으면 AI가 채운다(날짜별로 캐시된다)
    });
  } else {
    const at = new Date();
    reqs.forEach((r, i) => {
      if (!FORTUNE_COLS.has(r.col.name)) return;
      const birth = birthOf(r.row.name);
      const f = birth && computeFortune(r.col.name, birth, { at, weather: "맑음", opponent: "" });
      if (f) fortune.set(i, f);
    });
  }


  // 조건이 걸렸으면 조건 없는 기준값도 함께 읽는다 — 그걸로 유도되면 AI를 부르지 않는다.
  const parts = condParts(cond);
  const baseKeys = parts.length ? reqs.map((r, i) => comboKey(r.row, r.col, "", dayOf(i))) : [];
  const cached = await readCache(Array.from(new Set([...keys, ...baseKeys])));

  // 엔진이 유도할 수 있는 칸은 AI 대상에서 뺀다.
  const derived = new Map<number, string>();
  if (parts.length) {
    reqs.forEach((_, i) => {
      if (cached.has(keys[i])) return;
      const base = cached.get(baseKeys[i]);
      if (!base) return;
      const d = deriveConditioned(base, parts);
      if (d) derived.set(i, d.value);
    });
  }

  const missIdx: number[] = [];
  reqs.forEach((_, i) => {
    if (!cached.has(keys[i]) && !derived.has(i) && !fortune.has(i)) missIdx.push(i);
  });

  const aiVals = missIdx.length
    ? await aiCompute(missIdx.map((i) => reqs[i]), ctx, cond)
    : new Map<number, string>();

  const fresh: { combo_key: string; value: string }[] = [];
  const results: CellResult[] = reqs.map((r, i) => {
    // 규칙으로 계산되는 칸은 캐시보다 먼저다 — 계산이 공짜라 캐시할 이유가 없다.
    const f = fortune.get(i);
    if (f !== undefined) return { rowId: r.row.id, colId: r.col.id, value: f, from: "derived" };

    const hit = cached.get(keys[i]);
    if (hit !== undefined) return { rowId: r.row.id, colId: r.col.id, value: hit, from: "cache" };

    const d = derived.get(i);
    if (d !== undefined) {
      fresh.push({ combo_key: keys[i], value: d });   // 유도값도 캐시한다 — 재현 가능한 값이다
      return { rowId: r.row.id, colId: r.col.id, value: d, from: "derived" };
    }

    const pos = missIdx.indexOf(i);
    const ai = pos >= 0 ? aiVals.get(pos) : undefined;
    if (!ai) return { rowId: r.row.id, colId: r.col.id, value: NO_VALUE, from: "failed" };
    if (ai === UNKNOWN) {
      // 모른다는 답도 캐시한다 — 다시 물어도 같은 답이고, 안 캐시하면 매번 AI를 태운다.
      fresh.push({ combo_key: keys[i], value: UNKNOWN });
      return { rowId: r.row.id, colId: r.col.id, value: UNKNOWN, from: "unknown" };
    }
    fresh.push({ combo_key: keys[i], value: ai });   // 실패는 캐시하지 않는다 — 재시도가 막힌다
    return { rowId: r.row.id, colId: r.col.id, value: ai, from: "ai" };
  });

  // 같은 열에서 세 칸 이상 값이 똑같으면 정보가 없다는 뜻이다. 모델이 모르는 대상에
  // 같은 값을 복사해 넣은 것이다(일본 야구 선수 4명이 전부 47.0%였다).
  // **캐시에서 온 값도 거른다** — 탐지 전에 들어간 값이 캐시에 그대로 남아 있기 때문이다.
  const copied = findCopied(reqs, results);
  if (copied.size) {
    for (const i of copied) {
      results[i] = { ...results[i], value: UNKNOWN, from: "unknown" };
      fresh.push({ combo_key: keys[i], value: UNKNOWN });   // 캐시도 덮어 다시 안 걸리게 한다
    }
  }

  const dedup = new Map(fresh.map((f) => [f.combo_key, f]));
  await writeCache(Array.from(dedup.values()));

  /* 관측 보정 — 엔진이 AI에서 독립하는 지점.
     캐시에는 **시작값(prior)** 을 저장하고, 그 조각이 실제로 맞았는지는 따로 쌓인다.
     돌려줄 때 그 성적으로 값을 당긴다. 표본이 쌓일수록 관측이 추정을 이긴다.
     보정값을 캐시하지 않는 이유: 관측은 경기마다 달라지는데 캐시는 고정이기 때문이다. */
  const stats = await pieceStatsMany(
    reqs.map((r) => ({ cond, row: r.row.name, col: r.col.name }))
  );
  return results.map((res, i) => {
    if (res.value === UNKNOWN || res.value === NO_VALUE) return res;
    const s = stats.get(pieceId({ cond, row: reqs[i].row.name, col: reqs[i].col.name }));
    if (!s?.scored) return res;
    const adjusted = applyObserved(res.value, { scored: s.scored, hits: s.hits });
    return adjusted === res.value ? res : { ...res, value: adjusted };
  });
}

/**
 * 복사된 값 찾기.
 * 서로 다른 주체(행)에 같은 값이 세 번 이상 붙으면 그건 산출이 아니라 복사다.
 * 소수점 한 자리까지 정확히 겹칠 확률은 낮으므로, 겹치면 정보가 없다고 본다.
 */
const COPY_THRESHOLD = 3;

function findCopied(reqs: CellRequest[], results: CellResult[]): Set<number> {
  const byCol = new Map<string, Map<string, number[]>>();
  results.forEach((r, i) => {
    if (r.value === UNKNOWN || r.value === NO_VALUE) return;
    // 규칙으로 계산되는 열은 제외한다. 날씨 궁합은 같은 별자리 원소면 **원래 같은 값**이라
    // 겹치는 게 정상이다. 복사 탐지는 "모델이 지어냈는가"를 보는 장치지 규칙을 의심하는 게 아니다.
    if (FORTUNE_COLS.has(reqs[i]?.col.name ?? "")) return;
    const col = reqs[i]?.col.name ?? "";
    if (!byCol.has(col)) byCol.set(col, new Map());
    const m = byCol.get(col)!;
    if (!m.has(r.value)) m.set(r.value, []);
    m.get(r.value)!.push(i);
  });

  const out = new Set<number>();
  for (const m of byCol.values()) {
    for (const idxs of m.values()) {
      // 같은 행 이름이 여러 번 들어온 경우는 빼고, 서로 다른 주체끼리만 센다.
      const subjects = new Set(idxs.map((i) => reqs[i]?.row.name));
      if (subjects.size >= COPY_THRESHOLD) idxs.forEach((i) => out.add(i));
    }
  }
  return out;
}

/* ── F-05 경기 맥락 발광 ───────────────────────────────────
   경기 맥락을 읽고 "지금 이 경기에서 유효한 셀"을 고른다.
   발광 셀은 곧 예측 선언이므로(기획서 1-5 단계 9) 고른 즉시 기록으로 남긴다. */

export type GlowCandidate = { rowId: string; colId: string; row: string; col: string; value: string };
export type GlowPick = { rowId: string; colId: string; why: string };
export type GlowResult = { cells: GlowPick[]; line: string; ok: boolean };

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

const GLOW_EXAMPLE =
  `{"picks":[{"i":0,"why":"후반 수비 붕괴 구간과 맞아떨어짐"}],"line":"홈 우위가 이 셀에서만 유지됨"}`;

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

/**
 * 발광 캐시 키.
 * 같은 경기·같은 상황·같은 격자면 분석 결과도 같다. 예열된 기본 격자는
 * 유저끼리 똑같으므로, 첫 사람만 AI를 타고 나머지는 캐시를 읽는다.
 * 경기 상황(status)이 바뀜면 키가 바뀜다 — 득점 후에도 옮 분석을 보여주면 안 된다.
 */
function glowKey(cands: GlowCandidate[], ctx: MatchContext): string {
  const sig = cands
    .map((c) => `${c.row}\u00d7${c.col}=${c.value}`)
    .sort()
    .join("|");
  return `glow2:${ctx?.home ?? ""}-${ctx?.away ?? ""}|${ctx?.status ?? ""}|${hash(sig)}`;
}

export async function analyzeGlow(cands: GlowCandidate[], ctx: MatchContext): Promise<GlowResult> {
  if (!cands.length) return { cells: [], line: "", ok: true };
  // 발광은 "지금 이 경기에 유효하다"는 판단이다. 판단을 못 했으면 못 했다고 해야 한다 —
  // 승률이 극단인 셀을 골라 빛내면 분석한 척이 되고, 그건 예측 선언으로 기록까지 된다.
  if (!ctx) return { cells: [], line: "", ok: false };

  // 캐시 우선 — 분석은 셀 산출보다 비싸고, 같은 격자면 답도 같다.
  const gkey = glowKey(cands, ctx);
  const hit = await readCache([gkey]);
  const cachedGlow = hit.get(gkey);
  if (cachedGlow) {
    try {
      // 캐시는 축 **이름**으로 저장된다. id는 사람마다 다르므로 읽을 때 지금 격자의 id로 돌려놓는다.
      const g = JSON.parse(cachedGlow) as { picks: { row: string; col: string; why: string }[]; line: string };
      const byName = new Map(cands.map((c) => [c.row + "\u0000" + c.col, c]));
      const cells = (g.picks ?? [])
        .map((p) => {
          const c = byName.get(p.row + "\u0000" + p.col);
          return c ? { rowId: c.rowId, colId: c.colId, why: p.why } : null;
        })
        .filter((x): x is GlowPick => x !== null);
      if (cells.length) return { cells, line: g.line ?? "", ok: true };
    } catch { /* 깨졌으면 다시 산출한다 */ }
  }
  if (!aiAvailable()) return { cells: [], line: "", ok: false };

  const list = cands.map((x, i) => `${i}. ${x.row} × ${x.col} = ${x.value}`).join("\n");
  const user = `경기: ${ctx.sport} ${ctx.league} / ${ctx.home} vs ${ctx.away} (${ctx.status})\n\n격자:\n${list}`;

  const raw = await askJson(GLOW_SYSTEM, user, GLOW_SCHEMA, GLOW_EXAMPLE);
  if (!raw) return { cells: [], line: "", ok: false };
  try {
    const parsed = JSON.parse(raw) as { picks: { i: number; why: string }[]; line: string };
    const cells = (parsed.picks ?? [])
      .filter((p) => cands[p.i])
      .slice(0, 3)
      .map((p) => ({ rowId: cands[p.i].rowId, colId: cands[p.i].colId, why: p.why }));
    const out = { cells, line: parsed.line ?? "", ok: true };
    const byId = new Map(cands.map((c) => [c.rowId + "\u0000" + c.colId, c]));
    const picks = cells.map((p) => {
      const c = byId.get(p.rowId + "\u0000" + p.colId);
      return { row: c?.row ?? "", col: c?.col ?? "", why: p.why };
    });
    await writeCache([{ combo_key: gkey, value: JSON.stringify({ picks, line: out.line }) }]);
    return out;
  } catch {
    return { cells: [], line: "", ok: false };
  }
}

