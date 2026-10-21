// SCO 지갑 (F-11) — 클라이언트 보관.
// 실제 재화 정산(F-13)은 범위 밖이므로, v1은 기기 안에서만 순환한다.

const KEY = "databox_sco_v1";
const LOG = "databox_sco_log_v1";
const START = 120;

export type ScoEntry = { at: number; delta: number; memo: string };

export function balance(): number {
  if (typeof window === "undefined") return START;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === null) return START;
    const n = parseInt(v, 10);
    return isFinite(n) ? n : START;
  } catch { return START; }
}

export function history(): ScoEntry[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(window.localStorage.getItem(LOG) ?? "[]") as ScoEntry[]; }
  catch { return []; }
}

/** 차감/적립. 잔액이 모자라면 아무것도 하지 않고 null을 돌려준다. */
export function spend(amount: number, memo: string): number | null {
  const cur = balance();
  const next = cur - amount;
  if (next < 0) return null;
  try {
    window.localStorage.setItem(KEY, String(next));
    const log = [{ at: Date.now(), delta: -amount, memo }, ...history()].slice(0, 100);
    window.localStorage.setItem(LOG, JSON.stringify(log));
  } catch { /* 저장소가 없어도 진행은 된다 */ }
  return next;
}
