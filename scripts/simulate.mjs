// 사용 시뮬레이션 — 유저 유형별로 실제 API를 때려 본다.
//
// 글로 쓴 페르소나는 문제를 못 찾는다. 실제로 돌려야 "이 유저는 화면의 절반이 —로
// 보인다", "저 유저는 첫 진입에 2분을 기다린다" 같은 것이 숫자로 나온다.
//
//   node scripts/simulate.mjs            전원
//   node scripts/simulate.mjs 초보       한 명만
//   SIM_BASE=http://localhost:3000 SIM_KEEP=1 node scripts/simulate.mjs
//     SIM_KEEP=1 이면 만들어진 박스·선언을 지우지 않는다(기본은 정리).

const BASE = process.env.SIM_BASE ?? "http://localhost:3000";

const post = (path, body) =>
  fetch(BASE + path, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e) }));

/* ── 유저 유형 ──────────────────────────────────────────────
   실제로 다를 만한 축: 들어오는 화면, 고르는 축의 성격, 조건을 쓰는지,
   경기에 들어가는지, 모르는 칸을 만났을 때 요청하는지. */

const P = {
  초보: {
    설명: "처음 들어옴. 기본값 그대로 두고 둘러보기만 한다",
    화면: "메인",
    rows: ["홈팀", "원정팀", "최근 5경기 폼", "상대 전적"],
    cols: ["득점 기대값", "실점 기대값", "역전 빈도", "오늘의 운세"],
    cond: "", 경기: null, 요청: false,
  },
  축구덕후: {
    설명: "축구 경기에 들어가 세부 지표를 깊게 본다",
    화면: "경기",
    rows: ["홈팀", "원정팀", "주전 공격수", "주전 골키퍼", "음바페", "그리즈만"],
    cols: ["유효슈팅", "점유율", "코너킥", "세트피스 비중", "PK 성공률"],
    cond: "", 경기: "m-fra-mar", 요청: true,
  },
  야구덕후: {
    설명: "야구 선수 축을 많이 세운다. 모르는 선수가 많이 나올 것이다",
    화면: "경기",
    rows: ["홈팀", "원정팀", "야마카와", "겐다", "모리", "다카하시", "아사무라"],
    cols: ["안타", "삼진", "홈런", "타율"],
    cond: "", 경기: "m-sei-rak", 요청: true,
  },
  재미유저: {
    설명: "예측엔 관심 없고 운세·궁합만 본다",
    화면: "메인",
    rows: ["음바페", "그리즈만", "지루", "프랑스", "모로코"],
    cols: ["오늘의 운세", "날씨 궁합", "징크스", "요일 운"],
    cond: "", 경기: null, 요청: false,
  },
  예측러: {
    설명: "조건을 겹쳐 걸고 발광을 본다. 가장 무겁게 쓰는 유형",
    화면: "경기",
    rows: ["홈팀", "원정팀", "최근 5경기 폼", "선제골 여부", "벤치 뎁스"],
    cols: ["득점 기대값", "역전 빈도", "리드 유지율", "유효슈팅"],
    cond: "비·라이벌전", 경기: "m-fra-mar", 요청: true,
  },
  상황파: {
    설명: "날씨·상황을 행과 열 양쪽에 세운다(새로 열린 쓰임)",
    화면: "메인",
    rows: ["비", "추격 중", "라이벌전", "프랑스"],
    cols: ["득점 기대값", "비", "만원 관중"],
    cond: "", 경기: null, 요청: false,
  },
  라이트: {
    설명: "열었다가 바로 나간다. 첫 화면 속도만이 전부",
    화면: "메인",
    rows: ["홈팀", "원정팀"],
    cols: ["득점 기대값", "실점 기대값"],
    cond: "", 경기: null, 요청: false, 짧게: true,
  },
};

const pairsOf = (rows, cols, ctx) => {
  const out = [];
  rows.forEach((r, i) => cols.forEach((c, j) => {
    if (r === c) return;                       // 같은 이름은 애초에 못 고른다
    out.push({ row: { id: "r" + i, name: r, ctx }, col: { id: "c" + j, name: c, ctx } });
  }));
  return out;
};

