// project-market app.py의 nl_to_command / process_command 이식.
// 원본과 달리 서버 프로세스 전역 상태(LAST_PROJECT)를 두지 않는다 — 서버리스 인스턴스가
// 여러 방문자의 요청을 재사용해서 처리할 수 있어, 전역 변수를 쓰면 사용자 A의 "직전 프로젝트"
// 문맥이 사용자 B의 요청에 새어들어갈 수 있다. 대신 클라이언트가 lastProjectId를 들고 있다가
// 매 요청마다 넘기고, 응답으로 갱신된 값을 돌려받아 다음 요청에 다시 실어보낸다.
// 로그인도 같은 이유로 서버 세션이 아니라 클라이언트가 들고 있는 {name, phone}을 매 요청마다
// 실어보내는 방식이다 — 비밀번호 없는 자가등록형이라 phone이 곧 계정 식별자.
//
// 프로젝트 카탈로그는 2026-08-25부터 DB(projects 테이블) 기반 — 사용자가 "등록"으로 직접 추가한다.
// (기존 data/projects.json 정적 카탈로그는 비웠음.)

import { supabase, type ApplicationRow } from "@/lib/supabase";
import { ALL_SKILLS, gradeFor, type Project } from "@/lib/projects";
import { fetchProjects, createProject } from "@/lib/projectsDb";
import { extractEmail, extractPhone, findOrCreateUser, getUserByPhone, normalizePhone, type Session } from "@/lib/auth";
import { getOwnedProjectIds } from "@/lib/pmMap";
import { interpret, type AiResult } from "@/lib/aiCommand";
import { getConnectStats } from "@/lib/connect";

export type CommandContext = {
  session: Session | null;
  lastProjectId: string | null;
};

export type CommandResult = {
  output: string;
  lastProjectId: string | null;
  /** undefined = 세션 변화 없음, null = 로그아웃, Session = 로그인/갱신 */
  session?: Session | null;
};

const KNOWN_CMDS = new Set([
  "도움말", "help", "프로필", "스킬", "스킬추가", "스킬삭제", "매칭", "방", "신청", "개수", "로그인", "로그아웃",
  "내신청", "내프로젝트", "수락", "거절", "등록",
]);

function resolveProjectIdScored(text: string, projects: Project[]): { id: string | null; score: number } {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const p of projects) {
    const tokens = p.title.split(/[\s/·&\-()]+/).filter((t) => t.length >= 2);
    let score = 0;
    for (const t of tokens) {
      const idx = text.indexOf(t);
      if (idx === -1) continue;
      const before = idx > 0 ? text[idx - 1] : " ";
      const after = idx + t.length < text.length ? text[idx + t.length] : " ";
      if (/[가-힣]/.test(before) || /[가-힣]/.test(after)) continue;
      score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }
  return { id: bestId, score: bestScore };
}

function pickTarget(text: string, pid: string | null, lastProjectId: string | null, projects: Project[]): string | null {
  const { id: weakId, score } = resolveProjectIdScored(text, projects);
  if (pid) return pid;
  if (score >= 2) return weakId;
  if (lastProjectId) return lastProjectId;
  return weakId;
}

/** "로그인 이준호 01012345678 junho@x.com" 형태로 정규화. 이름/전화 못 찾으면 null. */
function tryParseLogin(text: string): string | null {
  const phone = extractPhone(text);
  if (!phone) return null;
  const email = extractEmail(text);

  let nameMatch = text.match(/(?:이름은|이름|나는)\s*([가-힣A-Za-z0-9]{2,10})/);
  let name = nameMatch ? nameMatch[1] : null;

  if (!name) {
    let remain = text;
    if (email) remain = remain.replace(email, " ");
    remain = remain.replace(/01[0-9][-\s]?\d{3,4}[-\s]?\d{4}/, " ");
    for (const s of ["로그인", "할래", "할게", "해줘", "번호는", "번호", "전화번호는", "전화번호", "전화", "이야", "이고", "이고요", "이에요", "예요", "야"]) {
      remain = remain.split(s).join(" ");
    }
    const tok = remain.trim().split(/\s+/).find((t) => /^[가-힣]{2,5}$/.test(t));
    name = tok ?? null;
  }

  if (!name) return null;
  return email ? `로그인 ${name} ${phone} ${email}` : `로그인 ${name} ${phone}`;
}

