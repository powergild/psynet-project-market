"use client";

import { useState } from "react";
import { SPORTS, ROW_CATEGORIES, metricChoices, buildSetup, type Sport } from "@/lib/axes";

/**
 * 초기 설정 설문.
 * 빈 격자를 던져주는 대신 "무엇을 기준으로, 무엇을 알고 싶은지"를 물어서 첫 박스를 만든다.
 * 경기 안에서는 종목이 이미 정해져 있으므로 종목 단계를 건너뛴다.
 */
export default function SetupSheet({
  sport, players, onDone, onSkip,
}: {
  sport?: Sport | null;
  players?: string[];
  onDone: (g: { rows: string[]; cols: string[] }) => void;
  onSkip: () => void;
}) {
  const fixed = sport ?? null;
  const [step, setStep] = useState(fixed ? 1 : 0);
  const [sp, setSp] = useState<Sport>(fixed ?? "축구");
  const [cats, setCats] = useState<string[]>(["경기 구도"]);
  const [mets, setMets] = useState<string[]>(["득점 기대값", "실점 기대값"]);

  const rowCats = players?.length ? ["이 경기 선수", ...ROW_CATEGORIES] : ROW_CATEGORIES;
  const toggle = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);

  const last = 2;
  const canNext = step === 0 ? true : step === 1 ? cats.length > 0 : mets.length > 0;

  const finish = () => onDone(buildSetup(sp, cats, mets, players));

  return (
    <>
      <div className="scrim" />
      <div className="sheet setup" role="dialog" aria-label="데이터 박스 설정">
        <div className="grab"><i /></div>

        <div className="shead">
          <span className="bname">
            {step === 0 ? "어떤 경기를 보시나요?" : step === 1 ? "무엇을 기준으로 볼까요?" : "무엇을 알고 싶으세요?"}
          </span>
          <span className="spacer" />
          <span className="chip">{step + 1} / {last + 1}</span>
        </div>

        <p className="shint">
          {step === 0 && "종목에 맞는 지표만 보여드립니다."}
          {step === 1 && "격자의 행이 됩니다. 여러 개 고를 수 있어요."}
          {step === 2 && "격자의 열이 됩니다. 최대 6개까지 들어갑니다."}
        </p>

        <div className="sbody">
          {step === 0 && (
            <div className="pickgrid">
              {SPORTS.map((s) => (
                <button key={s} className={`pick big${sp === s ? " on" : ""}`} onClick={() => setSp(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="pickgrid">
              {rowCats.map((c) => (
                <button key={c} className={`pick${cats.includes(c) ? " on" : ""}`}
                        onClick={() => setCats((p) => toggle(p, c))}>
                  {c}
                </button>
              ))}
            </div>
          )}

          {step === 2 && metricChoices(sp).map((g) => (
            <div className="axgroup" key={g.category}>
              <div className="gl">{g.category}</div>
              <div className="pickgrid">
                {g.items.map((it) => {
                  const on = mets.includes(it.name);
                  const full = !on && mets.length >= 6;
                  return (
                    <button key={it.name} className={`pick${on ? " on" : ""}`} disabled={full}
                            onClick={() => setMets((p) => toggle(p, it.name))}>
                      {it.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="sfoot">
          {step > (fixed ? 1 : 0)
            ? <button className="btn" onClick={() => setStep((s) => s - 1)}>이전</button>
            : <button className="btn" onClick={onSkip}>기본값으로 시작</button>}
          <span className="spacer" />
          {step < last
            ? <button className="btn pri" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>다음</button>
            : <button className="btn pri" disabled={!canNext} onClick={finish}>
                {cats.length}개 기준 × {mets.length}개 지표로 시작
              </button>}
        </div>
      </div>
    </>
  );
}