async function runOne(name, p, matches) {
  const m = p.경기 ? matches.find((x) => x.id === p.경기) : null;
  const ctx = m ? m.ctx : null;
  const pairs = pairsOf(p.rows, p.cols, ctx);

  const t0 = Date.now();
  const cell = await post("/api/cells", { matchId: p.경기, cond: p.cond, pairs });
  const firstMs = Date.now() - t0;
  if (!cell.ok) return { name, error: cell.error ?? "cells 실패" };

  const n = (k) => cell.cells.filter((c) => c.from === k).length;
  const dash = cell.cells.filter((c) => c.value === "—");   // 캐시된 모름도 모름이다

  const r = {
    name, 설명: p.설명, 화면: p.화면, 칸: pairs.length,
    첫진입ms: firstMs,
    캐시: n("cache"), 유도: n("derived"), AI: n("ai"),
    모름: dash.length, 실패: n("failed"), 차단: n("blocked"),
    발광: null, 재진입ms: null, 요청: 0,
  };

  // 경기에 들어간 유저는 발광까지 본다
  if (p.경기 && !p.짧게) {
    const cands = cell.cells
      .map((c, i) => ({ rowId: c.rowId, colId: c.colId, row: pairs[i].row.name, col: pairs[i].col.name, value: c.value }))
      .filter((c) => c.value !== "—");
    if (cands.length) {
      const g = await post("/api/glow", {
        matchId: p.경기, boxId: `sim_${name}`, boxName: `시뮬 ${name}`, cond: p.cond, cells: cands,
      });
      r.발광 = g.ok ? (g.cells?.length ?? 0) : "실패";
      r.요약 = g.line ?? "";
    }
  }

  // 모르는 칸을 만나면 요청하는 유형
  if (p.요청 && dash.length) {
    const target = dash.slice(0, 2);
    for (const d of target) {
      const i = cell.cells.indexOf(d);
      const a = await post("/api/ask", {
        matchId: p.경기, cond: p.cond,
        row: { id: "r", name: pairs[i].row.name }, col: { id: "c", name: pairs[i].col.name },
      });
      if (a.ok) r.요청 += 1;
      if (a.resolved) r.요청해결 = (r.요청해결 ?? 0) + 1;
    }
  }

  // 같은 화면을 다시 열면 얼마나 빠른가 (실제 재방문)
  const t1 = Date.now();
  await post("/api/cells", { matchId: p.경기, cond: p.cond, pairs });
  r.재진입ms = Date.now() - t1;

  return r;
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

(async () => {
  const w = await fetch(BASE + "/api/warm").then((r) => r.json()).catch(() => null);
  const ids = w?.ok ? w.matches : [];
  const ctxMap = {
    "m-fra-mar": "프랑스·모로코", "m-sei-rak": "세이부·라쿠텐",
    "m-aus-kaz": "호주·카자흐스탄", "m-nzb-syd": "뉴질랜드 브레이커스·시드니 킹스",
  };
  const matches = ids.map((x) => ({ ...x, ctx: ctxMap[x.id] }));

  const only = process.argv[2];
  const names = only ? [only] : Object.keys(P);
  const rows = [];

  for (const name of names) {
    if (!P[name]) { console.error("없는 유형:", name); continue; }
    process.stdout.write(`  ${pad(name, 8)} 돌리는 중…\r`);
    rows.push(await runOne(name, P[name], matches));
  }

  console.log("\n유저 유형별 사용 시뮬레이션\n");
  console.log("  유형      화면   칸   첫진입   재진입   캐시 유도  AI  모름 차단  발광  요청");
  console.log("  " + "─".repeat(76));
  for (const r of rows) {
    if (r.error) { console.log(`  ${pad(r.name, 8)} 실패: ${r.error}`); continue; }
    console.log(
      `  ${pad(r.name, 8)} ${pad(r.화면, 5)} ${num(r.칸, 3)} ${num((r.첫진입ms / 1000).toFixed(1) + "s", 7)} ` +
      `${num((r.재진입ms / 1000).toFixed(1) + "s", 7)} ${num(r.캐시, 5)}${num(r.유도, 5)}${num(r.AI, 4)}` +
      `${num(r.모름, 6)}${num(r.차단, 5)}${num(r.발광 ?? "-", 6)}${num(r.요청, 6)}`
    );
  }

  console.log("\n유형별 체감\n");
  for (const r of rows) {
    if (r.error) continue;
    const filled = r.칸 - r.모름;   // 실패·차단도 "—"로 보이므로 모름에 이미 포함된다
    const pct = Math.round((filled / r.칸) * 100);
    console.log(`  ${pad(r.name, 8)} ${r.설명}`);
    console.log(`           화면의 ${pct}%가 값으로 찬다 (${filled}/${r.칸}) · 첫 진입 ${(r.첫진입ms / 1000).toFixed(1)}초 · 재방문 ${(r.재진입ms / 1000).toFixed(1)}초`);
    if (r.요약) console.log(`           발광: ${r.요약}`);
    if (r.요청) console.log(`           데이터 요청 ${r.요청}건${r.요청해결 ? ` (${r.요청해결}건 해결)` : ""}`);
    console.log("");
  }
})();
