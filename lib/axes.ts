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

/* ── 종목마다 말이 달라지는 항목 ───────────────────────────
   축구의 "선제골"·"주전 골키퍼"가 야구·농구 격자에 그대로 떴다. 야구엔 골이 없고
   농구엔 골키퍼가 없다. 종목이 정해진 자리(경기 안)에서는 그 종목의 말을 써야 한다.
   "팀"이 TEAMS[sport]로 갈리는 것과 같은 처리다. */
const BY_SPORT: Record<string, Record<Sport, string[]>> = {
  "경기 전개": {
    "축구": ["선제골 여부", "후반 교체 타이밍"],
    "야구": ["선취점 여부", "불펜 투입 타이밍"],
    "농구": ["선제 득점 여부", "후반 교체 타이밍"],
  },
  "팀 특성": {
    "축구": ["주전 공격수", "주전 골키퍼", "벤치 뎁스", "감독 성향", "핵심 선수 결장", "팀 평균 연령"],
    "야구": ["선발 투수", "마무리 투수", "벤치 뎁스", "감독 성향", "핵심 선수 결장", "팀 평균 연령"],
    "농구": ["주전 가드", "주전 센터", "벤치 뎁스", "감독 성향", "핵심 선수 결장", "팀 평균 연령"],
  },
};

/** 종목을 모를 때(메인) 쓰는 합집합. 중복은 한 번만. */
const unionOf = (category: string): string[] =>
  Array.from(new Set(SPORTS.flatMap((s) => BY_SPORT[category][s])));

/** 행 축 — 주체·조건.
 *  BY_SPORT에 있는 분류는 items가 합집합이고, 종목이 주어지면 그 종목 것으로 갈린다. */
