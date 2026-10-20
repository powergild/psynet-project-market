"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { catalogFor, searchAxes, DEFAULT_ROWS, DEFAULT_COLS, type AxisDef } from "@/lib/axes";
import type { Match } from "@/lib/matches";

type Axis = { id: string; ax: string | null; ctx: string | null; src: string | null };
type Target = { kind: "row" | "col"; id: string } | null;

const uid = () => Math.random().toString(36).slice(2, 9);
const ck = (r: string, c: string) => `${r}::${c}`;
const STORE = "databox_v1";

function mkAxes(names: string[], ctx: string | null): Axis[] {
  return names.map((ax) => ({ id: uid(), ax, ctx, src: null }));
}

export default function DataBox({ match }: { match: Match | null }) {
  const scope = match ? `${match.home}·${match.away}` : null;

  const [open, setOpen] = useState(false);
  const [built, setBuilt] = useState(false);
  const [name, setName] = useState("내 첫 박스");
  const [rows, setRows] = useState<Axis[]>([]);
  const [cols, setCols] = useState<Axis[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<Target>(null);
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const toastT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const say = useCallback((m: string) => {
    setToast(m);
    if (toastT.current) clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // ── 저장된 박스 복원 (로그인 없이도 박스가 남는다) ──
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORE);
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.rows) && Array.isArray(s.cols)) {
          setRows(s.rows); setCols(s.cols); setCells(s.cells ?? {});
          setName(s.name ?? "내 첫 박스"); setBuilt(true);
        }
      }
    } catch { /* 저장소 접근 불가여도 동작해야 한다 */ }
  }, []);

  useEffect(() => {
    if (!built) return;
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ name, rows, cols, cells }));
    } catch { /* 무시 */ }
  }, [built, name, rows, cols, cells]);

  // ── 셀 계산 ──────────────────────────────────────
  // 한 번의 API 호출로 묶어 받되, 화면에는 순차적으로 확정한다(기획서 v2.2 연출).
  const compute = useCallback(
    async (rs: Axis[], cs: Axis[], only?: { kind: "row" | "col"; id: string }) => {
      const pairs: { row: Axis; col: Axis }[] = [];
      for (const r of rs) {
        for (const c of cs) {
          if (!r.ax || !c.ax) continue;                       // (빈칸)은 계산하지 않는다
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
            matchId: match?.id ?? null,
            pairs: pairs.map((p) => ({
              row: { id: p.row.id, name: p.row.ax, ctx: p.row.ctx },
              col: { id: p.col.id, name: p.col.ax, ctx: p.col.ctx },
            })),
          }),
        });
        const d = await res.json();
        if (d.ok) out = d.cells;
        else say("계산에 실패했습니다.");
      } catch {
        say("네트워크를 확인해주세요.");
      }

      // 순차 확정 — 셀이 채워지는 과정 자체가 제품 설명이 된다
      const step = out.length > 12 ? 24 : 55;
      for (const cell of out) {
        await new Promise((r) => setTimeout(r, step));
        setCells((p) => ({ ...p, [ck(cell.rowId, cell.colId)]: cell.value }));
        setPending((p) => {
          const n = new Set(p); n.delete(ck(cell.rowId, cell.colId)); return n;
        });
      }
      setPending(new Set());
    },
    [match, say]
  );

  // 최초 진입: 빈 격자가 아니라 기본 8×4가 채워지며 시작
  const openSheet = useCallback(() => {
    setOpen(true);
    if (built) return;
    const rs = mkAxes(DEFAULT_ROWS, scope);
    const cs = mkAxes(DEFAULT_COLS, scope);
    setRows(rs); setCols(cs); setBuilt(true);
    void compute(rs, cs);
  }, [built, compute, scope]);

  // ── 축 조작 ──────────────────────────────────────
  const addBlank = (kind: "row" | "col") => {
    const a: Axis = { id: uid(), ax: null, ctx: scope, src: null };
    if (kind === "row") setRows((p) => [...p, a]);
    else setCols((p) => [...p, a]);
    setTarget({ kind, id: a.id });
    setQ("");
  };

  const pickAxis = (def: AxisDef) => {
    if (!target) return;
    const { kind, id } = target;
    const apply = (list: Axis[]) =>
      list.map((a) => (a.id === id ? { ...a, ax: def.name, ctx: scope } : a));
    const nr = kind === "row" ? apply(rows) : rows;
    const nc = kind === "col" ? apply(cols) : cols;
    setRows(nr); setCols(nc);
    setTarget(null);
    void compute(nr, nc, { kind, id });   // 해당 행/열만 부분 재계산
  };

  const removeAxis = (kind: "row" | "col", id: string) => {
    // 축 삭제는 계산을 유발하지 않는다
    if (kind === "row") setRows((p) => p.filter((a) => a.id !== id));
    else setCols((p) => p.filter((a) => a.id !== id));
    setCells((p) => {
      const n: Record<string, string> = {};
      for (const [k, v] of Object.entries(p)) if (!k.includes(id)) n[k] = v;
      return n;
    });
  };

  const groups = searchAxes(catalogFor(match?.players), q);
  const busyLine =
    pending.size > 0 ? `셀을 채우는 중 · ${pending.size}칸 남음` : null;

  return (
    <>
      <button className="fab" onClick={openSheet} aria-label="데이터 박스 열기">
        <GridIcon />
      </button>

      {open && (
        <>
          <div className="scrim" onClick={() => { setOpen(false); setTarget(null); }} />
          <div className="sheet" role="dialog" aria-label="데이터 박스">
            <div className="grab"><i /></div>

            {target ? (
              <>
                <div className="shead">
                  <button className="btn" onClick={() => setTarget(null)}>← 뒤로</button>
                  <span className="bname" style={{ marginLeft: 4 }}>데이터 고르기</span>
                </div>
                <div className="axsearch">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="축 이름으로 찾기"
                    autoComplete="off"
                  />
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
              </>
            ) : (
              <>
                <div className="shead">
                  <span className="bname">{name}</span>
                  {scope ? <span className="chip">{scope}</span> : <span className="chip amber">경기 밖</span>}
                  <span className="spacer" />
                  <button className="btn" onClick={() => setOpen(false)}>닫기</button>
                </div>

                {busyLine && <div className="note" style={{ paddingBottom: 0 }}>{busyLine}</div>}
                {!scope && (
                  <div className="note" style={{ paddingBottom: 0 }}>
                    경기 밖에서는 발광하지 않고, 선수 축도 고를 수 없습니다.
                  </div>
                )}

                <div className="sbody">
                  <Grid
                    rows={rows} cols={cols} cells={cells} pending={pending} scope={scope}
                    onPickTarget={(t) => { setTarget(t); setQ(""); }}
                    onRemove={removeAxis}
                    onAdd={addBlank}
                  />
                  <div className="note">
                    헤더를 누르면 축을 바꾸거나 지울 수 있고, <b>+</b>를 누르면 빈 칸이 생깁니다.
                    <br />(빈칸)은 계산하지 않습니다.
                  </div>
                </div>

                <div className="sfoot">
                  <button className="btn grow" onClick={() => { void compute(rows, cols); }}>
                    전체 다시 계산
                  </button>
                  <button className="btn pri grow" onClick={() => say("저장했습니다.")}>저장</button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/* ── 격자 ───────────────────────────────────────────── */
function Grid({
  rows, cols, cells, pending, scope, onPickTarget, onRemove, onAdd,
}: {
  rows: Axis[]; cols: Axis[]; cells: Record<string, string>; pending: Set<string>;
  scope: string | null;
  onPickTarget: (t: Target) => void;
  onRemove: (kind: "row" | "col", id: string) => void;
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
      onContextMenu={(e) => { e.preventDefault(); onRemove(kind, a.id); }}
      title="탭: 축 변경 · 길게/우클릭: 삭제"
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

function GridIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => (
          <rect
            key={`${r}${c}`}
            x={3 + c * 7} y={3 + r * 7} width="5" height="5" rx="1"
            fill={r === 1 && c === 1 ? "#F5A300" : "rgba(255,255,255,.85)"}
          />
        ))
      )}
    </svg>
  );
}
