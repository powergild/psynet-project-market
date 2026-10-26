// 경기 데이터 어댑터.
//
// ⚠️ 교체 지점 — LIVE스코어 데이터 소스가 확정되면 `SeedSource`를 대체하는 구현체만 새로 쓰고
// `getMatchSource()`가 그걸 반환하게 바꾸면 된다. 나머지 코드(격자·AI 셀·발광)는 손대지 않는다.
// 접근 방식이 REST면 `LivescoreApiSource`, 배치 동기화면 Supabase를 읽는 `SyncedSource`를 만든다.

export type MatchStatus = "scheduled" | "live" | "finished";

export type Match = {
  id: string;
  sport: string;          // 축구 | 야구 | 농구 ...
  league: string;
  home: string;
  away: string;
  startsAt: string;       // ISO
  status: MatchStatus;
  scoreHome: number | null;
  scoreAway: number | null;
  minute: string | null;  // "72'" | "7회말" | "Q3 04:12"
  players: string[];      // 이 경기 선수 — 경기 스코프 축 후보(F-17)
  weather: string;        // 조건(날씨)과 대조한다 — 일치하면 경험치 배수
  situations: string[];   // 조건(상황)과 대조한다 — 라이벌전·추격 중 등
};

export type MatchStat = {
  key: string;            // 축 카탈로그의 "기록" 계열 이름과 맞춘다
  home: string;
  away: string;
};

export interface MatchSource {
  listMatches(): Promise<Match[]>;
  getMatch(id: string): Promise<Match | undefined>;
  getStats(id: string): Promise<MatchStat[]>;
}

// ── 시드 구현 ──────────────────────────────────────────────
// 실데이터 연결 전까지 전체 플로우가 돌아가게 하는 용도. 기획서/프로토타입의 팀 구성을 그대로 따른다.

const SEED: Match[] = [
  {
    id: "m-fra-mar",
    sport: "축구",
    league: "월드컵 4강",
    home: "프랑스",
    away: "모로코",
    startsAt: "2026-10-20T20:00:00+09:00",
    status: "live",
    scoreHome: 2,
    scoreAway: 0,
    minute: "72'",
    players: ["음바페", "그리즈만", "뎀벨레", "지루", "추아메니", "요리스",
              "하키미", "지예흐", "엔네시리", "부누", "아마라비", "암라바트"],
    weather: "비",
    situations: ["라이벌전"],
  },
  {
    id: "m-sei-rak",
    sport: "야구",
    league: "퍼시픽리그",
    home: "세이부",
    away: "라쿠텐",
    startsAt: "2026-10-20T18:30:00+09:00",
    status: "live",
    scoreHome: 3,
    scoreAway: 4,
    minute: "7회말",
    players: ["야마카와", "겐다", "모리", "다카하시", "히라이", "아사무라",
              "시마우치", "다나카", "모기", "스즈키"],
    weather: "맑음",
    situations: ["추격 중", "주중 경기"],
  },
  {
    id: "m-aus-kaz",
    sport: "축구",
    league: "아시안컵 예선",
    home: "호주",
    away: "카자흐스탄",
    startsAt: "2026-10-21T19:00:00+09:00",
    status: "scheduled",
    scoreHome: null,
    scoreAway: null,
    minute: null,
    players: ["구드윈", "어바인", "보일", "라이언", "수타르", "무이",
              "자이누트디노프", "추프리나", "아슬란베크", "포킨"],
    weather: "강풍",
    situations: ["원정 3연전"],
  },
  {
    id: "m-nzb-syd",
    sport: "농구",
    league: "NBL",
    home: "뉴질랜드 브레이커스",
    away: "시드니 킹스",
    startsAt: "2026-10-20T16:00:00+09:00",
    status: "finished",
    scoreHome: 88,
    scoreAway: 95,
    minute: null,
    players: ["웹스터", "르어프", "애벗", "델라니", "쿡스", "보건",
              "헌터", "비커스태프", "프록터"],
    weather: "맑음",
    situations: ["리드 중", "만원 관중"],
  },
];

const SEED_STATS: Record<string, MatchStat[]> = {
  "m-fra-mar": [
    { key: "점유율", home: "58%", away: "42%" },
    { key: "슈팅 수", home: "14", away: "7" },
    { key: "유효슈팅", home: "6", away: "2" },
    { key: "코너킥", home: "5", away: "3" },
    { key: "파울 수", home: "9", away: "14" },
    { key: "경고 누적", home: "1", away: "3" },
  ],
  "m-sei-rak": [
    { key: "안타", home: "8", away: "10" },
    { key: "실책", home: "1", away: "0" },
    { key: "도루", home: "2", away: "1" },
  ],
  "m-aus-kaz": [],
  "m-nzb-syd": [
    { key: "리바운드", home: "38", away: "44" },
    { key: "유효슈팅", home: "32", away: "37" },
    { key: "파울 수", home: "18", away: "15" },
  ],
};

class SeedSource implements MatchSource {
  async listMatches(): Promise<Match[]> {
    const rank: Record<MatchStatus, number> = { live: 0, scheduled: 1, finished: 2 };
    return [...SEED].sort(
      (a, b) => rank[a.status] - rank[b.status] || a.startsAt.localeCompare(b.startsAt)
    );
  }
  async getMatch(id: string) {
    return SEED.find((m) => m.id === id);
  }
  async getStats(id: string) {
    return SEED_STATS[id] ?? [];
  }
}

let source: MatchSource | null = null;
export function getMatchSource(): MatchSource {
  if (!source) source = new SeedSource();
  return source;
}

/** 축의 대상 바인딩 문자열 (예: "프랑스·모로코"). 경기 밖이면 null. */
export function matchScope(m: Match | null | undefined): string | null {
  return m ? `${m.home}·${m.away}` : null;
}
