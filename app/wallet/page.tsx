"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { balance, history, type ScoEntry } from "@/lib/wallet";

// SCR-006 SCO 지갑 (F-11)
export default function WalletPage() {
  const [sco, setSco] = useState(0);
  const [log, setLog] = useState<ScoEntry[]>([]);

  useEffect(() => { setSco(balance()); setLog(history()); }, []);

  return (
    <main className="app">
      <header className="topbar">
        <Link className="back" href="/" aria-label="뒤로">←</Link>
        <h1>SCO 지갑</h1>
      </header>

      <div className="wallethead">
        <span className="wh-n num">{sco}</span>
        <span className="wh-u">SCO</span>
      </div>

      <div className="boxmain scrolly">
        {log.length === 0 && (
          <div className="empty-state">아직 사용 내역이 없습니다.<br />마켓에서 축을 가져오면 여기에 쌓입니다.</div>
        )}
        {log.map((e) => (
          <div className="logrow" key={e.at}>
            <span className="lg-m">{e.memo}</span>
            <span className="lg-d num">{e.delta > 0 ? "+" : ""}{e.delta}</span>
          </div>
        ))}
      </div>

      <div className="actionbar">
        <Link className="btn pri grow" href="/market" style={{ textAlign: "center", lineHeight: "22px" }}>
          마켓 둘러보기
        </Link>
      </div>
    </main>
  );
}
