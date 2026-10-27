"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  catalogFor, searchAxes, DEFAULT_ROWS, DEFAULT_COLS, NO_VALUE,
  CONDITIONS, NO_CONDITION, setGlobalPlayers, condKey, condParts, DETAIL_COLS, DETAIL_ROWS,
  type AxisDef, type AxisKind, type Sport,
} from "@/lib/axes";
import { recommendAxis, recommendForCell, type AxisOffer } from "@/lib/market";
import { balance, spend } from "@/lib/wallet";
import { sentenceOf } from "@/lib/sentence";
import SetupSheet from "@/components/SetupSheet";
import type { Match } from "@/lib/matches";

type Axis = { id: string; ax: string | null; ctx: string | null; src: string | null };
type Target = { kind: AxisKind; id: string } | null;
type GlowCell = { rowId: string; colId: string; why: string };
/** 셀 하나의 누적 성적. 격자에 올린 행·열이 곧 조각이므로 모든 셀에 붙는다. */
type TierInfo = { tier: string; trust: number | null; scored: number };
type Glow = { cells: GlowCell[]; line: string; ok: boolean };
type Term = { n: string; w: number };
type Formula = { rowId: string; colId: string; title: string; base: string; terms: Term[]; base0: number };
type CellRec = { rowId: string; colId: string; row: string; col: string; offer: AxisOffer & { hit: number } };
type Dialog = { msg: string; cost: string; ok: string; run: () => void };

const uid = () => Math.random().toString(36).slice(2, 9);
const ck = (r: string, c: string) => `${r}::${c}`;

/** 박스는 경기 단위로 분리 저장한다. 메인(경기 무관)과 경기별 박스는 서로 다른 박스다. */
const storeKey = (matchId: string | null) => `databox_v1:${matchId ?? "global"}`;
const boxId = (matchId: string | null) => `box_${matchId ?? "global"}`;

const mkAxes = (names: string[], ctx: string | null): Axis[] =>
  names.map((ax) => ({ id: uid(), ax, ctx, src: null }));

/** 승률 문자열을 비율로 다시 쓴다(계산식 조정 F-23). */
function reweigh(base: string, ratio: number): string {
  const n = parseFloat(base);
  if (!isFinite(n)) return base;
  return Math.min(95, Math.max(5, n * ratio)).toFixed(1) + "%";
}

/**
 * 데이터 박스.
 * - 메인(match=null): 경기에 묶이지 않은 내 박스. 발광하지 않는다.
 * - 경기 상세(match=…): 그 경기 전용 박스. 선수 축을 쓸 수 있고 발광 대상이 된다.
 */