// 등록(구인) 의도로 볼 키워드. "프로젝트"만으로는 검색과 못 나누므로 등록 특화 표현을 본다.
const REGISTER_KEYS = [
  "등록", "올릴래", "올릴게", "올리고", "구인", "모집", "사람 구", "사람구",
  "만들 사람", "만들사람", "새 프로젝트", "새프로젝트", "프로젝트 만들", "프로젝트 낼", "프로젝트 열", "프로젝트 개설",
];

/** AI 없이 제목만 대충 뽑는 폴백 — 등록/구인 표현과 스킬어를 제거한 나머지. */
function heuristicTitle(text: string): string {
  let t = ` ${text} `;
  const drop = [
    "프로젝트를", "프로젝트", "등록할래", "등록할게", "등록해줘", "등록하고", "등록", "올릴래", "올릴게", "올리고 싶어", "올리고",
    "구인해줘", "구인", "모집해줘", "모집", "사람 구해요", "사람 구해", "사람구해", "만들 사람", "만들사람", "새로", "새 ", "좀", "해줘", "하고 싶어", "하고싶어", "할래", "할게", "필요해", "필요", "구하고 있어", "구하고", "있어",
  ];
  for (const d of drop) t = t.split(d).join(" ");
  for (const s of ALL_SKILLS) t = t.split(s).join(" ");
  t = t.replace(/[·,\-—:]+/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= 2 ? t : "";
}

/** 자연어 → 명령 문자열 변환. 매칭 실패 시 null. lastProjectId 갱신값도 함께 반환. */
function nlToCommand(
  line: string,
  lastProjectId: string | null,
  session: Session | null,
  projects: Project[]
): { command: string | null; lastProjectId: string | null } {
  const text = line.trim();

  if (["로그아웃", "로그아웃할래", "나갈래", "계정 나가", "로그아웃해줘"].some((k) => text.includes(k))) {
    return { command: "로그아웃", lastProjectId };
  }
  // 로그인 안 된 상태에서 전화번호가 보이면 "로그인"이라는 말이 없어도 로그인 시도로 간주
  if (text.includes("로그인") || (extractPhone(text) && (/이름|나는/.test(text) || !session))) {
    const loginCmd = tryParseLogin(text);
    if (loginCmd) return { command: loginCmd, lastProjectId };
  }

  // 서비스 현황(접속/대기 인원·대화방·등록 유저). 인사보다 먼저.
  if (["접속", "온라인", "몇 명", "몇명", "대기 인원", "대기인원", "현황판", "통계", "사람 수", "사람수", "인원"].some((k) => text.includes(k))) {
    return { command: "통계", lastProjectId };
  }
  // 인사
  if (["안녕", "하이", "ㅎㅇ", "반가", "hello"].some((k) => text.includes(k))) {
    return { command: "인사", lastProjectId };
  }

  const pidMatch = text.match(/(prj-[a-z0-9-]+)/i);
  const pid = pidMatch ? pidMatch[1].toLowerCase() : null;

  if (["몇개", "몇 개", "몇건", "몇 건", "개수", "갯수", "프로젝트 수", "총 몇"].some((k) => text.includes(k))) {
    return { command: "개수", lastProjectId };
  }

  if (["내 신청", "내가 신청", "신청한 거", "신청 목록", "내 신청현황"].some((k) => text.includes(k))) {
    return { command: "내신청", lastProjectId };
  }
  if (["내 프로젝트", "내프로젝트", "누가 신청했", "신청자 누구", "신청자 확인"].some((k) => text.includes(k))) {
    return { command: "내프로젝트", lastProjectId };
  }

  // PM이 자기 프로젝트 신청자를 수락/거절.
  const acceptMatch = text.match(/([가-힣A-Za-z0-9]{2,10})\s*님?\s*(?:을|를)?\s*(수락|승인)/);
  if (acceptMatch) {
    return { command: `수락 ${acceptMatch[1]}`, lastProjectId };
  }
  const rejectMatch = text.match(/([가-힣A-Za-z0-9]{2,10})\s*님?\s*(?:을|를)?\s*(거절|반려)/);
  if (rejectMatch) {
    return { command: `거절 ${rejectMatch[1]}`, lastProjectId };
  }

  // 새 프로젝트 등록/구인 — 검색("프로젝트" 키워드)보다 먼저 잡아야 함.
  if (REGISTER_KEYS.some((k) => text.includes(k))) {
    return { command: "등록", lastProjectId };
  }

  if (
    ["현황", "상태", "누구", "신청자"].some((k) => text.includes(k)) ||
    (pid && ["보여줘", "어때"].some((k) => text.includes(k)))
  ) {
    const target = pickTarget(text, pid, lastProjectId, projects);
    if (target) return { command: `방 ${target}`, lastProjectId: target };
  }

  if (["신청", "지원", "참여", "들어가", "하고싶", "관심있"].some((k) => text.includes(k))) {
    const target = pickTarget(text, pid, lastProjectId, projects);
    if (target) {
      const nameMatch = text.match(/(?:내\s*이름은|나는)\s*([가-힣A-Za-z0-9]+)/);
      const name = nameMatch ? nameMatch[1] : session?.name ?? "나";
      return { command: `신청 ${target} ${name}`, lastProjectId: target };
    }
  }

  if (pid) {
    return { command: `방 ${pid}`, lastProjectId: pid };
  }

  // 스킬 추가/삭제는 전체 교체보다 먼저.
  if (text.includes("스킬") && ["추가", "넣어", "넣고", "더해"].some((k) => text.includes(k))) {
    const found = ALL_SKILLS.filter((s) => text.includes(s));
    if (found.length) return { command: `스킬추가 ${found.join(",")}`, lastProjectId };
  }
  if (text.includes("스킬") && ["삭제", "빼줘", "빼고", "제거", "지워"].some((k) => text.includes(k))) {
    const found = ALL_SKILLS.filter((s) => text.includes(s));
    if (found.length) return { command: `스킬삭제 ${found.join(",")}`, lastProjectId };
  }

  if (["스킬은", "스킬을", "스킬 바꿔", "스킬 설정", "내 스킬"].some((k) => text.includes(k))) {
    const found = ALL_SKILLS.filter((s) => text.includes(s));
    if (found.length) return { command: `스킬 ${found.join(",")}`, lastProjectId };
  }

  if (["내 프로필", "프로필 보여줘", "내 정보"].some((k) => text.includes(k))) {
    return { command: "프로필", lastProjectId };
  }

  if (["찾아줘", "추천", "매칭", "할만한", "있어?", "있나", "뭐가 있", "프로젝트"].some((k) => text.includes(k))) {
    const stop = [
      "찾아줘", "추천해줘", "추천", "매칭해줘", "매칭", "할만한거", "있어?", "있나", "뭐가있어",
      "프로젝트", "좀", "해줘", "알려줘", "보여줘", "?", "관련된", "관련", "분야", "쪽으로", "쪽", "등의", "등",
      "나와 맞는", "나한테 맞는", "나한테", "나와", "맞는", "적합한", "어울리는", "괜찮은",
    ];
    let remain = text;
    for (const s of stop) remain = remain.split(s).join("");
    remain = remain.trim();
    return { command: remain ? `매칭 ${remain}` : "매칭", lastProjectId };
  }

  return { command: null, lastProjectId };
}

/** AI가 준 구조화된 의도 → 실제 명령 문자열. */
function aiToCommand(
  ai: AiResult,
  lastProjectId: string | null,
  session: Session | null,
  projects: Project[]
): { command: string | null; lastProjectId: string | null } {
  const kw = ai.keywords.join(" ").trim();
  switch (ai.intent) {
    case "count":
      return { command: "개수", lastProjectId };
    case "stats":
      return { command: "통계", lastProjectId };
    case "my_applications":
      return { command: "내신청", lastProjectId };
    case "my_projects":
      return { command: "내프로젝트", lastProjectId };
    case "profile":
      return { command: "프로필", lastProjectId };
    case "logout":
      return { command: "로그아웃", lastProjectId };
    case "help":
      return { command: "도움말", lastProjectId };
    case "register":
      return { command: "등록", lastProjectId };
    case "skill_set":
      return ai.skills.length ? { command: `스킬 ${ai.skills.join(",")}`, lastProjectId } : { command: null, lastProjectId };
    case "skill_add":
      return ai.skills.length ? { command: `스킬추가 ${ai.skills.join(",")}`, lastProjectId } : { command: null, lastProjectId };
    case "skill_remove":
      return ai.skills.length ? { command: `스킬삭제 ${ai.skills.join(",")}`, lastProjectId } : { command: null, lastProjectId };
    case "status": {
      const target = pickTarget(kw, null, lastProjectId, projects);
      return target ? { command: `방 ${target}`, lastProjectId: target } : { command: null, lastProjectId };
    }
    case "apply": {
      const target = pickTarget(kw, null, lastProjectId, projects);
      if (!target) return { command: null, lastProjectId };
      const name = session?.name ?? "나";
      return { command: `신청 ${target} ${name}`, lastProjectId: target };
    }
    case "search": {
      const terms = [kw, ...ai.skills].filter(Boolean).join(" ").trim();
      return { command: terms ? `매칭 ${terms}` : "매칭", lastProjectId };
    }
    default:
      return { command: null, lastProjectId };
  }
}

async function readApps(projectId: string): Promise<ApplicationRow[]> {
  const { data, error } = await supabase
    .from("applications")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`신청 현황 조회 실패: ${error.message}`);
  return data ?? [];
}

