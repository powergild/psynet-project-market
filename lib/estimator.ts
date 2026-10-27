// 산출 엔진 — 서버 전용.
//
// AI는 시작값(prior)을 만들 뿐이고, **값을 책임지는 건 이 엔진이다.**
// 캐시가 "이미 계산된 걸 다시 쓰는 층"이라면, 엔진은 "계산되지 않은 걸 만들어내는 층"이다.
// AI를 한 번 더 부르는 대신 가진 것으로 유도한다 — 호출이 늘어도 정확해지지 않기 때문이다.
//
// ── 근거 (2026-10-27 실측, 캐시 9,440건) ──────────────────
// 조건(비·라이벌전·추격 중)을 걸고 AI가 낸 값을 맞히는 평균 오차:
//     "그냥 50"            6.10p
//     "조건 무시, 기준값"    5.71p
//     "기준값을 50쪽 축소"   5.08p   (k≈0.6, 세 조건 모두 동일)
// 값의 전체 폭이 50에서 평균 6.19p인데 오차가 5p다. 게다가 서로 다른 조건의
// 변화량이 0.57~0.75로 상관되고, 변화량과 기준값의 상관은 -0.6~-0.88이다.
// 즉 AI가 만든 "조건 효과"는 **조건과 무관한 평균 회귀 + 잡음**이었다.
//
// 결론: 조건별로 AI를 다시 부르는 것은 토큰만 쓰고 정보를 더하지 않는다.
// 기준값에서 결정적으로 유도하고, **진짜 보정은 경기 결과에서 배운다.**

import { pct } from "@/lib/cellEngine";

/** 조건이 걸리면 주장이 약해진다 — 전제가 좁아질수록 표본이 줄기 때문이다. */
const SHRINK = 0.6;

/** 조건을 겹칠수록 더 좁아진다. 다만 바닥을 둬서 값이 50으로 뭉개지지 않게 한다. */
function shrinkFor(parts: number): number {
  return Math.max(0.35, SHRINK ** Math.max(1, parts) * (parts > 1 ? 1.2 : 1));
}

export type Derived = { value: string; from: "derived" };

/**
 * 조건 없는 기준값에서 조건이 걸린 값을 유도한다.
 * AI를 부르지 않고, 같은 입력이면 항상 같은 값이 나온다(재현 가능해야 믿을 수 있다).
 */
export function deriveConditioned(baseValue: string, condParts: string[]): Derived | null {
  const b = pct(baseValue);
  if (b === null) return null;
  const k = shrinkFor(condParts.length);
  const v = 50 + (b - 50) * k;
  return { value: Math.min(95, Math.max(5, v)).toFixed(1) + "%", from: "derived" };
}

/* ── 관측 보정 ─────────────────────────────────────────────
   여기가 엔진이 진짜로 자라는 지점이다.
   조각이 실제로 맞았는지는 glow_records에 쌓인다. 그 성적으로 시작값을 당긴다 —
   잘 맞히던 조각은 주장을 세게, 빗나가던 조각은 50쪽으로.

   AI의 추정은 사전확률일 뿐이고, 관측이 쌓일수록 관측이 이긴다. */

export type Observed = { scored: number; hits: number };

/** 관측 가중치. 표본이 쌓여야 시작값을 밀어낼 수 있다. */
const OBS_WEIGHT = 6;

export function applyObserved(value: string, obs: Observed | null): string {
  const v = pct(value);
  if (v === null || !obs || obs.scored === 0) return value;

  // 관측 적중률(그 조각이 실제로 맞은 비율)을 같은 척도로 본다.
  const observedRate = (obs.hits / obs.scored) * 100;
  const w = obs.scored / (obs.scored + OBS_WEIGHT);
  const blended = v * (1 - w) + observedRate * w;
  return Math.min(95, Math.max(5, blended)).toFixed(1) + "%";
}
