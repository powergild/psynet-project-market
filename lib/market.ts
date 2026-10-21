// 박스 마켓 시드 — 클라이언트에서도 쓴다(supabase import 금지).
//
// 기획서의 마켓(F-08/F-19/F-20/F-22)은 "타인이 만든 축과 계산식"을 전제로 한다.
// 실제 제작자가 쌓이기 전까지는 시드 박스로 그 자리를 채운다.
// 실데이터로 바꿀 때 교체할 지점은 getMarket() 하나다.

export type MarketBox = {
  id: string;
  by: string;          // 제작자 핸들
  name: string;
  hit: number;         // 적중률 %
  views: number;
  rows: string[];
  cols: string[];
};

const SEED: MarketBox[] = [
  {
    id: "mb-rainman", by: "@rainman", name: "비 오는 날의 원정",
    hit: 64, views: 1820,
    rows: ["강수량", "이동 거리", "원정팀", "휴식일 수"],
    cols: ["실점 기대값", "점유율", "파울 수"],
  },
  {
    id: "mb-latebloom", by: "@latebloom", name: "후반에 뒤집는 팀",
    hit: 58, views: 1140,
    rows: ["후반 교체 타이밍", "벤치 뎁스", "팀 평균 연령"],
    cols: ["후반 득점", "역전 빈도", "리드 유지율"],
  },
  {
    id: "mb-setpiece", by: "@setpiece", name: "세트피스 한 방",
    hit: 61, views: 960,
    rows: ["주전 공격수", "상대 전적", "홈 관중 수"],
    cols: ["세트피스 비중", "코너킥", "득점 기대값"],
  },
  {
    id: "mb-mound", by: "@mound", name: "마운드가 결정한다",
    hit: 55, views: 740,
    rows: ["주전 골키퍼", "최근 5경기 폼", "감독 성향"],
    cols: ["삼진", "볼넷", "평균자책점"],
  },
];

export function getMarket(): MarketBox[] {
  return SEED;
}

export function getMarketBox(id: string): MarketBox | undefined {
  return SEED.find((b) => b.id === id);
}

/** 변동 가격(F-10) — 조회수와 적중률에 연동. 5 단위로 끊는다. */
export function priceOf(b: MarketBox): number {
  return Math.max(10, Math.round((b.views / 60 + b.hit * 0.9) / 5) * 5);
}

/** 축 하나를 사 오는 값 — 박스 열람가의 절반. */
export function axisPriceOf(b: MarketBox): number {
  return Math.max(5, Math.round(priceOf(b) / 2 / 5) * 5);
}

function hash(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export type AxisOffer = { ax: string; kind: "row" | "col"; src: string; box: string; price: number };

/**
 * F-20 인그리드 추천 축 — 내가 아직 안 가진 축 하나를 골라 잠긴 행으로 제안한다.
 * seed가 같으면 같은 축이 나온다(경기마다 제안이 흔들리면 신뢰가 안 생긴다).
 */
export function recommendAxis(mine: string[], seed: string): AxisOffer | null {
  // 기획서는 격자 "하단에 잠긴 추천 행"을 말한다 — 열로 제안하면 가로 스크롤 밖으로 밀려 보이지 않는다.
  const cand: AxisOffer[] = [];
  for (const b of SEED) {
    for (const ax of b.rows) {
      if (!mine.includes(ax)) cand.push({ ax, kind: "row", src: b.by, box: b.id, price: axisPriceOf(b) });
    }
  }
  if (!cand.length) return null;
  return cand[hash(seed) % cand.length];
}

/** F-22 발광 셀 추천 — 발광한 셀의 두 축 중 하나에 대해 다른 관점을 제안한다. */
export function recommendForCell(row: string, col: string, mineSrc: string[]): (AxisOffer & { hit: number }) | null {
  const seed = hash(row + "×" + col);
  const pool = SEED.filter((b) => !mineSrc.includes(b.by));
  const b = (pool.length ? pool : SEED)[seed % (pool.length || SEED.length)];
  const useRow = seed % 2 === 0;
  return {
    ax: useRow ? row : col,
    kind: useRow ? "row" : "col",
    src: b.by,
    box: b.id,
    price: axisPriceOf(b),
    hit: b.hit,
  };
}