const STATUS_LABEL: Record<ApplicationRow["status"], string> = {
  pending: "대기중",
  accepted: "수락됨",
  rejected: "거절됨",
};

function roomLines(rows: ApplicationRow[], title: string): string[] {
  const out: string[] = [];
  if (!rows.length) {
    out.push(`『${title}』 신청 기록 없음. "여기 신청할래" 처럼 말해봐.`);
    return out;
  }
  out.push(`『${title}』 신청 현황 (${rows.length}명):`);
  for (const r of rows) {
    out.push(`  ${r.applicant.padEnd(8, " ")} ${r.role.padEnd(6, " ")} [${STATUS_LABEL[r.status]}]`);
  }
  return out;
}

const LOGIN_HELP = '로그인하려면: "로그인 <이름> <전화번호> <이메일>" (이메일 필수 — 다시 연락하려면 필요해) 또는 "이름은 이준호, 번호는 010-1234-5678, 이메일은 junho@psynet.co.kr로 로그인해줘"처럼 말해봐.';

export async function processCommand(rawLine: string, ctx: CommandContext): Promise<CommandResult> {
  const line = rawLine.trim();
  if (!line) return { output: "", lastProjectId: ctx.lastProjectId };

  // 프로젝트 카탈로그(DB)를 요청 시작 시 1회 로드해 파서/핸들러가 공유.
  const projects = await fetchProjects();
  const byId = new Map(projects.map((p) => [p.id, p]));
  const getP = (id: string): Project | undefined => byId.get(id.toLowerCase());
  const titleOf = (id: string): string => getP(id)?.title ?? id;

  let parts = line.split(/\s+/);
  let cmd = parts[0];
  let lastProjectId = ctx.lastProjectId;

  if (!KNOWN_CMDS.has(cmd)) {
    const converted = nlToCommand(line, ctx.lastProjectId, ctx.session, projects);
    lastProjectId = converted.lastProjectId;
    if (converted.command) {
      parts = converted.command.split(/\s+/);
      cmd = parts[0];
    } else {
      // 규칙 파서가 못 잡음 → AI 폴백(키 없으면 null).
      const ai = await interpret(line);
      if (ai) {
        const aiCmd = aiToCommand(ai, lastProjectId, ctx.session, projects);
        lastProjectId = aiCmd.lastProjectId;
        if (aiCmd.command) {
          parts = aiCmd.command.split(/\s+/);
          cmd = parts[0];
        }
      }
    }
  }

  const out: string[] = [];

  try {
    if (cmd === "도움말" || cmd === "help") {
      out.push('사용법: 프로젝트명을 그대로 말하면 됨. 예) "다크모드 프로젝트 찾아줘" / "거기 신청할래" / "현황 어때?" / "내 신청 보여줘" / "내 프로젝트에 누가 신청했어?" / "<이름> 수락해줘"(PM 전용) / "프로젝트 등록할래"(새 프로젝트 구인) / "마케팅 스킬 추가해줘" / "지금 몇 명 접속했어?"(현황) / 스킬 <a,b,c>(전체 교체) / 이메일 <주소>(등록·변경) / 로그인 <이름> <전화번호> <이메일>');
    } else if (cmd === "로그인") {
      const name = parts[1];
      const phone = parts[2] ? normalizePhone(parts[2]) : null;
      const emailArg = parts[3] && /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(parts[3]) ? parts[3] : null;
      const existingUser = phone ? await getUserByPhone(phone) : null;
      const effectiveEmail = emailArg ?? existingUser?.email ?? null;
      if (!name || !phone) {
        out.push(`[오류] 이름/전화번호를 못 읽었어. ${LOGIN_HELP}`);
      } else if (!effectiveEmail) {
        out.push(`[오류] 이메일이 필요해 — 다시 연락하려면 이메일이 꼭 있어야 해. ${LOGIN_HELP}`);
      } else {
        const user = await findOrCreateUser(name, phone, effectiveEmail);
        out.push(`${user.name}님, 로그인 완료. 이제 "AI/ML 프로젝트 찾아줘"처럼 바로 검색해봐.`);
        out.push(`이메일: ${user.email}`);
        if (user.skills.length) out.push(`저장된 스킬: ${user.skills.join(", ")}`);
        return { output: out.join("\n"), lastProjectId, session: { name: user.name, phone: user.phone } };
      }
    } else if (cmd === "로그아웃") {
      out.push("로그아웃 됐어.");
      return { output: out.join("\n"), lastProjectId, session: null };
    } else if (cmd === "프로필") {
      if (!ctx.session) {
        out.push(`아직 로그인 안 했어. ${LOGIN_HELP}`);
      } else {
        const user = await getUserByPhone(ctx.session.phone);
        if (!user) {
          out.push(`아직 로그인 안 했어. ${LOGIN_HELP}`);
        } else {
          out.push(`이름: ${user.name}`);
          out.push(`이메일: ${user.email || "(미설정)"}`);
          out.push(`스킬: ${user.skills.join(", ") || "(미설정)"}`);
          out.push(`완료 프로젝트: ${user.completed_projects.join(", ") || "없음"}`);
        }
      }
    } else if ((cmd === "이메일" || cmd === "email") && parts.length >= 2) {
      if (!ctx.session) {
        out.push(`이메일을 등록하려면 먼저 로그인해야 해. ${LOGIN_HELP}`);
      } else {
        const addr = parts.slice(1).join("").trim();
        if (!/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(addr)) {
          out.push(`이메일 형식이 이상해: "${addr}". 예) 이메일 junho@psynet.co.kr`);
        } else {
          const { error } = await supabase.from("users").update({ email: addr }).eq("phone", ctx.session.phone);
          if (error) throw new Error(error.message);
          out.push(`이메일 등록됨: ${addr} — 이제 다시 연락할 수 있어. 고마워!`);
        }
      }
    } else if (cmd === "등록") {
      if (!ctx.session) {
        out.push(`프로젝트를 등록하려면 먼저 로그인해야 해. ${LOGIN_HELP}`);
      } else {
        // 스킬은 결정적으로 스캔, 제목/설명은 AI(가능하면)로 추출·없으면 휴리스틱.
        const scanned = ALL_SKILLS.filter((s) => line.includes(s));
        let title = "";
        let summary = "";
        const ai = await interpret(line);
        if (ai && ai.intent === "register") {
          title = (ai.title ?? "").trim();
          summary = (ai.summary ?? "").trim();
          for (const s of ai.skills) if (!scanned.includes(s)) scanned.push(s);
        }
        if (!title) title = heuristicTitle(line);
        if (!title) {
          out.push('프로젝트 제목을 못 읽었어. 제목을 넣어서 다시 말해줘 — 예) "AI 사내 상담봇 프로젝트 등록할래. 백엔드·AI/ML 필요, 사내 문의 자동응답이야"');
        } else {
          const project = await createProject({
            title,
            summary,
            required_skills: scanned,
            pmName: ctx.session.name,
            pmPhone: ctx.session.phone,
          });
          // PM 소유권 매핑(내프로젝트/수락/거절에서 실명 대조에 사용)
          const { error: mapErr } = await supabase
            .from("project_pm_map")
            .upsert({ project_id: project.id, pm_full_name: ctx.session.name }, { onConflict: "project_id" });
          if (mapErr) throw new Error(mapErr.message);
          out.push(`『${project.title}』 등록 완료! 이제 네가 이 프로젝트의 PM이야.`);
          out.push(`필요 스킬: ${scanned.join(", ") || "(미지정 — \"스킬\"로 나중에 추가 가능)"}`);
          if (summary) out.push(`소개: ${summary}`);
          out.push(`이제 다른 사람들이 검색·신청할 수 있어. "내 프로젝트"로 신청자를 관리해.`);
          lastProjectId = project.id;
        }
      }
    } else if (cmd === "스킬" && parts.length >= 2) {
      if (!ctx.session) {
        out.push(`스킬을 저장하려면 먼저 로그인해야 해. ${LOGIN_HELP}`);
      } else {
        const newSkills = parts[1].split(",").map((s) => s.trim()).filter(Boolean);
        const { error } = await supabase
          .from("users")
          .update({ skills: newSkills })
          .eq("phone", ctx.session.phone);
        if (error) throw new Error(error.message);
        out.push(`스킬 저장됨: ${newSkills.join(", ")}`);
      }
    } else if ((cmd === "스킬추가" || cmd === "스킬삭제") && parts.length >= 2) {
      if (!ctx.session) {
        out.push(`스킬을 바꾸려면 먼저 로그인해야 해. ${LOGIN_HELP}`);
      } else {
        const requested = parts[1].split(",").map((s) => s.trim()).filter(Boolean);
        const invalid = requested.filter((s) => !ALL_SKILLS.includes(s as (typeof ALL_SKILLS)[number]));
        const valid = requested.filter((s) => ALL_SKILLS.includes(s as (typeof ALL_SKILLS)[number]));

        if (!valid.length) {
          out.push(`인식 못한 스킬이야: ${invalid.join(", ")}. 사용 가능: ${ALL_SKILLS.join(", ")}`);
        } else {
          const user = await getUserByPhone(ctx.session.phone);
          const current = user?.skills ?? [];
          const nextSkills =
            cmd === "스킬추가"
              ? Array.from(new Set([...current, ...valid]))
              : current.filter((s) => !valid.includes(s));
          const { error } = await supabase
            .from("users")
            .update({ skills: nextSkills })
            .eq("phone", ctx.session.phone);
          if (error) throw new Error(error.message);
          out.push(`${cmd === "스킬추가" ? "추가됨" : "삭제됨"}: ${valid.join(", ")}`);
          if (invalid.length) out.push(`(인식 못한 스킬 무시: ${invalid.join(", ")})`);
          out.push(`현재 스킬: ${nextSkills.join(", ") || "(없음)"}`);
        }
      }
    } else if (cmd === "개수") {
      out.push(`등록 프로젝트: 총 ${projects.length}건`);
    } else if (cmd === "매칭") {
      const keywordTokens = parts.slice(1);
      const user = ctx.session ? await getUserByPhone(ctx.session.phone) : null;
      const skills = user?.skills ?? [];
      const hasHistory = (user?.completed_projects.length ?? 0) > 0;
      const results = projects
        .filter((p) => {
          const haystack = `${p.title} ${p.required_skills.join(" ")}`;
          return keywordTokens.every((t) => haystack.includes(t));
        })
        .map((p) => {
          const overlap = p.required_skills.filter((s) => skills.includes(s));
          const label = hasHistory ? gradeFor(skills, p.required_skills) : "신규";
          return { p, label, overlap };
        });
      if (!ctx.session) out.push(`(로그인하면 내 스킬 기준으로 등급이 매겨져. ${LOGIN_HELP})`);
      out.push(`매칭 결과 ${results.length}건:`);
      for (const { p, label, overlap } of results.slice(0, 15)) {
        out.push(`  [${label}] ${p.title}`);
        out.push(`       요구:${p.required_skills.join(",") || "-"}  일치:${overlap.join(",") || "없음"}`);
      }
      if (results.length > 15) out.push(`  ...외 ${results.length - 15}건 (검색어로 좁혀봐)`);
      if (!results.length && !projects.length) out.push(`  아직 등록된 프로젝트가 없어. "프로젝트 등록할래"로 첫 프로젝트를 올려봐.`);
      if (results.length === 1) lastProjectId = results[0].p.id;
    } else if (cmd === "방" && parts.length >= 2) {
      const pid = parts[1];
      const project = getP(pid);
      if (!project) {
        out.push(`알 수 없는 프로젝트: ${pid}`);
      } else {
        const rows = await readApps(project.id);
        out.push(...roomLines(rows, project.title));
        lastProjectId = project.id;
      }
    } else if (cmd === "신청" && parts.length >= 3) {
      const pid = parts[1];
      const name = parts[2];
      const role = parts[3] ?? "참여자";
      const project = getP(pid);
      if (!project) {
        out.push(`알 수 없는 프로젝트: ${pid}`);
      } else {
        const existing = (await readApps(project.id)).find((r) => r.applicant === name);
        if (existing && existing.status !== "rejected") {
          out.push(`『${project.title}』에 이미 신청했어 (상태: ${STATUS_LABEL[existing.status]}).`);
        } else {
          const { error } = await supabase.from("applications").insert({
            project_id: project.id,
            applicant: name,
            role,
            status: "pending",
          });
          if (error) throw new Error(error.message);
          out.push(`『${project.title}』에 ${name}(${role}) 신청 등록됨. PM 수락을 기다려줘.`);
        }
        lastProjectId = project.id;
      }
    } else if (cmd === "내신청") {
      if (!ctx.session) {
        out.push(`아직 로그인 안 했어. ${LOGIN_HELP}`);
      } else {
        const { data, error } = await supabase
          .from("applications")
          .select("*")
          .eq("applicant", ctx.session.name)
          .order("created_at", { ascending: true });
        if (error) throw new Error(error.message);
        const rows = (data ?? []) as ApplicationRow[];
        if (!rows.length) {
          out.push('신청한 프로젝트 없음. "다크모드 프로젝트 신청할래"처럼 말해봐.');
        } else {
          out.push(`내 신청 현황 (${rows.length}건):`);
          for (const r of rows) {
            out.push(`  ${titleOf(r.project_id).padEnd(20, " ")} [${STATUS_LABEL[r.status]}]`);
          }
        }
      }
    } else if (cmd === "내프로젝트") {
      if (!ctx.session) {
        out.push(`아직 로그인 안 했어. ${LOGIN_HELP}`);
      } else {
        const ownedIds = await getOwnedProjectIds(ctx.session.name);
        if (!ownedIds.length) {
          out.push('PM으로 등록된 프로젝트 없음. "프로젝트 등록할래"로 새로 열 수 있어.');
        } else {
          let total = 0;
          for (const pid of ownedIds) {
            const rows = await readApps(pid);
            if (!rows.length) continue;
            total += rows.length;
            out.push(`『${titleOf(pid)}』`);
            for (const r of rows) {
              out.push(`  ${r.applicant.padEnd(8, " ")} ${r.role.padEnd(6, " ")} [${STATUS_LABEL[r.status]}]`);
            }
          }
          if (!total) out.push("내 프로젝트에 아직 신청자 없음.");
          else out.push(`("<이름> 수락해줘" / "<이름> 거절해줘"로 바로 처리 가능)`);
        }
      }
    } else if ((cmd === "수락" || cmd === "거절") && parts.length >= 2) {
      if (!ctx.session) {
        out.push(`아직 로그인 안 했어. ${LOGIN_HELP}`);
      } else {
        const explicitPid = parts.length >= 3 && getP(parts[1]) ? getP(parts[1])!.id : null;
        const name = explicitPid ? parts[2] : parts[1];
        const ownedIds = await getOwnedProjectIds(ctx.session.name);

        if (!ownedIds.length) {
          out.push("PM으로 등록된 프로젝트가 없어서 처리할 수 없어.");
        } else if (explicitPid && !ownedIds.includes(explicitPid)) {
          out.push(`『${titleOf(explicitPid)}』의 PM이 아니라서 처리할 수 없어.`);
        } else {
          const candidateIds = explicitPid ? [explicitPid] : ownedIds;
          const matches: { pid: string; row: ApplicationRow }[] = [];
          for (const cid of candidateIds) {
            const rows = await readApps(cid);
            const match = rows.find((r) => r.applicant === name && r.status === "pending");
            if (match) matches.push({ pid: cid, row: match });
          }

          if (!matches.length) {
            out.push(`대기중인 "${name}"의 신청을 못 찾았어.`);
          } else if (matches.length > 1) {
            out.push(
              `"${name}"이(가) 여러 프로젝트에 대기중이야. 프로젝트를 지정해줘: ${matches
                .map((m) => titleOf(m.pid))
                .join(", ")}`
            );
          } else {
            const { pid: mpid, row } = matches[0];
            const status = cmd === "수락" ? "accepted" : "rejected";
            const { error } = await supabase.from("applications").update({ status }).eq("id", row.id);
            if (error) throw new Error(error.message);
            out.push(`『${titleOf(mpid)}』 ${name} 신청 ${cmd === "수락" ? "수락" : "거절"} 처리 완료.`);
          }
        }
      }
    } else if (cmd === "통계" || cmd === "현황판") {
      const [{ waiting, activeRooms }, { count: users }] = await Promise.all([
        getConnectStats(),
        supabase.from("users").select("*", { count: "exact", head: true }),
      ]);
      const inChat = activeRooms * 2; // 방당 2명
      out.push(`지금 매칭 대기 ${waiting}명 · 대화 중인 방 ${activeRooms}개(참여 ${inChat}명)`);
      out.push(`등록 유저 누적 ${users ?? 0}명 · 프로젝트 ${projects.length}건`);
      out.push(`(실시간 접속 정밀 추적은 안 해 — 매칭 대기·대화 현황 기준)`);
    } else if (cmd === "인사") {
      out.push(`안녕! 프로젝트 마켓이야. 편하게 말하면 돼 — 예) "AI 관련 프로젝트 찾아줘", "프로젝트 등록할래", "지금 몇 명 접속했어?". 자세한 건 '도움말'.`);
    } else {
      out.push(`모르는 명령어: ${line}  ('도움말' 입력)`);
    }
  } catch (e) {
    out.push(`[오류] ${e instanceof Error ? e.message : String(e)}`);
  }

  return { output: out.join("\n"), lastProjectId };
}

export type { Project };
