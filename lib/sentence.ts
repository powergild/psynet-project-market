// 문장 슬롯 — 셀이 무엇을 묻는지 정의한다.
//
// 유저는 문장을 쓰지 않는다. 표에서 행·열·조건을 고르면 그 선택이 슬롯에 꽂힌다.
//   {조건} {주체}가 {특성 서술}할 확률
// 이 문장이 세 가지로 쓰인다:
//   1) AI 프롬프트       — 지금은 "음바페 × 역전 빈도"라고만 줘서 모델이 뭘 재는지 모른다
//   2) 셀을 탭했을 때 설명 — "음바페 × 역전 빈도"보다 읽을 수 있다
//   3) 조각 이름         — 조각 이름이 곧 예측이라는 기획과 맞아떨어진다
//
// 순수 데이터/헬퍼만 — supabase import 금지(클라이언트에서도 쓴다).

import { condParts } from "@/lib/axes";

/* ── 행 슬롯의 두 종류 ─────────────────────────────────────
   행에는 성격이 다른 두 가지가 섞여 있다. 문장으로 쓰면 그게 드러난다.
     주체형  프랑스 · 음바페 · 주전 공격수   → "…가 ~할 확률"
     요인형  최근 5경기 폼 · 휴식일 수       → 그 자체로는 주어가 못 된다

   요인형은 지금까지 "누구에 대한 확률인가"가 코드 안에만 있었다(채점은 홈 관점으로 읽는다).
   문장으로 쓰면 그 전제가 화면에 드러난다 — 숨은 규칙은 버그의 온상이다. */
const FACTOR_ROWS = new Set([
  "최근 5경기 폼", "상대 전적", "선제골 여부", "후반 교체 타이밍",
  "이동 거리", "휴식일 수", "연전 여부", "홈 관중 수",
  "벤치 뎁스", "감독 성향", "핵심 선수 결장", "팀 평균 연령",
]);

export function isFactorRow(row: string): boolean {
  return FACTOR_ROWS.has(row);
}

/* ── 특성 슬롯 ─────────────────────────────────────────────
   값은 전부 승률(%)이다. 그래서 서술은 **높을수록 유리**가 되도록만 쓴다.
   파울·실책처럼 많을수록 불리한 지표는 "덜 범할"로 뒤집어 방향을 통일한다 —
   한 격자 안에서 어떤 칸은 높을수록 좋고 어떤 칸은 나쁘면 숫자를 비교할 수 없다. */
const PHRASE: Record<string, string> = {
  // 기대값
  "득점 기대값": "득점에서 앞설",
  "실점 기대값": "실점을 덜 할",
  // 흐름
  "역전 빈도": "뒤진 상황을 뒤집을",
  "리드 유지율": "앞선 리드를 지킬",
  "연장 승부 이력": "연장까지 가서도 버틸",
  // 축구
  "점유율": "공을 더 오래 소유할",
  "슈팅 수": "슈팅을 더 많이 만들",
  "유효슈팅": "유효슈팅에서 앞설",
  "코너킥": "코너킥을 더 얻어낼",
  "PK 성공률": "페널티킥을 살릴",
  "세트피스 비중": "세트피스로 승부를 볼",
  "전반 득점": "전반에 먼저 앞서갈",
  "후반 득점": "후반에 몰아칠",
  "파울 수": "파울을 덜 범할",
  "경고 누적": "경고를 덜 받을",
  // 야구
  "안타": "안타 싸움에서 앞설",
  "도루": "주루로 흔들",
  "실책": "실책을 덜 범할",
  "삼진": "삼진 싸움에서 앞설",
  "볼넷": "볼넷 싸움에서 앞설",
  "타율": "타격에서 앞설",
  "홈런": "한 방을 터뜨릴",
  "평균자책점": "실점을 덜 허용할",
  // 재미 — 근거가 약한 대신 읽는 재미가 있다. 문장도 그 톤으로 쓴다.
  "오늘의 운세": "오늘 운이 따를",
  "날씨 궁합": "오늘 날씨와 궁합이 맞을",
  "징크스": "징크스를 깨고 웃을",
  "요일 운": "이 요일에 강한 모습을 보일",
  // 농구
  "리바운드": "리바운드 싸움에서 앞설",
  "어시스트": "패스로 경기를 풀",
  "턴오버": "턴오버를 덜 범할",
  "3점 성공률": "외곽슛을 살릴",
  "자유투 성공률": "자유투를 살릴",
};

export function phraseOf(col: string): string {
  return PHRASE[col] ?? `${col} 관점에서 앞설`;
}

/** 조건 슬롯. 겹친 조건은 "비 오고 라이벌전일 때"처럼 이어 붙인다. */
function condPhrase(cond: string): string {
  const parts = condParts(cond);
  if (!parts.length) return "";
  return parts.join(" · ") + "일 때, ";
}

/* ── 조사 ──────────────────────────────────────────────────
   "원정팀가"처럼 틀린 조사가 나오면 문장 전체가 싸구려로 읽힌다.
   한글 음절은 유니코드로 종성을 계산할 수 있다: (코드 - 0xAC00) % 28 != 0 이면 받침 있음.
   숫자·영문으로 끝나는 축 이름(3점 성공률, PK 성공률)도 있으므로 그쪽도 받아준다. */
const DIGIT_CODA: Record<string, boolean> = {
  "0": false, "1": true, "3": true, "6": true, "7": true, "8": true,
  "2": false, "4": false, "5": false, "9": false,
};

function hasCoda(word: string): boolean {
  const ch = word.trim().slice(-1);
  if (!ch) return false;
  if (ch >= "0" && ch <= "9") return DIGIT_CODA[ch] ?? false;
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  return /[a-zA-Z]/.test(ch) ? true : false;   // 영문은 받침 있는 것으로 읽는다(필름/슛 등)
}

/** 받침에 맞는 조사. josa("음바페","가") → "가", josa("원정팀","가") → "이" */
export function josa(word: string, kind: "가" | "는" | "를"): string {
  const coda = hasCoda(word);
  if (kind === "가") return coda ? "이" : "가";
  if (kind === "는") return coda ? "은" : "는";
  return coda ? "을" : "를";
}

export type Slots = { cond: string; row: string; col: string; scope?: string | null };

/**
 * 셀 문장.
 *   주체형  "비일 때, 음바페가 득점에서 앞설 확률"
 *   요인형  "비일 때, 최근 5경기 폼만 놓고 보면 홈팀이 득점에서 앞설 확률"
 */
export function sentenceOf({ cond, row, col }: Slots): string {
  const head = condPhrase(cond);
  const phrase = phraseOf(col);
  return isFactorRow(row)
    ? `${head}${row}만 놓고 보면 홈팀이 ${phrase} 확률`
    : `${head}${row}${josa(row, "가")} ${phrase} 확률`;
}

/** AI에게 주는 한 줄. 문장이 곧 질문이다. */
export function promptLineOf(i: number, s: Slots): string {
  const scope = s.scope ? ` (${s.scope})` : "";
  return `${i}. ${sentenceOf(s)}${scope}`;
}