const ROW_DEF: Record<string, { sport: Sport | "all"; level: AxisLevel; items: string[] }> = {
  "팀":       { sport: "all", level: "top",    items: SPORTS.flatMap((s) => TEAMS[s]) },
  "경기 구도": { sport: "all", level: "top",    items: ["홈팀", "원정팀", "최근 5경기 폼", "상대 전적"] },
  "경기 전개": { sport: "all", level: "detail", items: unionOf("경기 전개") },
  "팀 특성":  { sport: "all", level: "detail", items: unionOf("팀 특성") },
  "팀 상태":  { sport: "all", level: "detail", items: ["이동 거리", "휴식일 수", "연전 여부"] },
  // 같은 말이 조건·행·열 세 자리에서 각각 다른 뜻이 된다.
  //   조건  "비일 때, 프랑스가 득점에서 앞설 확률"      전제
  //   행    "비만 놓고 보면 홈팀이 득점에서 앞설 확률"   요인
  //   열    "프랑스가 비에 강할 확률"                  적응도
  "날씨":     { sport: "all", level: "top",    items: ["비", "눈", "폭염", "강풍", "한파", "맑음"] },
  "상황":     { sport: "all", level: "top",    items: ["추격 중", "리드 중", "라이벌전", "원정 3연전", "주중 경기", "연장 승부"] },
  "구장":     { sport: "all", level: "detail", items: ["잔디 불량", "만원 관중", "무관중", "고지대"] },
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

/** 조건은 여러 개를 겹칠 수 있다 — 조각이 "비 오는 날 + 지고 있을 때"처럼 겹쳐 걸리기 때문이다.
 *  키는 정렬해서 합친다. 고른 순서가 달라도 같은 조각이어야 한다. */
export const COND_SEP = "·";
export function condKey(items: string[]): string {
  return Array.from(new Set(items)).sort().join(COND_SEP);
}
export function condParts(cond: string): string[] {
  return cond ? cond.split(COND_SEP).filter(Boolean) : [];
}

/** 행 분류 목록 (초기 설문에서 쓴다) */
export const ROW_CATEGORIES = Object.keys(ROW_DEF);

/** 설문에서 고를 수 있는 기준 분류. 층위를 지켜야 한다 —
 *  메인에서 "팀 특성"을 고르게 하면 격자가 분석표가 된다. */
export function rowCategories(level: AxisLevel = "top"): string[] {
  return Object.entries(ROW_DEF)
    .filter(([, g]) => level === "detail" || g.level === "top")
    .map(([c]) => c);
}

// 열 축 — 측정 지표.
// 셀에 들어가는 값은 지표의 원값이 아니라 **그 조건에서의 승률(%)** 이다.
// 행(기준) × 열(지표)에 계산식이 적용된 결과가 승률이므로, 모든 셀의 단위는 하나다.
export type AxisFormat = "dec" | "pct" | "int";   // 지표 자체의 성격(참고용)

/* 축에는 층위가 있다.
     top    메인에서 다루는 상위 개념 — 경기를 한눈에 가르는 것
     detail 경기 상세에서 다루는 하위 개념 — 그 경기를 뜯어보는 것
   메인에서 코너킥·PK 성공률까지 늘어놓으면 격자가 분석표가 되고, 경기 안에서
   기대값만 보면 들어온 보람이 없다. */
export type AxisLevel = "top" | "detail";

const COL_DEF: Record<string, { sport: Sport | "all"; level: AxisLevel; metrics: Record<string, AxisFormat> }> = {
  "기대값":    { sport: "all", level: "top", metrics: { "득점 기대값": "dec", "실점 기대값": "dec" } },
  "흐름":      { sport: "all", level: "top", metrics: { "역전 빈도": "pct", "리드 유지율": "pct", "연장 승부 이력": "pct" } },
  // 조건을 지표로 쓰면 "그 상황에 얼마나 강한가"를 묻는 것이 된다.
  "상황 적응": { sport: "all", level: "top", metrics: {
    "비": "pct", "눈": "pct", "폭염": "pct", "강풍": "pct", "한파": "pct",
    "추격 중": "pct", "리드 중": "pct", "라이벌전": "pct", "원정 3연전": "pct",
    "잔디 불량": "pct", "만원 관중": "pct", "무관중": "pct", "고지대": "pct",
  } },
  // 숫자로 안 잡히는 변수들. 경기 밖에서 벌어진 일이 경기 안을 흔든다.
  "변수":      { sport: "all", level: "top", metrics: { "감독 교체 효과": "pct", "최근 이슈": "pct", "부상 여파": "pct", "이적 적응": "pct" } },
  // 재미 지표 — 생년월일에서 규칙으로 계산한다(AI를 타지 않는다).
  "재미":      { sport: "all", level: "top", metrics: { "오늘의 운세": "pct", "날씨 궁합": "pct", "징크스": "pct", "요일 운": "pct" } },
  "축구 기록": { sport: "축구", level: "detail", metrics: { "점유율": "pct", "슈팅 수": "int", "유효슈팅": "int", "코너킥": "int", "PK 성공률": "pct", "세트피스 비중": "pct", "전반 득점": "dec", "후반 득점": "dec", "파울 수": "int", "경고 누적": "int" } },
  "야구 기록": { sport: "야구", level: "detail", metrics: { "안타": "int", "도루": "int", "실책": "int", "삼진": "int", "볼넷": "int", "타율": "dec", "홈런": "int", "평균자책점": "dec" } },
  "농구 기록": { sport: "농구", level: "detail", metrics: { "리바운드": "int", "어시스트": "int", "턴오버": "int", "3점 성공률": "pct", "자유투 성공률": "pct", "전반 득점": "dec", "후반 득점": "dec", "파울 수": "int" } },
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

/** 모르는 대상 — 산출 실패와 구분한다. 화면에는 똑같이 "—"로 보이지만,
 *  실패는 재시도하면 되고 이건 정보가 없는 것이라 요청을 받아야 한다. */
export const UNKNOWN = "—";

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
// 메인 기본 행 — 상위 개념만. 날씨는 조건으로, 세부 요인은 경기 상세로 갔다.
// 나머지 칸은 화면 크기에 맞춰 상위 축(팀·선수)에서 채워진다.
export const DEFAULT_ROWS = ["홈팀", "원정팀", "최근 5경기 폼", "상대 전적"];

/** 경기 상세 기본 행 — 그 경기를 뜯어보는 축.
 *  종목을 아는 자리에서만 쓰므로 종목의 말로 쓴다(야구에 골키퍼를 세우지 않는다). */
export const DETAIL_ROWS: Record<Sport, string[]> = {
  "축구": ["홈팀", "원정팀", "주전 공격수", "주전 골키퍼", "선제골 여부", "후반 교체 타이밍", "벤치 뎁스", "휴식일 수"],
  "야구": ["홈팀", "원정팀", "선발 투수", "마무리 투수", "선취점 여부", "불펜 투입 타이밍", "벤치 뎁스", "휴식일 수"],
  "농구": ["홈팀", "원정팀", "주전 가드", "주전 센터", "선제 득점 여부", "후반 교체 타이밍", "벤치 뎁스", "휴식일 수"],
};
// 설문을 건너뛰면 종목을 모른다 — 종목을 안 가리는 지표만 쓴다.
// 기본 행은 전부 역할·요인이라 운세를 물을 수 없다. 운세는 선수·팀을 행에 세운
// 사람이 직접 고르는 열이다 — 기본 격자에 두면 첫 화면에 빈 열이 생긴다.
export const DEFAULT_COLS = ["득점 기대값", "실점 기대값", "역전 빈도", "리드 유지율"];

/** 경기 상세는 세부 지표로 시작한다 — 종목이 정해져 있으니 바로 들어갈 수 있다. */
export const DETAIL_COLS: Record<Sport, string[]> = {
  "축구": ["유효슈팅", "점유율", "코너킥", "전반 득점"],
  "야구": ["안타", "삼진", "홈런", "실책"],
  "농구": ["리바운드", "어시스트", "3점 성공률", "턴오버"],
};

const fits = (s: Sport | "all", sport?: Sport | null) => s === "all" || !sport || s === sport;

/**
 * 행/열에 맞는 카탈로그.
 * 선수는 주체이므로 행 축에서만, 그리고 경기 안에서만 고를 수 있다(F-17).
 * sport가 주어지면 그 종목에 맞는 지표·팀만 보여준다.
 */
/** 메인에서도 고를 수 있는 선수. 조각은 "아무 팀에서나 관심 있는 선수"를 고르는 것이므로
 *  경기 밖에서도 주체로 세울 수 있어야 한다. 경기 안에서는 그 경기 선수가 우선 노출된다.
 *
 *  읽는 쪽은 게터가 아니라 아래 `catalogFor`가 **이 변수를 직접** 본다(`else if` 분기).
 *  게터를 따로 두면 "아무도 안 읽는다"로 오해하기 쉬워서 두지 않는다 — 실제로 한 번 당했다. */
let GLOBAL_PLAYERS: string[] = [];
export function setGlobalPlayers(names: string[]) {
  GLOBAL_PLAYERS = Array.from(new Set(names));
}

/**
 * 행/열 카탈로그.
 * 경기 안인지(level="detail") 메인인지(level="top")에 따라 다루는 층위가 다르다.
 * 메인에서 코너킥까지 고르게 하면 격자가 분석표가 되고, 경기 안에서 기대값만
 * 보여주면 들어온 보람이 없다. 상위 축은 양쪽 모두에서 쓸 수 있다.
 */
export function catalogFor(
  kind: AxisKind, players?: string[], sport?: Sport | null, level: AxisLevel = "top"
): Group[] {
  const inLevel = (l: AxisLevel) => level === "detail" || l === "top";

  if (kind === "col") {
    return Object.entries(COL_DEF)
      .filter(([, g]) => fits(g.sport, sport) && inLevel(g.level))
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
    if (!fits(g.sport, sport) || !inLevel(g.level)) continue;
    const names =
      category === "팀" && sport ? TEAMS[sport]
      : BY_SPORT[category] && sport ? BY_SPORT[category][sport]
      : g.items;
    const items = names.map((n) => mk(n, category, "row"));
    if (items.length) out.push({ category, items });
  }
  return out;
}

/**
 * 설문에서 고를 수 있는 지표 목록 (종목별).
 *
 * **level을 넘겨야 한다.** 종목 기록(안타·코너킥·리바운드)은 전부 level="detail"이라,
 * 기본값 "top"으로 부르면 야구 경기 설문에 야구 지표가 **하나도 안 나온다.**
 * "기본값으로 시작"은 DETAIL_COLS[sport]를 넣어주는데 설문으로는 고를 수 없어서,
 * 성실히 설문에 답한 유저가 오히려 더 빈약한 격자를 받았다.
 */
export function metricChoices(sport: Sport, level: AxisLevel = "top"): Group[] {
  return catalogFor("col", undefined, sport, level);
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
