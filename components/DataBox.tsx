"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { catalogFor, searchAxes, DEFAULT_ROWS, DEFAULT_COLS, type AxisDef } from "@/lib/axes";
import type { Match } from "@/lib/matches";

type Axis = { id: string; ax: string | null; ctx: string | null; src: string | null };
type Target = { kind: "row" | "col"; id: string } | null;
type Sheet = "axis" | "match" | null;

const uid = () => Math.random().toString(36).slice(2, 9);
const ck = (r: string, c: string) => `${r}::${c}`;
const STORE = "databox_v1";

const mkAxes = (names: string[], ctx: string | null): Axis[] =>
  names.map((ax) => ({ id: uid(), ax, ctx, src: null }));

/** 데이터 박스 = 메인 화면. 경기는 박스에 붙이는 맥락일 뿐 별도 목적지가 아니다. */
export default function DataBox({
  matches,
  initialMatchId = null,
}: {
  matches: Match[];
  initialMatchId?: string | null;
}) {
  const [matchId, setMatchId] = useState<string | null>(initialMatchId);
  const match = matches.find((m) => m.id === matchId) ?? null;
  const scope = match ? `${match.home}·${match.away}` : null;

  const [name, setName] = useState("내 첫 박스");
  const [rows, setRows] = useState<Axis[]>([]);
  const [cols, setCols] = useState<Axis[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<Sheet>(null);
  const [target, setTarget] = useState<Target>(null);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // ── 셀 계산 ──────────────────────────────────────
  const compute = useCallback(
    async (rs: Axis[], cs: Axis[], only?: { kind: "row" | "col"; id: string }) => {
      const pairs: { row: Axis; col: Axis }[] = [];
      for (const r of rs) {
        for (const c of cs) {
          if (!r.ax || !c.ax) continue;                      // (빈칸)은 계산하지 않는다
          if (only?.kind === "row" && r.id !== only.id) continue;
          if (only?.kind === "col" && c.id !== only.id) continue;
          pairs.push({ row: r, col: c });
        }
      }
      if (!pairs.length) return;
      setPending(new Set(pairs.map((p) => ck(p.row.id, p.col.id))));

      let out: { rowId: string; colId: string; value: string }[] = [];
      try {
        const res = await fetch("/api/cells", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            matchId: matchId ?? null,
            pairs: pairs.map((p) => ({
              row: { id: p.row.id, name: p.row.ax, ctx: p.row.ctx },
              col: { id: p.col.id, name: p.col.ax, ctx: p.col.ctx },
            })),
          }),
        });
        const d = await res.json();
        if (d.ok) out = d.cells; else say("계산에 실패했습니다.");
      } catch { say("인터넷 연결을 확인해주세요."); }

      const step = out.length > 12 ? 24 : 55;   // 셀이 순차로 확정되는 과정 자체가 제품 설명이 된다
      for (const cell of out) {
        await new Promise((r) => setTimeout(r, step));
        setCells((p) => ({ ...p, [ck(cell.rowId, cell.colId)]: cell.value }));
        setPending((p) => { const n = new Set(p); n.delete(ck(cell.rowId, cell.colId)); return n; });
      }
      setPending(new Set());
    },
    [matchId, say]
  );

  // ── 복원 / 최초 생성 ─────────────────────────────
  useEffect(() => {
    if (ready.current) return;
    ready.current = true;
    let restored = false;
    try {
      const raw = window.localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.rows) && s.rows.length) {
          setRows(s.rows); setCols(s.cols ?? []); setCells(s.cells ?? {});
          setName(s.name ?? "내 첫 박스");
          restored = true;
        }
      }
    } catch { /* 저장소 없어도 동작해야 한다 */ }

    if (!restored) {
      const rs = mkAxes(DEFAULT_ROWS, scope);
      const cs = mkAxes(DEFAULT_COLS, scope);
      setRows(rs); setCols(cs);
      void compute(rs, cs);
    }
  }, [compute, scope]);

  useEffect(() => {
    if (!rows.length) return;
    try { window.localStorage.setItem(STORE, JSON.stringify({ name, rows, cols, cells })); } catch {}
  }, [name, rows, cols, cells]);

  // ── 축 조작 ──────────────────────────────────────
  const addBlank = (kind: "row" | "col") => {
    const a: Axis = { id: uid(), ax: null, ctx: scope, src: null };
    if (kind === "row") setRows((p) => [...p, a]); else setCols((p) => [...p, a]);
    setTarget({ kind, id: a.id }); setQ(""); setSheet("axis");
  };

  const pickAxis = (def: AxisDef) => {
    if (!target) return;
    const { kind, id } = target;
    const apply = (l: Axis[]) => l.map((a) => (a.id === id ? { ...a, ax: def.name, ctx: scope } : a));
    const nr = kind === "row" ? apply(rows) : rows;
    const nc = kind === "col" ? apply(cols) : cols;
    setRows(nr); setCols(nc); setTarget(null); setSheet(null);
    void compute(nr, nc, { kind, id });              // 해당 행/열만 부분 재계산
  };

  const removeAxis = (kind: "row" | "col", id: string) => {
    if (kind === "row") setRows((p) => p.filter((a) => a.id !== id));
    else setCols((p) => p.filter((a) => a.id !== id));
    setCells((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.includes(id))));
    setSheet(null); setTarget(null);
  };

  const pickMatch = (id: string | null) => {
    setMatchId(id); setSheet(null);
    const m = matches.find((x) => x.id === id) ?? null;
    say(m ? `${m.home}·${m.away} 맥락으로 전환했습니다.` : "경기 밖 — 일반 지표로 봅니다.");
  };

  const groups = searchAxes(catalogFor(match?.players), q);

  return (
    <main className="app">
      <header className="topbar">
        <h1>{name}</h1>
        <span className="spacer" />
        <button className="ctxbtn" onClick={() => setSheet("match")}>
          {scope ? <><span className="dot" />{scope}</> : "경기 밖"}
          <span className="caret">▾</span>
        </button>
      </header>

      {pending.size > 0 && (
        <div className="statusline">셀을 채우는 중 · {pending.size}칸 남음</div>
      )}
      {!scope && pending.size === 0 && (
        <div className="statusline soft">경기를 고르면 그 경기 선수를 축으로 쓸 수 있습니다.</div>
      )}

      <div className="boxmain">
        <Grid
          rows={rows} cols={cols} cells={cells} pending={pending} scope={scope}
          onPickTarget={(t) => { setTarget(t); setQ(""); setSheet("axis"); }}
          onAdd={addBlank}
        />
        <p className="note">
          헤더를 누르면 축을 바꾸거나 지울 수 있고, <b>+</b>를 누르면 빈 칸이 생깁니다.
          <br />(빈칸)은 계산하지 않습니다.
        </p>
      </div>

      <div className="actionbar">
        <button className="btn grow" onClick={() => { void compute(rows, cols); }}>
          전체 다시 계산
        </button>
        <button className="btn pri grow" onClick={() => say("저장했습니다.")}>저장</button>
      </div>

      {/* ── 축 선택 시트 ── */}
      {sheet === "axis" && (
        <>
          <div className="scrim" onClick={() => { setSheet(null); setTarget(null); }} />
          <div className="sheet" role="dialog" aria-label="데이터 고르기">
            <div className="grab"><i /></div>
            <div className="shead">
              <span className="bname">데이터 고르기</span>
              <span className="spacer" />
              {target && rows.concat(cols).find((a) => a.id === target.id)?.ax && (
                <button className="btn danger" onClick={() => removeAxis(target.kind, target.id)}>축 삭제</button>
              )}
              <button className="btn" onClick={() => { setSheet(null); setTarget(null); }}>닫기</button>
            </div>
            <div className="axsearch">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="축 이름으로 찾기" autoComplete="off" />
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

      {/* ── 경기 선택 시트 ── */}
      {sheet === "match" && (
        <>
          <div className="scrim" onClick={() => setSheet(null)} />
          <div className="sheet" role="dialog" aria-label="경기 고르기">
            <div className="grab"><i /></div>
            <div className="shead">
              <span className="bname">어느 경기로 볼까요</span>
              <span className="spacer" />
              <button className="btn" onClick={() => setSheet(null)}>닫기</button>
            </div>
            <div className="sbody">
              <button className={`mrow${matchId === null ? " on" : ""}`} onClick={() => pickMatch(null)}>
                <div className="mr-main">
                  <div className="mr-t">경기 밖 · 일반 지표</div>
                  <div className="mr-s">특정 경기에 묶이지 않은 값으로 봅니다</div>
                </div>
              </button>
              {matches.map((m) => (
                <button key={m.id} className={`mrow${matchId === m.id ? " on" : ""}`} onClick={() => pickMatch(m.id)}>
                  <div className="mr-main">
                    <div className="mr-t">
                      <span className={`badge ${m.status === "live" ? "live" : m.status === "finished" ? "fin" : "sched"}`}>
                        {m.status === "live" ? "LIVE" : m.status === "finished" ? "종료" : "예정"}
                      </span>
                      {m.home} vs {m.away}
                    </div>
                    <div className="mr-s">
                      {m.sport} · {m.league}
                      {m.scoreHome !== null && ` · ${m.scoreHome} : ${m.scoreAway}`}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

/* ── 격자 ───────────────────────────────────────────── */
function Grid({
  rows, cols, cells, pending, scope, onPickTarget, onAdd,
}: {
  rows: Axis[]; cols: Axis[]; cells: Record<string, string>; pending: Set<string>;
  scope: string | null;
  onPickTarget: (t: Target) => void;
  onAdd: (kind: "row" | "col") => void;
}) {
  const sub = (a: Axis) => {
    const parts: string[] = [];
    if (a.ctx && a.ctx !== scope) parts.push(a.ctx);
    if (a.src) parts.push(a.src);
    return parts.join(" · ");
  };

  const head = (a: Axis, kind: "row" | "col") => (
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
    <div className="gridwrap">
      <table>
        <thead>
          <tr>
            <th className="corner">축</th>
            {cols.map((c) => head(c, "col"))}
            <th className="plus" onClick={() => onAdd("col")} title="열 추가">+</th>
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
                return (
                  <td key={c.id} className={v === "—" ? "empty" : ""}>
                    <span className="v num">{v}</span>
                  </td>
                );
              })}
              <td className="void" />
            </tr>
          ))}
          <tr>
            <th className="plus" onClick={() => onAdd("row")} title="행 추가">+</th>
            {cols.map((c) => <td key={c.id} className="void" />)}
            <td className="void" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
