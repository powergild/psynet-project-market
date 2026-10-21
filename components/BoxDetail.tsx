"use client";

import { useCallback, useEffect, useState } from "react";
import { balance, spend } from "@/lib/wallet";
import { priceOf, type MarketBox } from "@/lib/market";

const ck = (r: string, c: string) => `${r}::${c}`;
const UNLOCKED = "databox_unlocked_v1";

function unlockedSet(): string[] {
  try { return JSON.parse(window.localStorage.getItem(UNLOCKED) ?? "[]") as string[]; }
  catch { return []; }
}

/**
 * SCR-005 박스 상세 (F-19).
 * 축 이름만이 아니라 **제작자의 계산식으로 채워진 셀 값 전체**를 보여준다 — 그게 열람의 값어치다.
 * 열람 전에는 값이 가려져 있고, SCO를 쓰면 풀린다.
 */
export default function BoxDetail({ box }: { box: MarketBox }) {
  const price = priceOf(box);
  const [open, setOpen] = useState(false);
  const [sco, setSco] = useState(120);
  const [cells, setCells] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    setSco(balance());
    setOpen(unlockedSet().includes(box.id));
  }, [box.id]);

  const load = useCallback(async () => {
    setLoading(true);
    const pairs = box.rows.flatMap((r) =>
      box.cols.map((c) => ({ row: { id: r, name: r, src: box.by }, col: { id: c, name: c, src: box.by } }))
    );
    try {
      const res = await fetch("/api/cells", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: null, pairs }),
      });
      const d = await res.json();
      if (d.ok) {
        const m: Record<string, string> = {};
        for (const x of d.cells as { rowId: string; colId: string; value: string }[]) {
          m[ck(x.rowId, x.colId)] = x.value;
        }
        setCells(m);
      }
    } catch { /* 값이 없으면 가려진 상태로 남는다 */ }
    setLoading(false);
  }, [box]);

  useEffect(() => { if (open) void load(); }, [open, load]);

  const unlock = () => {
    const left = spend(price, `박스 열람 · ${box.name}`);
    if (left === null) { setToast("SCO가 부족합니다."); setAsk(false); return; }
    setSco(left);
    try {
      window.localStorage.setItem(UNLOCKED, JSON.stringify([...unlockedSet(), box.id]));
    } catch {}
    setOpen(true); setAsk(false);
  };

  /** F-09 축 이식 — 축과 출처를 내 박스로 복제한다. 기존 축을 덮지 않고 새 행으로 쌓는다(F-14). */
  const graft = () => {
    try {
      const key = "databox_v1:global";
      const raw = window.localStorage.getItem(key);
      const s = raw ? JSON.parse(raw) : null;
      if (!s || !Array.isArray(s.rows)) { setToast("먼저 내 박스를 만들어 주세요."); return; }
      const uid = () => Math.random().toString(36).slice(2, 9);
      s.rows = [...s.rows, ...box.rows.map((ax) => ({ id: uid(), ax, ctx: null, src: box.by }))];
      s.cols = [...(s.cols ?? []), ...box.cols.map((ax) => ({ id: uid(), ax, ctx: null, src: box.by }))];
      window.localStorage.setItem(key, JSON.stringify(s));
      setToast(`축 ${box.rows.length + box.cols.length}개를 내 박스로 가져왔습니다.`);
    } catch { setToast("가져오기에 실패했습니다."); }
  };

  return (
    <>
      <div className="matchbar">
        <span className="chip amber">적중 {box.hit}%</span>
        <span className="mb-lg">{box.by} · 열람 {box.views.toLocaleString()}회</span>
        <span className="mb-sc num">{sco} SCO</span>
      </div>

      {loading && <div className="statusline">제작자의 계산식으로 채우는 중…</div>}

      <div className="boxmain">
        <div className="gridwrap">
          <table>
            <thead>
              <tr>
                <th className="corner">기준 \ 지표</th>
                {box.cols.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {box.rows.map((r) => (
                <tr key={r}>
                  <th className="rowhead">{r}<span className="src">{box.by}</span></th>
                  {box.cols.map((c) => {
                    const v = cells[ck(r, c)];
                    if (!open) return <td key={c} className="ghostcell"><span className="v num">··</span></td>;
                    if (!v) return <td key={c} className="skel" />;
                    return <td key={c}><span className="v num">{v}</span></td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          셀은 <b>그 기준이 유리할 확률(승률)</b>입니다.
          {open ? " 축을 가져오면 계산식까지 함께 복제됩니다." : " 열람하면 제작자의 계산식으로 채워진 값이 전부 보입니다."}
        </p>
      </div>

      <div className="actionbar">
        {open ? (
          <button className="btn pri grow" onClick={graft}>축 가져오기</button>
        ) : (
          <button className="btn pri grow" onClick={() => setAsk(true)}>{price} SCO · 열람하기</button>
        )}
      </div>

      {ask && (
        <>
          <div className="scrim" onClick={() => setAsk(false)} />
          <div className="confirm" role="dialog" aria-label="열람 확인">
            <p className="cmsg">이 박스를 열람합니다.</p>
            <p className="ccost">{price} SCO 차감 · 남은 SCO {sco - price}</p>
            <div className="crow">
              <button className="btn grow" onClick={() => setAsk(false)}>취소</button>
              <button className="btn pri grow" onClick={unlock}>열람하기</button>
            </div>
          </div>
        </>
      )}

      {toast && <div className="toast" onAnimationEnd={() => setToast(null)}>{toast}</div>}
    </>
  );
}
