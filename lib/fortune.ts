// 재미 지표 — 운세·궁합·징크스.
//
// 이것들은 AI에게 묻지 않는다. **규칙으로 계산한다.**
//   운세는 근거가 없지만, 계산 규칙은 투명하고 재현 가능해야 한다.
//   AI에게 "음바페의 오늘 운세"를 물으면 매번 다른 숫자를 지어낼 뿐이고,
//   그건 재미도 아니고 데이터도 아니다.
//
// 생년월일이 있으면 계산되고, 없으면 "—"가 되어 데이터 요청으로 간다.
// 지어내지 않는다는 원칙은 재미 지표에도 똑같이 적용된다.

const DAY = 86_400_000;

/** 바이오리듬 — 생일부터 지난 날수의 주기. 널리 알려진 규칙이라 설명이 쉽다. */
const CYCLE = { 신체: 23, 감성: 28, 지성: 33 };

function daysAlive(birth: string, at: Date): number | null {
  const b = Date.parse(birth + "T00:00:00Z");
  if (!isFinite(b)) return null;
  return Math.floor((Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - b) / DAY);
}

function rhythm(days: number, period: number): number {
  return Math.sin((2 * Math.PI * days) / period);   // -1 ~ 1
}

/** -1~1을 승률 범위로 민다. 극단으로 가지 않게 35~70 사이. */
function toRate(x: number): string {
  return (52.5 + x * 17.5).toFixed(1) + "%";
}

/** 오늘의 운세 — 세 리듬의 평균. 같은 사람·같은 날이면 항상 같은 값이다. */
export function fortuneOf(birth: string, at: Date): string | null {
  const d = daysAlive(birth, at);
  if (d === null) return null;
  const avg = (rhythm(d, CYCLE.신체) + rhythm(d, CYCLE.감성) + rhythm(d, CYCLE.지성)) / 3;
  return toRate(avg);
}

/* ── 별자리 ─────────────────────────────────────────────── */
const SIGNS: { name: string; until: [number, number] }[] = [
  { name: "염소", until: [1, 19] }, { name: "물병", until: [2, 18] },
  { name: "물고기", until: [3, 20] }, { name: "양", until: [4, 19] },
  { name: "황소", until: [5, 20] }, { name: "쌍둥이", until: [6, 21] },
  { name: "게", until: [7, 22] }, { name: "사자", until: [8, 22] },
  { name: "처녀", until: [9, 22] }, { name: "천칭", until: [10, 22] },
  { name: "전갈", until: [11, 21] }, { name: "사수", until: [12, 21] },
];

export function signOf(birth: string): string | null {
  const d = new Date(birth + "T00:00:00Z");
  if (isNaN(d.getTime())) return null;
  const m = d.getUTCMonth() + 1, day = d.getUTCDate();
  for (const s of SIGNS) {
    const [sm, sd] = s.until;
    if (m < sm || (m === sm && day <= sd)) return s.name;
  }
  return "염소";
}

/** 4원소. 날씨 궁합은 여기서 나온다 — 불은 비를 싫어하고, 물은 비에 강하다. */
const ELEMENT: Record<string, "불" | "흙" | "공기" | "물"> = {
  양: "불", 사자: "불", 사수: "불",
  황소: "흙", 처녀: "흙", 염소: "흙",
  쌍둥이: "공기", 천칭: "공기", 물병: "공기",
  게: "물", 전갈: "물", 물고기: "물",
};

const WEATHER_FIT: Record<string, Record<string, number>> = {
  //            불     흙     공기    물
  "비":   { 불: -0.7, 흙: 0.1, 공기: -0.2, 물: 0.8 },
  "눈":   { 불: -0.6, 흙: 0.3, 공기: -0.3, 물: 0.5 },
  "폭염": { 불: 0.8, 흙: -0.2, 공기: 0.1, 물: -0.6 },
  "강풍": { 불: -0.3, 흙: -0.4, 공기: 0.8, 물: 0.1 },
  "한파": { 불: -0.5, 흙: 0.5, 공기: -0.1, 물: 0.2 },
  "맑음": { 불: 0.6, 흙: 0.4, 공기: 0.4, 물: 0.1 },
};

/** 날씨 궁합 — 별자리 원소와 그날 날씨의 상성. */
export function weatherFitOf(birth: string, weather: string): string | null {
  const sign = signOf(birth);
  if (!sign) return null;
  const el = ELEMENT[sign];
  const table = WEATHER_FIT[weather];
  if (!el || !table) return null;
  return toRate(table[el] ?? 0);
}

/* ── 결정적 해시 ──────────────────────────────────────────
   징크스·요일 운은 근거가 없는 대신 **항상 같아야** 한다.
   같은 사람이 같은 날 열 때마다 숫자가 달라지면 그건 재미도 아니다. */
function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** 요일 운 — 생년월일과 그날 요일의 조합. */
export function weekdayLuckOf(birth: string, at: Date): string | null {
  if (!signOf(birth)) return null;
  const w = WEEKDAY[at.getUTCDay()];
  const h = hash(birth + "|" + w);
  return toRate(((h % 200) / 100) - 1);
}

/** 징크스 — 상대가 누구냐에 따라 갈린다. */
export function jinxOf(birth: string, opponent: string): string | null {
  if (!signOf(birth)) return null;
  const h = hash(birth + "|" + opponent);
  return toRate(((h % 200) / 100) - 1);
}

/** 이 열은 규칙으로 계산한다 — AI를 타지 않는다. */
export const FORTUNE_COLS = new Set(["오늘의 운세", "날씨 궁합", "징크스", "요일 운"]);

export type FortuneCtx = { at: Date; weather: string; opponent: string };

export function computeFortune(col: string, birth: string, ctx: FortuneCtx): string | null {
  switch (col) {
    case "오늘의 운세": return fortuneOf(birth, ctx.at);
    case "날씨 궁합":   return weatherFitOf(birth, ctx.weather);
    case "요일 운":     return weekdayLuckOf(birth, ctx.at);
    case "징크스":      return jinxOf(birth, ctx.opponent);
    default:            return null;
  }
}
