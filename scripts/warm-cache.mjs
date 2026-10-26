// 조합 캐시 예열 드라이버.
//   node scripts/warm-cache.mjs            전체(메인 + 전 경기)
//   node scripts/warm-cache.mjs global     메인(경기 무관) 조합만
//   node scripts/warm-cache.mjs match m-fra-mar
//
// 로컬 dev 서버가 떠 있어야 하고, .env.local에 CLAUDE_CLI=1 이어야 한다(구독으로 돌린다).
// 프로덕션은 이 캐시를 읽기만 한다 — DB가 같으므로 여기서 깔면 거기서 바로 쓴다.

const BASE = process.env.WARM_BASE ?? "http://localhost:3001";
const LIMIT = Number(process.env.WARM_LIMIT ?? 60);
const CONC = Number(process.env.WARM_CONC ?? 2);   // 동시 배치 수

const post = (body) =>
  fetch(BASE + "/api/warm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((r) => r.json())
    .catch(() => null);

const bar = (done, total) => {
  const w = 24, n = Math.round((done / total) * w);
  return "[" + "#".repeat(n) + "-".repeat(w - n) + "] " + String(Math.floor((done / total) * 100)).padStart(3) + "%";
};

async function warm(scope, matchId, label) {
  // 배치를 여러 개 동시에 돌린다. CLI 기동 비용이 대부분이라 병렬로 짧아진다.
  const probe = await post({ scope, matchId, offset: 0, limit: 1 });
  if (!probe?.ok) { console.error("  실패:", probe?.error); return null; }
  const total = probe.total;
  if (!total) { console.log(`  ${label} 대상 없음`); return null; }

  let next = 0, done = 0, cache = probe.cache, ai = probe.ai, failed = probe.failed;
  let deadBatches = 0, stopped = false, lastError = null;
  const t0 = Date.now();
  const draw = () =>
    process.stdout.write(`
  ${label} ${bar(done, total)} ${done}/${total} · 캐시 ${cache} · AI ${ai} · 실패 ${failed}   `);

  async function worker() {
    for (;;) {
      const offset = next;
      next += LIMIT;
      if (offset >= total) return;
      const d = await post({ scope, matchId, offset, limit: LIMIT });
      if (d?.ok) {
        cache += d.cache; ai += d.ai; failed += d.failed;
        // 산출이 통째로 안 되면 한도에 걸렸다는 뜻 — 계속 돌려봐야 빈 칸만 늘어난다.
        if (d.failed === d.cache + d.ai + d.failed && d.failed > 0) deadBatches++;
        else deadBatches = 0;
      } else {
        failed += LIMIT;
        deadBatches++;
        if (lastError !== d?.error && d?.error) { lastError = d.error; }
      }
      if (deadBatches >= 3) { stopped = true; return; }
      if (stopped) return;
      done = Math.min(done + LIMIT, total);
      draw();
    }
  }

  draw();
  await Promise.all(Array.from({ length: CONC }, worker));
  const secs = Math.round((Date.now() - t0) / 1000);
  if (stopped) {
    process.stdout.write(`
  ⚠ 산출이 연속으로 실패해 멈춥니다${lastError ? " — " + lastError : " — 구독 사용량 한도일 수 있습니다"}.
`);
    return { total, cache, ai, failed, stopped: true };
  }
  process.stdout.write(`
  ${label} ${bar(1, 1)} ${total}/${total} · 캐시 ${cache} · AI ${ai} · 실패 ${failed} · ${secs}초
`);
  return { total, cache, ai, failed };
}

const [, , arg1, arg2] = process.argv;

if (arg1 === "global") {
  await warm("global", undefined, "메인      ");
} else if (arg1 === "match" && arg2) {
  await warm("match", arg2, arg2.padEnd(10));
} else {
  const ms = await fetch(BASE + "/api/warm").then((r) => r.json()).catch(() => null);
  const ids = ms?.ok ? ms.matches.map((m) => m.id) : ["m-fra-mar", "m-sei-rak", "m-aus-kaz", "m-nzb-syd"];
  console.log("예열 시작 — 메인 + 경기", ids.length, "건\n");
  const g = await warm("global", undefined, "메인      ");
  if (g?.stopped) process.exit(1);
  for (const id of ids) {
    const r = await warm("match", id, id.padEnd(10));
    if (r?.stopped) process.exit(1);
  }
}
console.log("\n완료. 프로덕션은 이제 이 조합들을 캐시에서 읽습니다.");
