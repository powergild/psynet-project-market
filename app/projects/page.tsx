"use client";

import { useEffect, useState } from "react";
import { GRADE_COLOR, gradeFor } from "@/lib/projects";

type AllProject = {
  id: string;
  title: string;
  pm: string;
  status: string;
  required_skills: string[];
  summary: string;
};

const SESSION_KEY = "pm_session";

type Session = { name: string; phone: string };

function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

type Recruiting = {
  id: string;
  title: string;
  pm: string;
  status: string;
  requiredSkills: string[];
  participantCount: number | null;
};

export default function ProjectsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [completed, setCompleted] = useState<string[]>([]);
  const [recruitingOnly, setRecruitingOnly] = useState(false);
  const [recruiting, setRecruiting] = useState<Recruiting[] | null>(null);
  const [allProjects, setAllProjects] = useState<AllProject[] | null>(null);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("recruiting") === "1") {
      setRecruitingOnly(true);
    }
    const s = loadSession();
    setSession(s);
    if (!s) return;
    fetch(`/api/profile?phone=${encodeURIComponent(s.phone)}`)
      .then((r) => r.json())
      .then((d) => {
        setSkills(Array.isArray(d.skills) ? d.skills : []);
        setCompleted(Array.isArray(d.completed) ? d.completed : []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (recruiting !== null) return;
    fetch("/api/recruiting")
      .then((r) => r.json())
      .then((d) => setRecruiting(d.ok ? d.items : []))
      .catch(() => setRecruiting([]));
  }, [recruiting]);

  useEffect(() => {
    if (allProjects !== null) return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setAllProjects(d.ok ? d.items : []))
      .catch(() => setAllProjects([]));
  }, [allProjects]);

  const hasHistory = completed.length > 0;
  const projects = allProjects ?? [];
  const recruitingCount = recruiting?.length ?? null;

  return (
    <main className="cards-page">
      <h1>PROJECT MARKET — 전체 프로젝트</h1>
      <p className="sub">
        {session ? `${session.name}님 · 보유 스킬: ${skills.join(", ") || "(미설정)"}` : '로그인 안 됨 — 터미널에서 "로그인 <이름> <전화번호>"'}
        {" · "}
        <a href="/start">← 터미널로</a>
      </p>
      <p className="sub">
        {hasHistory ? `활동 이력 ${completed.length}건 → 등급 산출됨` : "활동 이력 없음 → 전 프로젝트 '신규' 표시 (등급 미산출)"}
      </p>

      <button
        onClick={() => setRecruitingOnly((v) => !v)}
        style={{
          background: recruitingOnly ? "#1f3a24" : "#151512",
          border: `1px solid ${recruitingOnly ? "#2f6b3a" : "#2a2a26"}`,
          color: recruitingOnly ? "#7CFF9B" : "#c9c5b8",
          padding: "8px 14px",
          borderRadius: 6,
          fontSize: 13,
          cursor: "pointer",
          marginBottom: 16,
        }}
      >
        {recruitingOnly ? "✓ 지금 구인 중만 보기" : "지금 구인 중만 보기"}
        {recruitingCount !== null ? ` (${recruitingCount}건)` : ""}
      </button>

      {recruitingOnly ? (
        recruiting === null ? (
          <p className="sub">불러오는 중…</p>
        ) : recruiting.length === 0 ? (
          <p className="sub">지금 구인 중인 프로젝트가 없어.</p>
        ) : (
          recruiting.map((p) => {
            const overlap = p.requiredSkills.filter((s) => skills.includes(s));
            return (
              <div className="card" key={p.id}>
                <div className="grade" style={{ background: "#7CFF9B22", color: "#7CFF9B" }}>
                  합류 가능
                </div>
                <div>
                  <div className="title">{p.title}</div>
                  <div className="meta">필요 스킬: {p.requiredSkills.join(", ") || "-"}</div>
                  <div className="meta">내 일치 스킬: {overlap.join(", ") || "없음"}</div>
                  <div className="meta">
                    PM: {p.pm} · 상태: {p.status}
                    {p.participantCount !== null ? ` · 현재 ${p.participantCount}명 참여 중` : ""}
                  </div>
                  <div className="meta" style={{ color: "#7CFF9B" }}>
                    터미널에서 &quot;{p.title} 신청할래&quot; 라고 말하면 합류 신청돼.
                  </div>
                </div>
              </div>
            );
          })
        )
      ) : allProjects === null ? (
        <p className="sub">불러오는 중…</p>
      ) : projects.length === 0 ? (
        <p className="sub">아직 등록된 프로젝트가 없어. 터미널에서 &quot;프로젝트 등록할래&quot;로 첫 프로젝트를 올려봐.</p>
      ) : (
      projects.map((p) => {
        const overlap = p.required_skills.filter((s) => skills.includes(s));
        const label = hasHistory ? gradeFor(skills, p.required_skills) : "신규";
        const color = GRADE_COLOR[label];
        return (
          <div className="card" key={p.id}>
            <div className="grade" style={{ background: color + "22", color }}>
              {label}
            </div>
            <div>
              <div className="title">{p.title}</div>
              <div className="meta">요구 스킬: {p.required_skills.join(", ") || "-"}</div>
              <div className="meta">일치 스킬: {overlap.join(", ") || "없음"}</div>
              <div className="meta">PM: {p.pm}</div>
            </div>
          </div>
        );
      })
      )}
    </main>
  );
}
