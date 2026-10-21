"use client";

import { useState } from "react";
import Link from "next/link";
import { getMarket, priceOf } from "@/lib/market";

type Sort = "hit" | "views" | "new";

// SCR-004 박스 마켓 (F-08)
export default function MarketPage() {
  const [sort, setSort] = useState<Sort>("hit");
  const boxes = [...getMarket()].sort((a, b) =>
    sort === "hit" ? b.hit - a.hit : sort === "views" ? b.views - a.views : a.id.localeCompare(b.id)
  );

  return (
    <main className="app">
      <header className="topbar">
        <Link className="back" href="/" aria-label="뒤로">←</Link>
        <h1>박스 마켓</h1>
        <span className="spacer" />
        <Link className="ctxbtn" href="/wallet">SCO</Link>
      </header>

      <div className="tabs">
        {([["hit", "적중률"], ["views", "인기"], ["new", "최신"]] as [Sort, string][]).map(([k, l]) => (
          <button key={k} className={`tab${sort === k ? " on" : ""}`} onClick={() => setSort(k)}>{l}</button>
        ))}
      </div>

      <div className="boxmain scrolly">
        {boxes.map((b) => (
          <Link className="bcard" key={b.id} href={`/box/${b.id}`}>
            <div className="bc-h">
              <span className="bc-n">{b.name}</span>
              <span className="chip amber">적중 {b.hit}%</span>
            </div>
            <div className="bc-by">{b.by} · 열람 {b.views.toLocaleString()}회</div>
            <div className="bc-ax">
              {[...b.rows.slice(0, 3), ...b.cols.slice(0, 3)].map((a) => (
                <span className="axpill" key={a}>{a}</span>
              ))}
            </div>
            <div className="bc-f">
              <span className="spacer" />
              <span className="price">{priceOf(b)} SCO · 열람</span>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
