// 축 카탈로그.
// 행과 열은 성격이 다르다 — 분류체계를 분리한다.
//   행(row) = 주체·조건  "무엇을 기준으로 보는가"  (팀·선수·환경·상황)
//   열(col) = 측정 지표  "무엇을 재는가"          (기대값·기록·흐름)
// 셀은 "이 조건에서 이 지표가 얼마인가"로 읽힌다. 뒤집힌 조합(득점기대값 × 홈팀)은 만들 수 없다.
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
  "경기 환경": { sport: "all", items: ["강수량", "기온", "홈 관중 수", "잔디 상태", "이동 거리", "휴식일 수"] },
};

/** 행 분류 목록 (초기 설문에서 쓴다) */
export const ROW_CATEGORIES = Object.keys(ROW_DEF);

/** 열 축 — 측정 지표. 지표마다 단위를 고정한다(AI가 맥락 따라 형식을 바꾸지 못하게). */
export type AxisFormat = "dec" | "pct" | "int";

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

/** 지표 축의 고정 단위. 모르는 축이면 null. */
export function colFormat(name: string): AxisFormat | null {
  return FORMAT[name] ?? null;
}

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
export const DEFAULT_ROWS = [
  "홈팀", "원정팀", "최근 5경기 폼", "상대 전적",
  "주전 공격수", "강수량", "휴식일 수", "선제골 여부",
];
export const DEFAULT_COLS = ["득점 기대값", "실점 기대값", "유효슈팅", "역전 빈도"];

const fits = (s: Sport | "all", sport?: Sport | null) => s === "all" || !sport || s === sport;

/**
 * 행/열에 맞는 카탈로그.
 * 선수는 주체이므로 행 축에서만, 그리고 경기 안에서만 고를 수 있다(F-17).
 * sport가 주어지면 그 종목에 맞는 지표·팀만 보여준다.
 */
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