export default function DataBox({
  match = null, players = [],
}: {
  match?: Match | null;
  /** 경기 밖에서 주체로 세울 수 있는 선수. 조각은 아무 팀 선수나 고를 수 있다. */
  players?: string[];
}) {
  const matchId = match?.id ?? null;
  const scope = match ? `${match.home}·${match.away}` : null;
  const sport = (match?.sport as Sport | undefined) ?? null;

  const [name, setName] = useState(match ? `${match.home}·${match.away} 박스` : "내 박스");
  const [rows, setRows] = useState<Axis[]>([]);
  const [cols, setCols] = useState<Axis[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<Target>(null);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [setup, setSetup] = useState(false);
  const [glow, setGlow] = useState<Glow | null>(null);
  const [tiers, setTiers] = useState<Record<string, TierInfo>>({});
  const [glowing, setGlowing] = useState(false);
  const [formula, setFormula] = useState<Formula | null>(null);
  const [cellRec, setCellRec] = useState<CellRec | null>(null);
  /** 모르는 대상의 칸. 재시도 대상이 아니라 정보 요청 대상이다. */
  const [ask, setAsk] = useState<{ r: Axis; c: Axis } | null>(null);
  const [asking, setAsking] = useState(false);
  const [ghost, setGhost] = useState<AxisOffer | null>(null);
  const [sco, setSco] = useState(120);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [cond, setCond] = useState<string>(NO_CONDITION);   // 박스 전체 조건(조각의 "조건")
  const [condOpen, setCondOpen] = useState(false);
  const condAtOpen = useRef("");

  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);
  const cellsRef = useRef<Record<string, string>>({});
  const wrapRef = useRef<HTMLDivElement>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), 2200);
  }, []);

  useEffect(() => { setSco(balance()); }, []);
  // 경기 밖 선수 풀을 축 카탈로그에 올린다(조각: 아무 팀 선수나 고를 수 있다).
  useEffect(() => { setGlobalPlayers(players); }, [players]);
  useEffect(() => { cellsRef.current = cells; }, [cells]);

  // ── 셀 계산 ──────────────────────────────────────
  const compute = useCallback(
    async (rs: Axis[], cs: Axis[], keep?: (r: Axis, c: Axis) => boolean) => {
      const pairs: { row: Axis; col: Axis }[] = [];
      for (const r of rs) {
        for (const c of cs) {
          if (!r.ax || !c.ax) continue;                       // (빈칸)은 계산하지 않는다
          if (keep && !keep(r, c)) continue;
          pairs.push({ row: r, col: c });
        }
      }
      if (!pairs.length) return;
      setPending(new Set(pairs.map((p) => ck(p.row.id, p.col.id))));

      // 서버가 통째로 실패해도 칸을 비워두지 않는다 — "—"여야 재시도 대상으로 집계된다.
      const out: { rowId: string; colId: string; value: string }[] = [];
      const CHUNK = 120;   // API 상한보다 낮게. 한 번에 넘기면 요청 전체가 거절된다.

      for (let i = 0; i < pairs.length; i += CHUNK) {
        const part = pairs.slice(i, i + CHUNK);
        let got: { rowId: string; colId: string; value: string }[] =
          part.map((p) => ({ rowId: p.row.id, colId: p.col.id, value: NO_VALUE }));
        try {
          const res = await fetch("/api/cells", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              matchId,
              cond,
              pairs: part.map((p) => ({
                row: { id: p.row.id, name: p.row.ax, ctx: p.row.ctx, src: p.row.src },
                col: { id: p.col.id, name: p.col.ax, ctx: p.col.ctx, src: p.col.src },
              })),
            }),
          });
          const d = await res.json();
          if (d.ok) got = d.cells;
        } catch { /* 배너가 안내한다 — 토스트는 사라져서 재시도 경로가 안 남는다 */ }
        out.push(...got);
      }

      const step = out.length > 12 ? 18 : 55;   // 순차로 확정되는 과정 자체가 제품 설명이 된다
      for (const cell of out) {
        await new Promise((r) => setTimeout(r, step));
        setCells((p) => { const n = { ...p, [ck(cell.rowId, cell.colId)]: cell.value }; cellsRef.current = n; return n; });
        setPending((p) => { const n = new Set(p); n.delete(ck(cell.rowId, cell.colId)); return n; });
      }
      setPending(new Set());
    },
    [matchId, cond, say]
  );

  // ── 복원 / 최초 생성 ─────────────────────────────
  useEffect(() => {
    if (ready.current) return;
    ready.current = true;
    try {
      const raw = window.localStorage.getItem(storeKey(matchId));
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.rows) && s.rows.length) {
          setRows(s.rows); setCols(s.cols ?? []); setCells(s.cells ?? {});
          if (s.name) setName(s.name);
          if (typeof s.cond === "string") setCond(s.cond);
          return;
        }
      }
    } catch { /* 저장소 없어도 동작해야 한다 */ }
    setSetup(true);                                // 빈 격자 대신 설문부터
  }, [matchId]);

  /** 설문 결과(또는 기본값)로 첫 격자를 만든다. */
  const start = useCallback((g: { rows: string[]; cols: string[] }) => {
    // 여기서 계산하지 않는다 — 화면을 채운 뒤 한 번에 계산해야 호출이 한 번으로 끝난다.
    setCells({}); setGlow(null);
    setRows(mkAxes(g.rows, scope)); setCols(mkAxes(g.cols, scope)); setSetup(false);
  }, [scope]);

  useEffect(() => {
    if (!rows.length) return;
    try {
      window.localStorage.setItem(storeKey(matchId), JSON.stringify({ name, cond, rows, cols, cells }));
    } catch {}
  }, [name, cond, rows, cols, cells, matchId]);

  // ── 화면 채우기 ──────────────────────────────────
  // 칸 크기는 고정이다. 남는 자리는 늘려서가 아니라 **항목을 더 넣어서** 채운다.
  useEffect(() => {
    if (!rows.length || !cols.length || pending.size) return;
    const wrap = wrapRef.current;
    const table = wrap?.querySelector("table") as HTMLTableElement | null;
    if (!wrap || !table) return;

    const bodyRow = table.querySelector("tbody tr") as HTMLElement | null;
    const rowH = bodyRow?.offsetHeight || 46;
    const heads = Array.from(table.querySelectorAll("thead th")) as HTMLElement[];
    const colW = Math.max(82, ...heads.slice(1, -1).map((e) => e.offsetWidth));

    // 상한을 둔다. 측정이 어긋나도 격자가 폭주하지 않아야 한다.
    const MAX_ROWS = 16, MAX_COLS = 8;
    const addR = Math.max(0, Math.min(
      MAX_ROWS - rows.length,
      Math.floor((wrap.clientHeight - table.offsetHeight) / rowH)
    ));
    const addC = Math.max(0, Math.min(
      MAX_COLS - cols.length,
      Math.floor((wrap.clientWidth - table.offsetWidth) / colW)
    ));

    const used = new Set([...rows, ...cols].map((a) => a.ax));
    const pool = (kind: AxisKind, n: number) =>
      catalogFor(kind, match?.players, sport, match ? "detail" : "top")
        .flatMap((g) => g.items.map((i) => i.name))
        .filter((x) => !used.has(x))
        .slice(0, n);

    const nr = addR ? [...rows, ...mkAxes(pool("row", addR), scope)] : rows;
    const nc = addC ? [...cols, ...mkAxes(pool("col", addC), scope)] : cols;
    const grew = nr.length !== rows.length || nc.length !== cols.length;
    if (grew) { setRows(nr); setCols(nc); }

    // 빈 셀이 남아 있으면 채운다. 커졌으면 다음 턴에 다시 재서 남은 자리까지 메운다.
    const missing = (r: Axis, c: Axis) => cellsRef.current[ck(r.id, c.id)] === undefined;
    if (nr.some((r) => nc.some((c) => r.ax && c.ax && missing(r, c)))) {
      void compute(nr, nc, missing);
    }
  }, [rows, cols, pending.size, compute, match?.players, scope, sport]);

  // ── F-05 발광 ────────────────────────────────────
  const analyze = useCallback(async () => {
    if (!matchId || pending.size) return;
    const cands = [];
    for (const r of rows) {
      for (const c of cols) {
        const v = cells[ck(r.id, c.id)];
        if (!r.ax || !c.ax || !v || v === NO_VALUE) continue;
        cands.push({ rowId: r.id, colId: c.id, row: r.ax, col: c.ax, value: v });
      }
    }
    if (!cands.length) return;
    setGlowing(true); setGlow(null); setCellRec(null);
    try {
      const res = await fetch("/api/glow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId, boxId: boxId(matchId), boxName: name, cond, cells: cands }),
      });
      const d = await res.json();
      if (d.ok) {
        setGlow({ cells: d.cells ?? [], line: d.line ?? "", ok: d.analyzed !== false });
        setTiers(Object.fromEntries(
          (d.tiers ?? []).map((t: TierInfo & { rowId: string; colId: string }) =>
            [ck(t.rowId, t.colId), { tier: t.tier, trust: t.trust, scored: t.scored }])
        ));
        // F-20 격자 하단 추천 행 — 내가 아직 안 가진 축 하나
        const mine = [...rows, ...cols].map((a) => a.ax).filter(Boolean) as string[];
        setGhost(recommendAxis(mine, matchId));
      } else setGlow({ cells: [], line: "", ok: false });
    } catch { setGlow({ cells: [], line: "", ok: false }); }
    setGlowing(false);
  }, [matchId, rows, cols, cells, pending.size, name, cond, say]);

  // 경기 안에서 격자가 다 채워지면 바로 읽는다. 유저가 버튼을 누를 일이 아니다.
  const analyzedFor = useRef<string>("");
  useEffect(() => {
    if (!matchId || pending.size || !rows.length) return;
    const sig = rows.map((r) => r.id).join() + "|" + cols.map((c) => c.id).join() + "|" + Object.keys(cells).length;
    if (analyzedFor.current === sig) return;
    analyzedFor.current = sig;
    void analyze();
  }, [matchId, pending.size, rows, cols, cells, analyze]);

  // ── 축 조작 ──────────────────────────────────────
  const addBlank = (kind: AxisKind) => {
    const a: Axis = { id: uid(), ax: null, ctx: scope, src: null };
    if (kind === "row") setRows((p) => [...p, a]); else setCols((p) => [...p, a]);
    setTarget({ kind, id: a.id }); setQ("");
  };

  const pickAxis = (def: AxisDef) => {
    if (!target) return;
    const { kind, id } = target;
    const apply = (l: Axis[]) => l.map((a) => (a.id === id ? { ...a, ax: def.name, ctx: scope } : a));
    const nr = kind === "row" ? apply(rows) : rows;
    const nc = kind === "col" ? apply(cols) : cols;
    setRows(nr); setCols(nc); setTarget(null); setGlow(null);
    void compute(nr, nc, (r, c) => (kind === "row" ? r.id === id : c.id === id));
  };

  const removeAxis = (kind: AxisKind, id: string) => {
    if (kind === "row") setRows((p) => p.filter((a) => a.id !== id));
    else setCols((p) => p.filter((a) => a.id !== id));
    setCells((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.includes(id))));
    setTarget(null); setGlow(null);
  };

  /** 축 하나를 SCO로 사서 내 격자에 올린다(F-20/F-22). 같은 축이어도 출처가 다르면 새 행이다(F-14). */
  const buyAxis = (offer: AxisOffer, memo: string) => {
    if (sco < offer.price) { say("SCO가 부족합니다."); return; }
    setDialog({
      msg: `“${offer.ax}”을 ${offer.src}의 관점으로 ${memo}`,
      cost: `${offer.price} SCO 차감 · 남은 SCO ${sco - offer.price}`,
      ok: "추가하기",
      run: () => {
        const left = spend(offer.price, `축 추가 · ${offer.ax}`);
        if (left === null) { say("SCO가 부족합니다."); return; }
        setSco(left);
        const a: Axis = { id: uid(), ax: offer.ax, ctx: scope, src: offer.src };
        const nr = offer.kind === "row" ? [...rows, a] : rows;
        const nc = offer.kind === "col" ? [...cols, a] : cols;
        setRows(nr); setCols(nc); setGhost(null); setCellRec(null); setGlow(null);
        say(`${offer.price} SCO 사용 · 축 추가`);
        void compute(nr, nc, (r, c) => (offer.kind === "row" ? r.id === a.id : c.id === a.id));
      },
    });
  };

  // ── F-15 업그레이드 (중복 축 병합) ────────────────
  const dupes = (() => {
    const n: Record<string, number> = {};
    [...rows, ...cols].forEach((a) => { if (a.ax) n[a.ax] = (n[a.ax] ?? 0) + 1; });
    return Object.keys(n).filter((k) => n[k] > 1);
  })();

  const upgrade = () => {
    const cost = dupes.length * 15;
    setDialog({
      msg: `중복 축 ${dupes.length}종을 하나로 병합합니다.`,
      cost: `${cost} SCO 차감 · 남은 SCO ${sco - cost}`,
      ok: "업그레이드",
      run: () => {
        const left = spend(cost, `업그레이드 · ${dupes.length}종`);
        if (left === null) { say("SCO가 부족합니다."); return; }
        setSco(left);
        const squash = (l: Axis[], seen: Set<string>) =>
          l.filter((a) => {
            if (!a.ax || !dupes.includes(a.ax)) return true;
            if (seen.has(a.ax)) return false;
            seen.add(a.ax); return true;
          }).map((a) => (a.ax && dupes.includes(a.ax) ? { ...a, src: "업그레이드" } : a));
        const seen = new Set<string>();
        const nr = squash(rows, seen);
        const nc = squash(cols, seen);
        setRows(nr); setCols(nc); setGlow(null);
        say("업그레이드 완료");
        void compute(nr, nc, (r, c) => cellsRef.current[ck(r.id, c.id)] === undefined);
      },
    });
  };

  // ── F-23 계산식 패널 ─────────────────────────────
  const openFormula = (r: Axis, c: Axis) => {
    const base = cells[ck(r.id, c.id)];
    if (!base || base === NO_VALUE || !r.ax || !c.ax) return;
    const terms: Term[] = [
      { n: r.ax, w: 55 }, { n: c.ax, w: 45 },
      { n: "최근 5경기 가중", w: 30 }, { n: "표본 보정", w: 20 },
    ];
    setFormula({
      rowId: r.id, colId: c.id,
      title: sentenceOf({ cond, row: r.ax, col: c.ax }),   // 조각 이름 = 그 셀이 묻는 문장
      base, terms,
      base0: terms.reduce((a, b) => a + b.w, 0),
    });
  };

  const applyFormula = () => {
    if (!formula) return;
    const now = formula.terms.reduce((a, b) => a + b.w, 0);
    const v = reweigh(formula.base, now / formula.base0);
    setCells((p) => ({ ...p, [ck(formula.rowId, formula.colId)]: v }));
    setFormula(null); say("계산식 조정 완료");
  };

  /**
   * 조건은 겹칠 수 있다 — "비 오는 날 + 지고 있을 때"처럼.
   * 반드시 함수형으로 갱신한다. 그냥 cond를 읽으면 연속으로 누를 때 앞 선택이 날아간다.
   */
  const toggleCond = (item: string) => {
    setCond((prev) => {
      const cur = condParts(prev);
      return condKey(cur.includes(item) ? cur.filter((x) => x !== item) : [...cur, item]);
    });
  };

  /**
   * 고르는 동안에는 다시 계산하지 않고, 시트를 닫을 때 한 번만 한다 —
   * 조건 하나 누를 때마다 격자 전체를 다시 계산하면 느리고 비싸다.
   */
  const closeCond = () => {
    setCondOpen(false);
    if (cond === condAtOpen.current) return;
    setCells({});                       // 전제가 바뀌었다 — 옛 값을 들고 있으면 거짓말이 된다
    setGlow(null);
    say(cond ? `조건: ${condParts(cond).join(" + ")}` : "조건을 해제했습니다.");
  };

  /**
   * 한 칸만 다시 묻는다.
   * 격자 전체를 한 번에 물으면 모델의 주의가 흩어진다 — 한 칸만 떼어 물으면 달라질 여지가 있다.
   * 그래도 모른다고 하면 요청으로 쌓이고, 그 목록이 데이터 연동의 우선순위가 된다.
   */
  const requestInfo = async () => {
    if (!ask || asking) return;
    const { r, c } = ask;
    setAsking(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchId, cond,
          row: { id: r.id, name: r.ax, ctx: r.ctx, src: r.src },
          col: { id: c.id, name: c.ax, ctx: c.ctx, src: c.src },
        }),
      });
      const d = await res.json();
      if (d.ok && d.resolved) {
        setCells((p) => ({ ...p, [ck(r.id, c.id)]: d.value }));
        say("값을 찾았습니다.");
      } else {
        say("데이터를 요청했습니다.");
      }
    } catch { say("요청에 실패했습니다."); }
    setAsking(false);
    setAsk(null);
  };

  const onCellTap = (r: Axis, c: Axis) => {
    // 값이 없는 칸은 계산식이 없다. 설명 대신 요청을 받는다.
    if (cells[ck(r.id, c.id)] === NO_VALUE) { setAsk({ r, c }); return; }

    const lit = glow?.cells.some((g) => g.rowId === r.id && g.colId === c.id);
    if (lit && r.ax && c.ax) {
      // 발광 셀은 추천 패널이 우선이다(F-22) — 지금 유효하다고 판단된 지점에서만 더 파고들 이유가 생긴다.
      const mineSrc = [...rows, ...cols].map((a) => a.src).filter(Boolean) as string[];
      const offer = recommendForCell(r.ax, c.ax, mineSrc);
      if (offer) { setCellRec({ rowId: r.id, colId: c.id, row: r.ax, col: c.ax, offer }); return; }
    }
    openFormula(r, c);
  };

  // 메인은 상위 개념, 경기 상세는 세부 지표까지 — 다루는 층위가 다르다.
  const level = match ? "detail" : "top";
  const groups = target
    ? searchAxes(catalogFor(target.kind, match?.players, sport, level), q)
    : [];
  const targetHasAxis = !!target && [...rows, ...cols].find((a) => a.id === target.id)?.ax;
  const glowWhy = (rowId: string, colId: string) =>
    glow?.cells.find((g) => g.rowId === rowId && g.colId === colId)?.why;

  if (setup) {
    return (
      <SetupSheet
        sport={sport}
        players={match?.players}
        onDone={start}
        onSkip={() => start(
          sport
            ? { rows: DETAIL_ROWS, cols: DETAIL_COLS[sport] }   // 경기 안 = 세부 지표
            : { rows: DEFAULT_ROWS, cols: DEFAULT_COLS }        // 메인 = 상위 개념
        )}
      />
    );
  }

  return (
    <>
      <button className="condbar" onClick={() => { condAtOpen.current = cond; setCondOpen(true); }}>
        <span className="cb-l">조건</span>
        <span className={`cb-v${cond ? " on" : ""}`}>
          {cond ? condParts(cond).join(" + ") : "없음 (평상시)"}
        </span>
        <span className="cb-c">바꾸기</span>
      </button>

      {pending.size > 0 && <div className="statusline">셀을 채우는 중 · {pending.size}칸 남음</div>}
      {!pending.size && glowing && <div className="statusline">이 경기를 읽는 중…</div>}
      {!pending.size && !glowing && glow && (
        <div className={`statusline${glow.cells.length ? "" : " soft"}`}>
          {!glow.ok
            ? "이 경기를 읽지 못했습니다. 잠시 후 다시 시도해주세요."
            : glow.cells.length
              ? `${glow.cells.length}개 셀이 반응했습니다 · ${glow.line}`
              : "이 경기와 맞는 축이 아직 없습니다."}
        </div>
      )}

      {dupes.length > 0 && (
        <button className="upbanner" onClick={upgrade}>
          중복 축 {dupes.length}종 · 하나로 병합하기 <span className="cost">{dupes.length * 15} SCO</span>
        </button>
      )}

      <div className="boxmain">
        <div className="gridwrap" ref={wrapRef}>
          <Grid
            rows={rows} cols={cols} cells={cells} pending={pending} scope={scope}
            glowIds={glow?.cells.map((g) => ck(g.rowId, g.colId)) ?? []}
            dim={!!glow && glow.cells.length > 0}
            ghost={ghost}
            onPickTarget={(t) => { setTarget(t); setQ(""); }}
            onAdd={addBlank}
            onCell={onCellTap}
            onGhost={() => ghost && buyAxis(ghost, "내 박스에 추가합니다.")}
          />
        </div>

      </div>


      {/* ── 축 선택 시트 ── */}
      {target && (
        <>
          <div className="scrim" onClick={() => setTarget(null)} />
          <div className="sheet" role="dialog" aria-label="축 고르기">
            <div className="grab"><i /></div>
            <div className="shead">
              <span className="bname">{target.kind === "row" ? "기준 고르기" : "지표 고르기"}</span>
              <span className="chip">{target.kind === "row" ? "행" : "열"}</span>
              <span className="spacer" />
              {targetHasAxis && (
                <button className="btn danger" onClick={() => removeAxis(target.kind, target.id)}>삭제</button>
              )}
              <button className="btn" onClick={() => setTarget(null)}>닫기</button>
            </div>
            <div className="axsearch">
              <input value={q} onChange={(e) => setQ(e.target.value)}
                     placeholder={target.kind === "row" ? "기준 이름으로 찾기" : "지표 이름으로 찾기"}
                     autoComplete="off" />
            </div>
            <div className="sbody">
              {groups.length === 0 && (
                <div className="empty-state">검색 결과가 없습니다.<br />다른 이름으로 찾아보세요.</div>
              )}
              {groups.map((g) => (
                <div className="axgroup" key={g.category}>
                  <div className="gl">{g.category}</div>
                  {g.items.map((it) => (
                    <button className="axitem" key={g.category + it.name} onClick={() => pickAxis(it)}>
                      <span className="r" />
                      <span>{it.name}</span>
                      {it.scope === "match" && <span className="tag">이 경기</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── 정보 요청 — 모르는 대상의 칸 ── */}
      {ask && (
        <>
          <div className="scrim" onClick={() => setAsk(null)} />
          <div className="sheet asksheet" role="dialog" aria-label="정보 요청">
            <div className="grab"><i /></div>
            <div className="shead stack">
              <span className="bname wrap">
                {sentenceOf({ cond, row: ask.r.ax ?? "", col: ask.c.ax ?? "" })}
              </span>
              <span className="spacer" />
              <button className="btn" onClick={() => setAsk(null)}>닫기</button>
            </div>
            {/* 설명을 붙이지 않는다. 문장과 버튼 하나면 무엇을 하는지 알 수 있다. */}
            <div className="sfoot">
              <button className="btn pri grow" disabled={asking} onClick={() => { void requestInfo(); }}>
                {asking ? "찾아보는 중…" : "데이터 요청하기"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── 조건 고르기 (조각의 "조건") ── */}
      {condOpen && (
        <>
          <div className="scrim" onClick={closeCond} />
          <div className="sheet" role="dialog" aria-label="조건 고르기">
            <div className="grab"><i /></div>
            <div className="shead">
              <span className="bname">조건 고르기</span>
              <span className="spacer" />
              <button className="btn pri" onClick={closeCond}>적용</button>
            </div>
            <p className="shint">
              박스 전체에 걸립니다. “비 오는 날 음바페가 득점 관점에서 유리할 확률”처럼
              <b> 값의 전제</b>가 바뀝니다. 여러 개를 겹쳐 걸 수 있고,
              겹칠수록 맞았을 때 조각이 더 자랍니다.
            </p>
            <div className="sbody">
              <div className="pickgrid">
                <button className={`pick${cond ? "" : " on"}`} onClick={() => setCond(NO_CONDITION)}>
                  없음 (평상시)
                </button>
              </div>
              {CONDITIONS.map((g) => (
                <div className="axgroup" key={g.category}>
                  <div className="gl">{g.category}</div>
                  <div className="pickgrid">
                    {g.items.map((it) => (
                      <button key={it} className={`pick${condParts(cond).includes(it) ? " on" : ""}`}
                              onClick={() => toggleCond(it)}>
                        {it}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ── F-23 계산식 패널 ── */}
      {formula && (
        <>
          <div className="scrim" onClick={() => setFormula(null)} />
          <div className="sheet fsheet" role="dialog" aria-label="계산식">
            <div className="grab"><i /></div>
            <div className="shead stack">
              <span className="bname wrap">{formula.title}</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setFormula(null)}>닫기</button>
            </div>
            <div className="fnow">
              <span className="fv num">
                {reweigh(formula.base, formula.terms.reduce((a, b) => a + b.w, 0) / formula.base0)}
              </span>
              <span className="fbase">조정 전 {formula.base}</span>
            </div>
            <div className="sbody">
              {formula.terms.map((t, i) => (
                <label className="frow" key={t.n}>
                  <span className="fn">{t.n}</span>
                  <input type="range" min={0} max={100} value={t.w}
                         onChange={(e) => {
                           const w = Number(e.target.value);
                           setFormula((f) => f && {
                             ...f, terms: f.terms.map((x, j) => (j === i ? { ...x, w } : x)),
                           });
                         }} />
                  <span className="fw num">{t.w}</span>
                </label>
              ))}
            </div>
            <div className="sfoot">
              <span className="spacer" />
              <button className="btn pri" onClick={applyFormula}>적용</button>
            </div>
          </div>
        </>
      )}

      {/* ── F-22 발광 셀 추천 ── */}
      {cellRec && (
        <>
          <div className="scrim" onClick={() => setCellRec(null)} />
          <div className="sheet rsheet" role="dialog" aria-label="추천">
            <div className="grab"><i /></div>
            <div className="shead">
              <span className="bname wrap">
                {sentenceOf({ cond, row: cellRec.row, col: cellRec.col })}
              </span>
              <span className="chip amber">발광</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setCellRec(null)}>닫기</button>
            </div>
            <p className="shint">{glowWhy(cellRec.rowId, cellRec.colId)}</p>
            {(() => {
              const t = tiers[ck(cellRec.rowId, cellRec.colId)];
              if (!t?.scored) return null;
              return (
                <p className="shint">
                  이 조각: <b>{tiers[ck(cellRec.rowId, cellRec.colId)]?.tier ?? "일반"}</b> 등급 ·
                  누적 {tiers[ck(cellRec.rowId, cellRec.colId)]?.scored ?? 0}회 채점 ·
                  보정 적중 {tiers[ck(cellRec.rowId, cellRec.colId)]?.trust ?? "-"}%
                </p>
              );
            })()}
            <div className="sbody">
              <div className="reccard">
                <div className="rc-t">{cellRec.offer.src}의 “{cellRec.offer.ax}”</div>
                <div className="rc-s">적중률 {cellRec.offer.hit}% · 같은 축을 다른 계산식으로 하나 더 쌓습니다</div>
              </div>
            </div>
            <div className="sfoot">
              <button className="btn" onClick={() => { setCellRec(null); openFormulaById(cellRec, rows, cols, openFormula); }}>
                계산식 보기
              </button>
              <span className="spacer" />
              <button className="btn pri" onClick={() => buyAxis(cellRec.offer, "하나 더 추가합니다.")}>
                {cellRec.offer.price} SCO · 추가
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── SCO 차감 확인 ── */}
      {dialog && (
        <>
          <div className="scrim" onClick={() => setDialog(null)} />
          <div className="confirm" role="dialog" aria-label="확인">
            <p className="cmsg">{dialog.msg}</p>
            <p className="ccost">{dialog.cost}</p>
            <div className="crow">
              <button className="btn grow" onClick={() => setDialog(null)}>취소</button>
              <button className="btn pri grow" onClick={() => { const r = dialog.run; setDialog(null); r(); }}>
                {dialog.ok}
              </button>
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/** 추천 패널에서 "계산식 보기"로 넘어갈 때만 쓰는 다리. */
function openFormulaById(
  rec: CellRec, rows: Axis[], cols: Axis[],
  open: (r: Axis, c: Axis) => void
) {
  const r = rows.find((x) => x.id === rec.rowId);
  const c = cols.find((x) => x.id === rec.colId);
  if (r && c) open(r, c);
}

/* ── 격자 ───────────────────────────────────────────── */
function Grid({
  rows, cols, cells, pending, scope, glowIds, dim, ghost, onPickTarget, onAdd, onCell, onGhost,
}: {
  rows: Axis[]; cols: Axis[]; cells: Record<string, string>; pending: Set<string>;
  scope: string | null; glowIds: string[];
  dim: boolean; ghost: AxisOffer | null;
  onPickTarget: (t: Target) => void;
  onAdd: (kind: AxisKind) => void;
  onCell: (r: Axis, c: Axis) => void;
  onGhost: () => void;
}) {
  const sub = (a: Axis) => {
    const parts: string[] = [];
    if (a.ctx && a.ctx !== scope) parts.push(a.ctx);
    if (a.src) parts.push(a.src);
    return parts.join(" · ");
  };

  const head = (a: Axis, kind: AxisKind) => (
    <th
      key={a.id}
      className={(kind === "row" ? "rowhead" : "") + (a.ax ? "" : " blank")}
      onClick={() => onPickTarget({ kind, id: a.id })}
    >
      {a.ax ?? "(빈칸)"}
      {a.ax && sub(a) && <span className="src">{sub(a)}</span>}
    </th>
  );

  return (
    <table>
      <thead>
        <tr>
          <th className="corner">기준 \ 지표</th>
          {cols.map((c) => head(c, "col"))}
          <th className="plus" onClick={() => onAdd("col")} title="지표 추가">+</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {head(r, "row")}
            {cols.map((c) => {
              const k = ck(r.id, c.id);
              if (!r.ax || !c.ax) return <td key={c.id} className="void" />;
              if (pending.has(k)) return <td key={c.id} className="skel" />;
              const v = cells[k];
              if (v === undefined) return <td key={c.id} className="void" />;
              const lit = glowIds.includes(k);
              const cls = [v === NO_VALUE ? "empty" : "", lit ? "glow" : "", dim && !lit ? "dim" : ""]
                .filter(Boolean).join(" ");
              // 격자에는 숫자만 둔다. 등급·성적은 셀을 눌렀을 때 보여준다 —
              // 배지를 얹으면 읽어야 할 것이 늘고, 승률 옆의 작은 글자는 숫자를 방해한다.
              return (
                <td key={c.id} className={cls} onClick={() => onCell(r, c)}>
                  <span className="v num">{v}</span>
                </td>
              );
            })}
            <td className="void" />
          </tr>
        ))}

        {/* F-20 잠긴 추천 행 — 타인 계산식, 값은 가려진다 */}
        {ghost && ghost.kind === "row" && (
          <tr className="ghostrow" onClick={onGhost}>
            <th className="rowhead ghosthead">
              {ghost.ax}
              <span className="src">{ghost.src} · {ghost.price} SCO</span>
            </th>
            {cols.map((c) => <td key={c.id} className="ghostcell"><span className="v num">··</span></td>)}
            <td className="void" />
          </tr>
        )}

        <tr className="addrow">
          <th className="plus" onClick={() => onAdd("row")} title="기준 추가">+</th>
          {cols.map((c) => <td key={c.id} className="void" />)}
          <td className="void" />
        </tr>
      </tbody>
    </table>
  );
}
