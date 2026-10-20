// 축 카탈로그. 기획서 2-2(축 선택 시트) + 프로토타입 BASE 기준.
// 순수 데이터/헬퍼만 — supabase import 금지(클라이언트에서도 쓴다).

export type AxisScope = "global" | "match";

export type AxisDef = {
  name: string;
  category: string;
  scope: AxisScope;
};

/** 카테고리 표시 순서. "이 경기 선수"는 경기 상세에서만 맨 위에 동적으로 끼워 넣는다. */
export const AXIS_CATEGORIES = [
  "자주 쓰는 축",
  "팀",
  "팀·선수",
  "경기 환경",
  "기록",
  "상황",
] as const;

const RAW: Record<string, string[]> = {
  "자주 쓰는 축": [
    "홈팀", "원정팀", "최근 5경기 폼", "상대 전적",
    "득점 기대값", "실점 기대값", "전반 득점", "후반 득점",
  ],
  "팀": [
    "프랑스", "모로코", "세이부", "라쿠텐",
    "호주", "카자흐스탄", "뉴질랜드 브레이커스", "시드니 킹스",
  ],
  "팀·선수": [
    "주전 공격수", "주전 골키퍼", "벤치 뎁스",
    "감독 성향", "핵심 선수 결장", "팀 평균 연령",
  ],
  "경기 환경": [
    "강수량", "기온", "홈 관중 수", "잔디 상태", "이동 거리", "휴식일 수",
  ],
  "기록": [
    "점유율", "슈팅 수", "유효슈팅", "코너킥", "파울 수",
    "경고 누적", "PK 성공률", "안타", "도루", "실책", "리바운드",
  ],
  "상황": [
    "선제골 여부", "후반 교체 타이밍", "세트피스 비중", "역전 빈도", "연장 승부 이력",
  ],
};

export const ALL_AXES: AxisDef[] = Object.entries(RAW).flatMap(([category, names]) =>
  names.map((name) => ({ name, category, scope: "global" as AxisScope }))
);

export const AXIS_NAMES = ALL_AXES.map((a) => a.name);

/** 최초 진입 기본 격자 8행 × 4열 (기획서 v2.2 — 빈 화면 대신 고치기부터 시작) */
export const DEFAULT_ROWS = [
  "홈팀", "원정팀", "최근 5경기 폼", "상대 전적",
  "주전 공격수", "강수량", "점유율", "선제골 여부",
];
export const DEFAULT_COLS = ["득점 기대값", "실점 기대값", "유효슈팅", "역전 빈도"];

/**
 * 경기 컨텍스트를 반영한 카탈로그.
 * 선수 축(F-17)은 경기 상세에서만 "이 경기 선수" 그룹으로 최상단에 뜬다.
 */
export function catalogFor(players?: string[]): { category: string; items: AxisDef[] }[] {
  const out: { category: string; items: AxisDef[] }[] = [];
  if (players && players.length) {
    out.push({
      category: "이 경기 선수",
      items: players.map((name) => ({ name, category: "이 경기 선수", scope: "match" as AxisScope })),
    });
  }
  for (const c of AXIS_CATEGORIES) {
    const items = ALL_AXES.filter((a) => a.category === c);
    if (items.length) out.push({ category: c, items });
  }
  return out;
}

/** 검색 필터 (축 선택 시트) */
export function searchAxes(
  groups: { category: string; items: AxisDef[] }[],
  q: string
): { category: string; items: AxisDef[] }[] {
  const s = q.trim();
  if (!s) return groups;
  return groups
    .map((g) => ({ category: g.category, items: g.items.filter((a) => a.name.includes(s)) }))
    .filter((g) => g.items.length);
}
