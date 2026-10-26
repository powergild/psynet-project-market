// 축 카탈로그.
// 축은 세 갈래다 — 스포츠조각의 "조건 + 특성 + 선수"를 격자 2축에 담기 위한 분해다.
//   조건(condition) = 박스 전체에 걸리는 맥락  (비 오는 날, 추격 중, 라이벌전 …)
//   행(row)         = 주체                     (선수·팀·팀 특성·경기 구도)
//   열(col)         = 특성/지표                (득점·도움·선방 … 측정하는 것)
// 셀은 "이 조건에서, 이 주체가, 이 특성 관점으로 유리할 확률"이다.
// 날씨·상황을 행에 두면 선수와 동시에 세울 수 없어서 조건으로 끌어올렸다.
// 순수 데이터/헬퍼만 — supabase import 금지(클라이언트에서도 쓴다).

export type AxisKind = "row" | "col";
export type AxisScope = "global" | "match";
export type Sport = "축구" | "야구" | "농구";

export const SPORTS: Sport[] = ["축구", "야구", "농구"];

export type AxisDef = {
  name: string;
  category: string;
  kind: AxisKind;
  scope: AxisScope;
};

type Group = { category: string; items: AxisDef[] };

/** 종목별 팀. 행 축의 "팀" 그룹은 여기서 파생된다. */
const TEAMS: Record<Sport, string[]> = {
  "축구": ["프랑스", "모로코", "호주", "카자흐스탄"],
  "야구": ["세이부", "라쿠텐"],
  "농구": ["뉴질랜드 브레이커스", "시드니 킹스"],
};

/** 행 축 — 주체·조건 */
const ROW_DEF: Record<string, { sport: Sport | "all"; items: string[] }> = {
  "경기 구도": { sport: "all", items: ["홈팀", "원정팀", "최근 5경기 폼", "상대 전적", "선제골 여부", "후반 교체 타이밍"] },
  "팀":       { sport: "all", items: SPORTS.flatMap((s) => TEAMS[s]) },
  "팀 특성":  { sport: "all", items: ["주전 공격수", "주전 골키퍼", "벤치 뎁스", "감독 성향", "핵심 선수 결장", "팀 평균 연령"] },
  "팀 상태":  { sport: "all", items: ["이동 거리", "휴식일 수", "연전 여부"] },
};

/* ── 조건 ──────────────────────────────────
   박스 전체에 걸린다. 조각의 "조건"에 해당하고, 셀 값의 전제가 된다.
   "비 · 음바페 × 득점 기대값" = 비 올 때 음바페가 득점 관점에서 유리할 확률. */
export type ConditionGroup = { category: string; items: string[] };

export const CONDITIONS: ConditionGroup[] = [
  { category: "날씨", items: ["비", "눈", "폭염", "강풍", "한파", "맑음"] },
  { category: "상황", items: ["추격 중", "리드 중", "라이벌전", "원정 3연전", "주중 경기", "연장 승부"] },
  { category: "구장", items: ["잔디 불량", "만원 관중", "무관중", "고지대"] },
];

export const CONDITION_NAMES: string[] = CONDITIONS.flatMap((g) => g.items);

/** 조건 없음 = 기본. 예열해 둔 캐시가 이 상태를 쓴다. */
export const NO_CONDITION = "";

/** 행 분류 목록 (초기 설문에서 쓴다) */
export const ROW_CATEGORIES = Object.keys(ROW_DEF);

// 열 축 — 측정 지표.
// 셀에 들어가는 값은 지표의 원값이 아니라 **그 조건에서의 승률(%)** 이다.
// 행(기준) × 열(지표)에 계산식이 적용된 결과가 승률이므로, 모든 셀의 단위는 하나다.
export type AxisFormat = "dec" | "pct" | "int";   // 지표 자체의 성격(참고용)

const COL_DEF: Record<string, { sport: Sport | "all"; metrics: Record<string, AxisFormat> }> = {
  "기대값":    { sport: "all", metrics: { "득점 기대값": "dec", "실점 기대값": "dec" } },
  "흐름":      { sport: "all", metrics: { "역전 빈도": "pct", "리드 유지율": "pct", "연장 승부 이력": "pct" } },
  "축구 기록": { sport: "축구", metrics: { "점유율": "pct", "슈팅 수": "int", "유효슈팅": "int", "코너킥": "int", "PK 성공률": "pct", "세트피스 비중": "pct", "전반 득점": "dec", "후반 득점": "dec", "파울 수": "int", "경고 누적": "int" } },
  "야구 기록": { sport: "야구", metrics: { "안타": "int", "도루": "int", "실책": "int", "삼진": "int", "볼넷": "int", "타율": "dec", "홈런": "int", "평균자책점": "dec" } },
  "농구 기록": { sport: "농구", metrics: { "리바운드": "int", "어시스트": "int", "턴오버": "int", "3점 성공률": "pct", "자유투 성공률": "pct", "전반 득점": "dec", "후반 득점": "dec", "파울 수": "int" } },
};

const FORMAT: Record<string, AxisFormat> = Object.fromEntries(
  Object.values(COL_DEF).flatMap((g) => Object.entries(g.metrics))
);

