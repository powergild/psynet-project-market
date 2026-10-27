// 인물 정보 — 생년월일.
//
// 운세·궁합은 생년월일에서 계산된다. 생년월일이 없으면 계산할 수 없고,
// **없는 것을 지어내지 않는다.** 모르면 "—"가 되고 데이터 요청으로 간다.
//
// ⚠️ 여기 적힌 것은 널리 알려진 몇 명뿐이다. 나머지는 비어 있는 게 맞다 —
//    그럴듯한 날짜를 채워 넣으면 운세가 "계산된 값"이 아니라 거짓말이 된다.
//    LIVE스코어 선수 DB가 붙으면 이 레지스트리를 그쪽으로 교체한다(교체 지점).

export type Person = { birth: string };   // YYYY-MM-DD

const PEOPLE: Record<string, Person> = {
  "음바페":   { birth: "1998-12-20" },
  "그리즈만": { birth: "1991-03-21" },
  "뎀벨레":   { birth: "1997-05-15" },
  "지루":     { birth: "1986-09-30" },
  "추아메니": { birth: "2000-01-27" },
  "요리스":   { birth: "1986-12-26" },
};

export function birthOf(name: string): string | null {
  return PEOPLE[name]?.birth ?? null;
}

/** 생년월일을 아는 인물 수 — 관리자에서 커버리지를 본다. */
export function knownPeople(): number {
  return Object.keys(PEOPLE).length;
}
