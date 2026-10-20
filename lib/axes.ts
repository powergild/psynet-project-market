// 축 카탈로그.
// 행과 열은 성격이 다르다 — 분류체계를 분리한다.
//   행(row) = 주체·조건  "무엇을 기준으로 보는가"  (팀·선수·환경·상황)
//   열(col) = 측정 지표  "무엇을 재는가"          (기대값·기록·흐름)
// 셀은 "이 조건에서 이 지표가 얼마인가"로 읽힌다. 뒤집힌 조합(득점기대값 × 홈팀)은 만들 수 없다.
// 순수 데이터/헬퍼만 — supabase import 금지(클라이언트에서도 쓴다).

export type AxisKind = "row" | "col";
export type AxisScope = "global" | "match";

export type AxisDef = {
  name: string;
  category: string;
  kind: AxisKind;
  scope: AxisScope;
};

type Group = { category: string; items: AxisDef[] };

/** 행 축 — 주체·조건 */
const ROW_RAW: Record<string, string[]> = {
  "경기 구도": ["홈팀", "원정팀", "최근 5경기 폼", "상대 전적", "선제골 여부", "후반 교체 타이밍"],
  "팀": ["프랑스", "모로코", "세이부", "라쿠텐", "호주", "카자흐스탄", "뉴질랜드 브레이커스", "시드니 킹스"],
  "팀 특성": ["주전 공격수", "주전 골키퍼", "벤치 뎁스", "감독 성향", "핵심 선수 결장", "팀 평균 연령"],
  "경기 환경": ["강수량", "기온", "홈 관중 수", "잔디 상태", "이동 거리", "휴식일 수"],
};

/** 열 축 — 측정 지표. 지표마다 단위를 고정한다(AI가 맥락 따라 형식을 바꾸지 못하게). */
export type AxisFormat = "dec" | "pct" | "int";

const COL_DEF: Record<string, Record<string, AxisFormat>> = {
  "기대값":    { "득점 기대값": "dec", "실점 기대값": "dec", "전반 득점": "dec", "후반 득점": "dec" },
  "공격 기록": { "점유율": "pct", "슈팅 수": "int", "유효슈팅": "int", "코너킥": "int", "PK 성공률": "pct" },
  "수비·규율": { "파울 수": "int", "경고 누적": "int" },
  "흐름":      { "역전 빈도": "pct", "세트피스 비중": "pct", "연장 승부 이력": "pct" },
  "야구":      { "안타": "int", "도루": "int", "실책": "int" },
  "농구":      { "리바운드": "int" },
};

const COL_RAW: Record<string, string[]> = Object.fromEntries(
  Object.entries(COL_DEF).map(([c, m]) => [c, Object.keys(m)])
);

const FORMAT: Record<string, AxisFormat> = Object.fromEntries(
  Object.values(COL_DEF).flatMap((m) => Object.entries(m))
);

/** 지표 축의 고정 단위. 모르는 축이면 null. */
export function colFormat(name: string): AxisFormat | null {
  return FORMAT[name] ?? null;
}

function build(raw: Record<string, string[]>, kind: AxisKind): AxisDef[] {
  return Object.entries(raw).flatMap(([category, names]) =>
    names.map((name) => ({ name, category, kind, scope: "global" as AxisScope }))
  );
}

export const ROW_AXES: AxisDef[] = build(ROW_RAW, "row");
export const COL_AXES: AxisDef[] = build(COL_RAW, "col");
export const ALL_AXES: AxisDef[] = [...ROW_AXES, ...COL_AXES];
export const AXIS_NAMES = ALL_AXES.map((a) => a.name);

/** 최초 진입 기본 격자 8행 × 4열 (기획서 v2.2 — 빈 화면 대신 고치기부터 시작) */
export const DEFAULT_ROWS = [
  "홈팀", "원정팀", "최근 5경기 폼", "상대 전적",
  "주전 공격수", "강수량", "휴식일 수", "선제골 여부",
];
export const DEFAULT_COLS = ["득점 기대값", "실점 기대값", "유효슈팅", "역전 빈도"];

/**
 * 행/열에 맞는 카탈로그.
 * 선수는 주체이므로 행 축에서만, 그리고 경기 안에서만 고를 수 있다(F-17).
 */
export function catalogFor(kind: AxisKind, players?: string[]): Group[] {
  if (kind === "col") {
    return Object.keys(COL_RAW).map((c) => ({
      category: c,
      items: COL_AXES.filter((a) => a.category === c),
    }));
  }
  const out: Group[] = [];
  if (players && players.length) {
    out.push({
      category: "이 경기 선수",
      items: players.map((name) => ({
        name, category: "이 경기 선수", kind: "row" as AxisKind, scope: "match" as AxisScope,
      })),
    });
  }
  for (const c of Object.keys(ROW_RAW)) {
    out.push({ category: c, items: ROW_AXES.filter((a) => a.category === c) });
  }
  return out;
}

/** 검색 필터 (축 선택 시트) */
export function searchAxes(groups: Group[], q: string): Group[] {
  const s = q.trim();
  if (!s) return groups;
  return groups
    .map((g) => ({ category: g.category, items: g.items.filter((a) => a.name.includes(s)) }))
    .filter((g) => g.items.length);
}