/** 지표 축의 성격. 셀 값은 항상 승률(%)이므로 표시 단위가 아니라 프롬프트 힌트로만 쓴다. */
export function colFormat(name: string): AxisFormat | null {
  return FORMAT[name] ?? null;
}

/** 셀 값의 단위 — 전 셀 공통. */
export const CELL_UNIT = "승률(%)";

/** 산출 실패 표기. 지어낸 숫자보다 빈 값이 낫다 — 유저는 이 값으로 판단을 한다. */
export const NO_VALUE = "—";

function mk(name: string, category: string, kind: AxisKind, scope: AxisScope = "global"): AxisDef {
  return { name, category, kind, scope };
}

export const ROW_AXES: AxisDef[] = Object.entries(ROW_DEF).flatMap(([c, g]) =>
  g.items.map((n) => mk(n, c, "row"))
);
export const COL_AXES: AxisDef[] = Object.entries(COL_DEF).flatMap(([c, g]) =>
  Object.keys(g.metrics).map((n) => mk(n, c, "col"))
);
export const ALL_AXES: AxisDef[] = [...ROW_AXES, ...COL_AXES];
export const AXIS_NAMES = ALL_AXES.map((a) => a.name);

/** 설문을 건너뛸 때 쓰는 기본 격자 8행 × 4열 */
// 행은 주체다 — 날씨는 조건으로 올라갔으므로 기본 행에서 뺀다.
export const DEFAULT_ROWS = [
  "홈팀", "원정팀", "최근 5경기 폼", "상대 전적",
  "주전 공격수", "주전 골키퍼", "휴식일 수", "선제골 여부",
];
// 설문을 건너뛰면 종목을 모른다 — 종목을 안 가리는 지표만 쓴다.
export const DEFAULT_COLS = ["득점 기대값", "실점 기대값", "역전 빈도", "리드 유지율"];

const fits = (s: Sport | "all", sport?: Sport | null) => s === "all" || !sport || s === sport;

/**
 * 행/열에 맞는 카탈로그.
 * 선수는 주체이므로 행 축에서만, 그리고 경기 안에서만 고를 수 있다(F-17).
 * sport가 주어지면 그 종목에 맞는 지표·팀만 보여준다.
 */
/** 메인에서도 고를 수 있는 선수. 조각은 "아무 팀에서나 관심 있는 선수"를 고르는 것이므로
 *  경기 밖에서도 주체로 세울 수 있어야 한다. 경기 안에서는 그 경기 선수가 우선 노출된다. */
let GLOBAL_PLAYERS: string[] = [];
export function setGlobalPlayers(names: string[]) {
  GLOBAL_PLAYERS = Array.from(new Set(names));
}
export function globalPlayers(): string[] {
  return GLOBAL_PLAYERS;
}

export function catalogFor(kind: AxisKind, players?: string[], sport?: Sport | null): Group[] {
  if (kind === "col") {
    return Object.entries(COL_DEF)
      .filter(([, g]) => fits(g.sport, sport))
      .map(([category, g]) => ({
        category,
        items: Object.keys(g.metrics).map((n) => mk(n, category, "col")),
      }));
  }

  const out: Group[] = [];
  if (players && players.length) {
    out.push({
      category: "이 경기 선수",
      items: players.map((n) => mk(n, "이 경기 선수", "row", "match")),
    });
  } else if (GLOBAL_PLAYERS.length) {
    out.push({
      category: "선수",
      items: GLOBAL_PLAYERS.map((n) => mk(n, "선수", "row")),
    });
  }
  for (const [category, g] of Object.entries(ROW_DEF)) {
    if (!fits(g.sport, sport)) continue;
    const items = (category === "팀" && sport ? TEAMS[sport] : g.items).map((n) => mk(n, category, "row"));
    if (items.length) out.push({ category, items });
  }
  return out;
}

/** 설문에서 고를 수 있는 지표 목록 (종목별) */
export function metricChoices(sport: Sport): Group[] {
  return catalogFor("col", undefined, sport);
}

/**
 * 설문 결과 → 초기 격자.
 * 행은 고른 분류의 항목을 순서대로, 화면에 담기는 만큼만(최대 10개) 채운다.
 */
export function buildSetup(
  sport: Sport,
  rowCategories: string[],
  metrics: string[],
  players?: string[]
): { rows: string[]; cols: string[] } {
  const rows: string[] = [];
  for (const c of rowCategories) {
    if (c === "이 경기 선수") { rows.push(...(players ?? [])); continue; }
    const g = ROW_DEF[c];
    if (!g) continue;
    rows.push(...(c === "팀" ? TEAMS[sport] : g.items));
  }
  const uniq = Array.from(new Set(rows)).slice(0, 10);
  return {
    rows: uniq.length ? uniq : DEFAULT_ROWS,
    cols: metrics.length ? metrics.slice(0, 6) : DEFAULT_COLS,
  };
}

/** 검색 필터 (축 선택 시트) */
export function searchAxes(groups: Group[], q: string): Group[] {
  const s = q.trim();
  if (!s) return groups;
  return groups
    .map((g) => ({ category: g.category, items: g.items.filter((a) => a.name.includes(s)) }))
    .filter((g) => g.items.length);
}
