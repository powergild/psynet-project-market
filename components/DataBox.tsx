"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { catalogFor, searchAxes, DEFAULT_ROWS, DEFAULT_COLS, type AxisDef, type AxisKind } from "@/lib/axes";
import type { Match } from "@/lib/matches";

type Axis = { id: string; ax: string | null; ctx: string | null; src: string | null };
type Target = { kind: AxisKind; id: string } | null;

const uid = () => Math.random().toString(36).slice(2, 9);
const ck = (r: string, c: string) => `${r}::${c}`;

/** 박스는 경기 단위로 분리 저장한다. 메인(경기 무관)과 경기별 박스는 서로 다른 박스다. */
const storeKey = (matchId: string | null) => `databox_v1:${matchId ?? "global"}`;

const mkAxes = (names: string[], ctx: string | null): Axis[] =>
  names.map((ax) => ({ id: uid(), ax, ctx, src: null }));

/**
 * 데이터 박스.
 * - 메인(match=null): 경기에 묶이지 않은 내 박스. 일반 지표만.
 * - 경기 상세(match=…): 그 경기 전용 박스. 선수 축을 쓸 수 있고 발광 대상이 된다.
 */
export default function DataBox({ match = null }: { match?: Match | null }) {
  const matchId = match?.id ?? null;
  const scope = match ? `${match.home}·${match.away}` : null;

  const [name] = useState(match ? `${match.home}·${match.away} 박스` : "내 박스");
  const [rows, setRows] = useState<Axis[]>([]);
  const [cols, setCols] = useState<Axis[]>([]);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Set<string>>(new Set());
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
    async (rs: Axis[], cs: Axis[], only?: { kind: AxisKind; id: string }) => {
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
            matchId,
            pairs: pairs.map((p) => ({
              row: { id: p.row.id, name: p.row.ax, ctx: p.row.ctx },
              col: { id: p.col.id, name: p.col.ax, ctx: p.col.ctx },
            })),
          }),
        });
        const d = await res.json();
        if (d.ok) out = d.cells; else say("계산에 실패했습니다.");
      } catch { say("인터넷 연결을 확인해주세요."); }

      const step = out.length > 12 ? 24 : 55;   // 순차로 확정되는 과정 자체가 제품 설명이 된다
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
      const raw = window.localStorage.getItem(storeKey(matchId));
      if (raw) {
        const s = JSON.parse(raw);
        if (Array.isArray(s.rows) && s.rows.length) {
          setRows(s.rows); setCols(s.cols ?? []); setCells(s.cells ?? {});
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
  }, [compute, scope, matchId]);

  useEffect(() => {
    if (!rows.length) return;
    try { window.localStorage.setItem(storeKey(matchId), JSON.stringify({ rows, cols, cells })); } catch {}
  }, [rows, cols, cells, matchId]);

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
    setRows(nr); setCols(nc); setTarget(null);
    void compute(nr, nc, { kind, id });              // 해당 행/열만 부분 재계산
  };

  const removeAxis = (kind: AxisKind, id: string) => {
    if (kind === "row") setRows((p) => p.filter((a) => a.id !== id));
    else setCols((p) => p.filter((a) => a.id !== id));
    setCells((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !k.includes(id))));
    setTarget(null);
  };

  const groups = target ? searchAxes(catalogFor(target.kind, match?.players), q) : [];
  const targetHasAxis = !!target && [...rows, ...cols].find((a) => a.id === target.id)?.ax;

  return (
    <>
      {pending.size > 0 && (
        <div className="statusline">셀을 채우는 중 · {pending.size}칸 남음</div>
      )}

      <div className="boxmain">
        <Grid
          rows={rows} cols={cols} cells={cells} pending={pending} scope={scope}
          onPickTarget={(t) => { setTarget(t); setQ(""); }}
          onAdd={addBlank}
        />
        <p className="note">
          <b>행</b>은 기준(팀·선수·환경·상황), <b>열</b>은 지표(기대값·기록)입니다.
          셀은 “이 기준에서 이 지표가 얼마인가”로 읽습니다.
          <br />헤더를 누르면 바꾸거나 지울 수 있고, <b>+</b>를 누르면 빈 칸이 생깁니다.
        </p>
      </div>

      <div className="actionbar">
        <button className="btn grow" onClick={() => { void compute(rows, cols); }}>
          전체 다시 계산
        </button>
        <button className="btn pri grow" onClick={() => say("저장했습니다.")}>저장</button>
      </div>

      {/* ── 축 선택 시트 ── */}
      {target && (
        <>
          <div className="scrim" onClick={() => setTarget(null)} />
          <div className="sheet" role="dialog" aria-label="축 고르기">
            <div className="grab"><i /></div>
            <div className="shead">
              <span className="bname">
                {target.kind === "row" ? "기준 고르기" : "지표 고르기"}
              </span>
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

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

/* ── 격자 ───────────────────────────────────────────── */
function Grid({
  rows, cols, cells, pending, scope, onPickTarget, onAdd,
}: {
  rows: Axis[]; cols: Axis[]; cells: Record<string, string>; pending: Set<string>;
  scope: string | null;
  onPickTarget: (t: Target) => void;
  onAdd: (kind: AxisKind) => void;
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
    <div className="gridwrap">
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
            <th className="plus" onClick={() => onAdd("row")} title="기준 추가">+</th>
            {cols.map((c) => <td key={c.id} className="void" />)}
            <td className="void" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
