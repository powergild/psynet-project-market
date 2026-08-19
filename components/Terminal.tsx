"use client";

import { useEffect, useRef, useState } from "react";

type LogLine = { text: string; cls?: "u" | "dim" | "banner" };
type Session = { name: string; phone: string };
type Mode =
  | "command"
  | "connect-waiting"
  | "connect-chat"
  | "connect-ended"
  | "connect-liked"
  | "connect-select"
  | "connect-project";
type ParticipantProject = { projectId: string; title: string; role: string };

const SESSION_KEY = "pm_session";

function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function greeting(session: Session | null): LogLine[] {
  if (session) {
    return [
      { text: "PROJECT MARKET", cls: "banner" },
      { text: `다시 왔네, ${session.name}님. 뭐든 편하게 말해봐 — 알아서 알아들어.`, cls: "dim" },
    ];
  }
  return [
    { text: "PROJECT MARKET", cls: "banner" },
    { text: "누구세요? 이름·전화번호·이메일 알려줘 — 다시 연락하려면 이메일이 꼭 필요해 (예: 이준호 010-1234-5678 junho@psynet.co.kr)", cls: "dim" },
  ];
}

function leaveQueueBeacon(session: Session) {
  const body = JSON.stringify(session);
  const sent = navigator.sendBeacon?.("/api/connect/leave", new Blob([body], { type: "application/json" }));
  if (!sent) {
    fetch("/api/connect/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  }
}

export default function Terminal() {
  const [log, setLog] = useState<LogLine[]>([]);
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(0);
  const [lastProjectId, setLastProjectId] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<Mode>("command");
  const [partner, setPartner] = useState<{ name: string; phone: string } | null>(null);
  const [stats, setStats] = useState<{ waiting: number; activeRooms: number } | null>(null);
  const [selectItems, setSelectItems] = useState<ParticipantProject[]>([]);
  const [selectIdx, setSelectIdx] = useState(0);
  const termRef = useRef<HTMLDivElement>(null);

  const modeRef = useRef<Mode>("command");
  const roomIdRef = useRef<number | null>(null);
  const partnerRef = useRef<{ name: string; phone: string } | null>(null);
  const lastMsgIdRef = useRef(0);
  const sessionRef = useRef<Session | null>(null);
  const waitingRef = useRef(false);
  const matchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const msgPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const likePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const s = loadSession();
    setSession(s);
    sessionRef.current = s;
    setLog(greeting(s));

    if (s) startMatchPolling(s);
    fetchStats();
    statsPollRef.current = setInterval(fetchStats, 5000);

    function onBeforeUnload() {
      if (waitingRef.current && sessionRef.current) leaveQueueBeacon(sessionRef.current);
    }
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearAllTimers();
      if (waitingRef.current && sessionRef.current) leaveQueueBeacon(sessionRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [log]);

  function clearAllTimers() {
    if (matchPollRef.current) clearInterval(matchPollRef.current);
    if (msgPollRef.current) clearInterval(msgPollRef.current);
    if (likePollRef.current) clearInterval(likePollRef.current);
    if (statsPollRef.current) clearInterval(statsPollRef.current);
  }

  function append(text: string, cls?: LogLine["cls"]) {
    setLog((prev) => [...prev, { text, cls }]);
  }

  function persistSession(next: Session | null) {
    setSession(next);
    sessionRef.current = next;
    if (next) {
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(next));
      if (!waitingRef.current && modeRef.current === "command") startMatchPolling(next);
    } else {
      window.localStorage.removeItem(SESSION_KEY);
    }
  }

  async function fetchStats() {
    const res = await fetch("/api/connect/stats");
    const data = await res.json();
    if (data.ok) setStats({ waiting: data.waiting, activeRooms: data.activeRooms });
  }

  // ---------- 매칭 대기 ----------
  async function startMatchPolling(s: Session) {
    waitingRef.current = true;
    await matchPoll(s);
    matchPollRef.current = setInterval(() => matchPoll(s), 2500);
  }

  async function matchPoll(s: Session) {
    if (modeRef.current !== "command") return; // 이미 대화/매칭 흐름 중이면 중복 폴링 안 함
    const res = await fetch("/api/connect/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(s),
    });
    const data = await res.json();
    if (data.ok && data.roomId) {
      if (matchPollRef.current) clearInterval(matchPollRef.current);
      waitingRef.current = false;
      enterRoom(data.roomId, true);
    } else if (!data.ok) {
      waitingRef.current = false;
      if (matchPollRef.current) clearInterval(matchPollRef.current);
    }
  }

  // ---------- 방 입장 (실제 유저 매칭 성사 시) ----------
  async function enterRoom(roomId: number, announce: boolean) {
    roomIdRef.current = roomId;
    lastMsgIdRef.current = 0;
    const res = await fetch(`/api/connect/room?roomId=${roomId}&phone=${encodeURIComponent(sessionRef.current!.phone)}`);
    const data = await res.json();
    if (!data.ok) return;
    setPartner(data.partner);
    partnerRef.current = data.partner;
    setMode("connect-chat");
    modeRef.current = "connect-chat";
    if (announce) {
      append(`━━ 미토크리에이트: ${data.partner.name}님과 매칭됐어! ━━`, "banner");
      append(`대화 끝내려면 "종료"라고 쳐. 신고/차단은 없고, 끝나면 대화 내용은 삭제돼.`, "dim");
    }
    for (const m of data.messages as { id: number; sender_phone: string; sender_name: string; content: string }[]) {
      lastMsgIdRef.current = Math.max(lastMsgIdRef.current, m.id);
    }
    msgPollRef.current = setInterval(() => pollMessages(roomId), 1500);
  }

  async function pollMessages(roomId: number) {
    const res = await fetch(`/api/connect/room?roomId=${roomId}&phone=${encodeURIComponent(sessionRef.current!.phone)}`);
    const data = await res.json();
    if (!data.ok) return;
    const myPhone = sessionRef.current?.phone;
    for (const m of data.messages as { id: number; sender_phone: string; sender_name: string; content: string }[]) {
      if (m.id <= lastMsgIdRef.current) continue;
      lastMsgIdRef.current = m.id;
      if (m.sender_phone === myPhone) continue; // 내 메시지는 입력 시 이미 "❯ ..."로 에코됨
      append(`${m.sender_name}: ${m.content}`);
    }
    if (data.room.status === "ended" && modeRef.current === "connect-chat") {
      if (msgPollRef.current) clearInterval(msgPollRef.current);
      goEnded();
    }
  }

  function goEnded() {
    setMode("connect-ended");
    modeRef.current = "connect-ended";
    append(`━━ 대화가 끝났어. 대화 내용은 삭제됐어. ━━`, "banner");
    append(`${partnerRef.current?.name}님이 괜찮았으면 "호감"이라고 쳐봐. 아니면 그냥 다른 명령을 치면 넘어가.`, "dim");
  }

  // ---------- 종료 / 호감 / 프로젝트 ----------
  async function endChat() {
    if (!roomIdRef.current) return;
    await fetch("/api/connect/end", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: roomIdRef.current }),
    });
    if (msgPollRef.current) clearInterval(msgPollRef.current);
    goEnded();
  }

  async function sendLike() {
    if (!roomIdRef.current || !sessionRef.current) return;
    const res = await fetch("/api/connect/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: roomIdRef.current, phone: sessionRef.current.phone }),
    });
    const data = await res.json();
    if (data.ok && data.mutual) {
      onMutualLike();
    } else if (data.ok) {
      setMode("connect-liked");
      modeRef.current = "connect-liked";
      append(`호감 표시했어. ${partnerRef.current?.name}님도 하면 여기서 알려줄게…`, "dim");
      likePollRef.current = setInterval(pollLike, 3000);
    }
  }

  // 서로 호감 성사 → 상대의 참여 프로젝트 리스트를 불러와 선택 모드로. 없으면 새 프로젝트 생성 폴백.
  async function onMutualLike() {
    if (likePollRef.current) clearInterval(likePollRef.current);
    append(`━━ 서로 호감이야! 🎉 ━━`, "banner");
    const name = partnerRef.current?.name;
    let projects: ParticipantProject[] = [];
    if (name) {
      try {
        const res = await fetch("/api/connect/partner-projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (data.ok && Array.isArray(data.projects)) projects = data.projects;
      } catch {
        /* 폴백 */
      }
    }
    if (projects.length) {
      setSelectItems(projects);
      setSelectIdx(0);
      setMode("connect-select");
      modeRef.current = "connect-select";
      append(`${name}님이 참여 중인 프로젝트야. 함께 참여할 걸 골라봐 (↑/↓ 이동, Enter 선택, 마우스 클릭도 돼. "취소"로 넘어가기).`, "dim");
    } else {
      setMode("connect-project");
      modeRef.current = "connect-project";
      append(`${name}님과 바로 프로젝트 시작해봐. 프로젝트 제목을 입력해줘 (그만하려면 "취소").`, "dim");
    }
  }

  // 리스트에서 프로젝트 선택 → 그 프로젝트에 함께 참여/신청.
  async function chooseProject(item: ParticipantProject) {
    if (!sessionRef.current) return;
    setMode("command");
    modeRef.current = "command";
    setSelectItems([]);
    try {
      const res = await fetch("/api/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: `신청 ${item.projectId} ${sessionRef.current.name}`, session: sessionRef.current, lastProjectId: null }),
      });
      const data = await res.json();
      append(`『${item.title}』에 함께 참여 신청했어. ${data.output || ""}`.trim(), "banner");
    } catch {
      append("[오류] 신청 처리 실패");
    }
    backToCommand();
  }

  async function pollLike() {
    if (!roomIdRef.current || !sessionRef.current) return;
    const res = await fetch("/api/connect/like", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: roomIdRef.current, phone: sessionRef.current.phone }),
    });
    const data = await res.json();
    if (data.ok && data.mutual) {
      if (likePollRef.current) clearInterval(likePollRef.current);
      onMutualLike();
    }
  }

  async function createProject(title: string) {
    if (!roomIdRef.current || !sessionRef.current) return;
    const res = await fetch("/api/connect/project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: roomIdRef.current, phone: sessionRef.current.phone, name: sessionRef.current.name, title, summary: "" }),
    });
    const data = await res.json();
    if (data.ok) append(`『${data.project.title}』 프로젝트 생성 완료! ${partnerRef.current?.name}님과 함께 시작이야.`, "banner");
    backToCommand();
  }

  function backToCommand() {
    if (likePollRef.current) clearInterval(likePollRef.current);
    roomIdRef.current = null;
    partnerRef.current = null;
    setPartner(null);
    setMode("command");
    modeRef.current = "command";
    append(`이제 다시 프로젝트 검색할 수 있어.`, "dim");
    if (sessionRef.current) startMatchPolling(sessionRef.current);
  }

  // ---------- 입력 처리 ----------
  async function submit(raw: string) {
    if (!raw.trim()) return;
    const cmd = raw.trim();
    append("❯ " + raw, "u");
    setHistory((h) => [...h, raw]);
    setHIdx((h) => h + 1);
    setValue("");

    if (mode === "connect-chat") {
      if (cmd === "종료") return endChat();
      if (!roomIdRef.current || !sessionRef.current) return;
      await fetch("/api/connect/room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: roomIdRef.current, phone: sessionRef.current.phone, name: sessionRef.current.name, content: cmd }),
      });
      return;
    }

    if (mode === "connect-ended") {
      if (cmd === "호감") return sendLike();
      return backToCommand();
    }

    if (mode === "connect-liked") {
      return; // 상대 호감 기다리는 중 — 입력 무시
    }

    if (mode === "connect-select") {
      // 선택은 방향키/마우스로. 타이핑은 "취소"만 처리.
      if (cmd === "취소") {
        setSelectItems([]);
        append("취소했어.", "dim");
        return backToCommand();
      }
      return;
    }

    if (mode === "connect-project") {
      if (cmd === "취소") {
        append("취소했어.", "dim");
        return backToCommand();
      }
      return createProject(cmd);
    }

    try {
      const res = await fetch("/api/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: raw, session, lastProjectId }),
      });
      const data = await res.json();
      if ("session" in data) {
        persistSession(data.session);
      }
      if (typeof data.lastProjectId === "string" || data.lastProjectId === null) {
        setLastProjectId(data.lastProjectId);
      }
      append(data.output || "");
    } catch {
      append("[오류] 서버 연결 실패");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    // 선택 리스트 모드: 방향키로 이동, Enter로 선택, Esc로 취소
    if (mode === "connect-select" && selectItems.length) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectIdx((i) => (i - 1 + selectItems.length) % selectItems.length);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectIdx((i) => (i + 1) % selectItems.length);
        return;
      }
      if (e.key === "Enter") {
        if (e.nativeEvent.isComposing) return;
        e.preventDefault();
        const item = selectItems[selectIdx];
        if (item) {
          append("❯ " + item.title, "u");
          chooseProject(item);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectItems([]);
        append("취소했어.", "dim");
        backToCommand();
        return;
      }
    }
    if (e.key === "Enter") {
      if (e.nativeEvent.isComposing) return; // 한글 IME 조합 중 엔터 무시
      submit(value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHIdx((idx) => {
        const next = Math.max(idx - 1, 0);
        if (history[next] !== undefined) setValue(history[next]);
        return next;
      });
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHIdx((idx) => {
        const next = idx + 1;
        if (next >= history.length) {
          setValue("");
          return history.length;
        }
        setValue(history[next]);
        return next;
      });
    }
  }

  const prompt = session ? `${session.name} >` : ">";

  return (
    <div className="term-wrap">
      <div id="window">
        <div id="titlebar">
          <span className="dot r" />
          <span className="dot y" />
          <span className="dot g" />
          <span className="tb-title">
            project-market — <b>{session ? `${session.name}님` : "LOGGED OUT"}</b>
          </span>
        </div>
        {stats && session && (
          <div style={{ padding: "4px 14px", fontSize: 11, color: "#8c887e", borderBottom: "1px solid #221f1a" }}>
            미토크리에이트 · 대기 중 {stats.waiting}명 · 대화 중인 방 {stats.activeRooms}개
          </div>
        )}
        <div id="term" ref={termRef} onClick={() => document.getElementById("cmdInput")?.focus()}>
          {log.map((l, i) => (
            <div key={i} className={l.cls}>
              {l.text}
            </div>
          ))}
          {mode === "connect-select" &&
            selectItems.map((item, i) => (
              <div
                key={item.projectId}
                onMouseEnter={() => setSelectIdx(i)}
                onClick={(e) => {
                  e.stopPropagation();
                  append("❯ " + item.title, "u");
                  chooseProject(item);
                }}
                style={{
                  cursor: "pointer",
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: i === selectIdx ? "#1f3a24" : "transparent",
                  color: i === selectIdx ? "#7CFF9B" : "#c9c5b8",
                }}
              >
                {i === selectIdx ? "▸ " : "  "}
                {item.title}
                {item.role === "PM" ? "  (PM)" : ""}
              </div>
            ))}
        </div>
        <div id="inputLine">
          <span id="prompt">{prompt}</span>
          <input
            id="cmdInput"
            autoFocus
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  );
}
