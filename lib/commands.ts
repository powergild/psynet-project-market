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
import { fetchProjects, createProject, getProjectOwnerPhone, deleteProjectCascade, updateProjectTitle, updateProjectStatus } from "@/lib/projectsDb";
import { extractEmail, extractPhone, findOrCreateUser, getUserByPhone, normalizePhone, type Session } from "@/lib/auth";
import { getOwnedProjectIds } from "@/lib/pmMap";
import { interpret, type AiResult } from "@/lib/aiCommand";
import { getConnectStats } from "@/lib/connect";

// 여러 턴에 걸친 대화 상태(메모리). lastProjectId처럼 클라이언트가 들고 매 요청에 실어보낸다.
export type Pending =
  | { kind: "register"; step: "title" | "skills" | "summary" | "confirm"; draft: { title?: string; skills?: string[]; summary?: string } }
  | { kind: "delete"; projectId: string; title: string }
  | { kind: "rename"; projectId: string; oldTitle: string }
  | { kind: "status"; projectId: string; title: string }
  | null;

// 프로젝트 상태 값(사용자 선택지). recruiting 필터는 "모집중"만 구인으로 침(page/recruiting).
const STATUS_OPTIONS = ["모집중", "마감", "진행중", "완료", "보류"];
function pickStatus(t: string): string | null {
  if (/마감|모집\s*완료|모집완료|그만\s*뽑|다\s*구했|충원\s*완료/.test(t)) return "마감";
  if (/완료|끝났|끝냈|종료|런칭|출시|배포했/.test(t)) return "완료";
  if (/보류|중단|홀드|멈춰|일시\s*정지|잠정/.test(t)) return "보류";
  if (/진행중|진행\s*중|개발\s*중|한창|착수|시작했/.test(t)) return "진행중";
  if (/모집중|다시\s*모집|재개|모집\s*재개|사람\s*더|더\s*구|다시\s*열|오픈/.test(t)) return "모집중";
  // 선택지 이름 직접 언급
  for (const s of STATUS_OPTIONS) if (t.includes(s)) return s;
  return null;
}

export type CommandContext = {
  session: Session | null;
  lastProjectId: string | null;
  pending?: Pending;
};

export type CommandResult = {
  output: string;
  lastProjectId: string | null;
  /** undefined = 세션 변화 없음, null = 로그아웃, Session = 로그인/갱신 */
  session?: Session | null;
  /** 진행 중인 대화 상태. null = 없음/초기화. */
  pending?: Pending;
};

const KNOWN_CMDS = new Set([
  "도움말", "help", "프로필", "스킬", "스킬추가", "스킬삭제", "매칭", "방", "신청", "개수", "로그인", "로그아웃",
  "내신청", "내프로젝트", "수락", "거절", "등록", "삭제", "제목수정", "상태변경",
]);

const isCancel = (t: string) => ["취소", "그만", "관둬", "됐어", "안할래", "안 할래"].some((k) => t.includes(k));
const YES = ["응", "네", "넵", "ㅇㅇ", "어", "그래", "맞아", "좋아", "해줘", "해", "확인", "yes", "ok", "오케이", "등록", "삭제", "지워"];
const NO = ["아니", "아냐", "아뇨", "노", "싫어", "안해", "no"];
const isYes = (t: string) => { const s = t.trim().toLowerCase(); return YES.some((k) => s === k.toLowerCase() || s.includes(k.toLowerCase())); };
const isNo = (t: string) => { const s = t.trim().toLowerCase(); return NO.some((k) => s === k.toLowerCase() || s.includes(k.toLowerCase())); };
const skipWord = (t: string) => ["없음", "없어", "없다", "건너뛰", "스킵", "패스", "몰라", "생략"].some((k) => t.includes(k));

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

  // 제목 수정 (본인 프로젝트)
  if (text.includes("제목") && ["수정", "바꿔", "변경", "고쳐", "바꾸", "바꿀", "바꾸고"].some((k) => text.includes(k))) {
    return { command: "제목수정", lastProjectId };
  }
  // 상태 변경 — 검색 오인 방지 위해 변경 동사/조사와 함께일 때만.
  const statusChangeHit =
    text.includes("상태") ||
    /마감|모집\s*완료|모집완료/.test(text) ||
    /(완료|보류|진행중|모집중)\s*(로|으로|만들|바꿔|변경)/.test(text) ||
    /(마감|완료|보류|재개|다시\s*모집)\s*(할래|해줘|하자|하고|시켜|됐)/.test(text);
  if (!text.includes("스킬") && statusChangeHit) {
    return { command: "상태변경", lastProjectId };
  }

  // 프로젝트 삭제 — "스킬 삭제"와 구분 위해 "스킬" 없을 때만. 등록보다 먼저(등록 취소류 오인 방지).
  if (!text.includes("스킬") && ["삭제", "지워", "없애", "내려"].some((k) => text.includes(k))) {
    return { command: "삭제", lastProjectId };
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
    case "delete":
      return { command: "삭제", lastProjectId };
    case "rename":
      return { command: "제목수정", lastProjectId };
    case "status_change":
      return { command: "상태변경", lastProjectId };
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

  let lastProjectId = ctx.lastProjectId;

  // ── 대화형 진행 상태(pending) 우선 처리 ── 여러 턴 맥락을 여기서 소비.
  const pending = ctx.pending ?? null;
  if (pending) {
    if (isCancel(line)) {
      return { output: "알겠어, 취소했어.", lastProjectId, pending: null };
    }
    if (pending.kind === "register") {
      const d = pending.draft;
      if (pending.step === "title") {
        const title = line.trim();
        if (title.length < 2) {
          return { output: "제목이 너무 짧아. 프로젝트 제목을 한 줄로 알려줘. (취소하려면 \"취소\")", lastProjectId, pending };
        }
        return {
          output: `제목: 『${title}』\n필요한 스킬 있어? ${ALL_SKILLS.join(" / ")} 중에서 골라 말해줘. (없으면 "없음")`,
          lastProjectId,
          pending: { kind: "register", step: "skills", draft: { ...d, title } },
        };
      }
      if (pending.step === "skills") {
        const skills = skipWord(line) ? [] : ALL_SKILLS.filter((s) => line.includes(s));
        return {
          output: `스킬: ${skills.join(", ") || "(없음)"}\n프로젝트 한 줄 소개 해줄래? (없으면 "없음")`,
          lastProjectId,
          pending: { kind: "register", step: "summary", draft: { ...d, skills } },
        };
      }
      if (pending.step === "summary") {
        const summary = skipWord(line) ? "" : line.trim();
        const dd = { ...d, summary };
        return {
          output:
            `이렇게 등록할게:\n  제목: 『${dd.title}』\n  스킬: ${(dd.skills ?? []).join(", ") || "(없음)"}\n  소개: ${summary || "(없음)"}\n등록할까? (응 / 아니)`,
          lastProjectId,
          pending: { kind: "register", step: "confirm", draft: dd },
        };
      }
      // confirm
      if (isNo(line)) return { output: "등록 취소했어.", lastProjectId, pending: null };
      if (isYes(line)) {
        if (!ctx.session) return { output: "로그인이 풀렸어. 다시 로그인하고 등록해줘.", lastProjectId, pending: null };
        try {
          const project = await createProject({
            title: d.title ?? "",
            summary: d.summary ?? "",
            required_skills: d.skills ?? [],
            pmName: ctx.session.name,
            pmPhone: ctx.session.phone,
          });
          const { error } = await supabase
            .from("project_pm_map")
            .upsert({ project_id: project.id, pm_full_name: ctx.session.name }, { onConflict: "project_id" });
          if (error) throw new Error(error.message);
          return {
            output: `『${project.title}』 등록 완료! 이제 네가 이 프로젝트의 PM이야. "내 프로젝트"로 신청자를 관리하고, 마음 바뀌면 "이거 삭제해줘"라고 하면 돼.`,
            lastProjectId: project.id,
            pending: null,
          };
        } catch (e) {
          return { output: `[오류] ${e instanceof Error ? e.message : String(e)}`, lastProjectId, pending: null };
        }
      }
      return { output: "등록할까? \"응\" 또는 \"아니\"로 답해줘.", lastProjectId, pending };
    }
    if (pending.kind === "delete") {
      if (isNo(line)) return { output: "삭제 취소했어.", lastProjectId, pending: null };
      if (isYes(line)) {
        try {
          await deleteProjectCascade(pending.projectId);
          return {
            output: `『${pending.title}』 삭제했어. 신청 기록도 함께 지웠어.`,
            lastProjectId: lastProjectId === pending.projectId ? null : lastProjectId,
            pending: null,
          };
        } catch (e) {
          return { output: `[오류] ${e instanceof Error ? e.message : String(e)}`, lastProjectId, pending: null };
        }
      }
      return { output: `『${pending.title}』 삭제할까? "응" 또는 "아니".`, lastProjectId, pending };
    }
    if (pending.kind === "rename") {
      const nt = line.trim();
      if (nt.length < 2) {
        return { output: '새 제목이 너무 짧아. 바꿀 제목을 한 줄로 알려줘. (취소하려면 "취소")', lastProjectId, pending };
      }
      try {
        await updateProjectTitle(pending.projectId, nt);
        return { output: `제목을 『${pending.oldTitle}』 → 『${nt}』(으)로 바꿨어.`, lastProjectId, pending: null };
      } catch (e) {
        return { output: `[오류] ${e instanceof Error ? e.message : String(e)}`, lastProjectId, pending: null };
      }
    }
    if (pending.kind === "status") {
      const st = pickStatus(line);
      if (!st) {
        return { output: `어떤 상태로 바꿀까? ${STATUS_OPTIONS.join(" / ")} 중에서 말해줘.`, lastProjectId, pending };
      }
      try {
        await updateProjectStatus(pending.projectId, st);
        const extra =
          st === "모집중" ? " 다시 구인 목록에 떠." : ["마감", "완료", "보류"].includes(st) ? " 구인 목록에서는 내려가." : "";
        return { output: `『${pending.title}』 상태를 "${st}"(으)로 바꿨어.${extra}`, lastProjectId, pending: null };
      } catch (e) {
        return { output: `[오류] ${e instanceof Error ? e.message : String(e)}`, lastProjectId, pending: null };
      }
    }
  }

  let parts = line.split(/\s+/);
  let cmd = parts[0];

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
      out.push('사용법: 프로젝트명을 그대로 말하면 됨. 예) "다크모드 프로젝트 찾아줘" / "거기 신청할래" / "현황 어때?" / "내 신청 보여줘" / "내 프로젝트에 누가 신청했어?" / "<이름> 수락해줘"(PM 전용) / "프로젝트 등록할래"(새 프로젝트 구인) / "이거 제목 바꿔줘" / "이거 마감해줘"(상태 변경) / "이거 삭제해줘" / "마케팅 스킬 추가해줘" / "지금 몇 명 접속했어?"(현황) / 스킬 <a,b,c>(전체 교체) / 이메일 <주소>(등록·변경) / 로그인 <이름> <전화번호> <이메일>');
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
        return { output: out.join("\n"), lastProjectId, session: { name: user.name, phone: user.phone }, pending: null };
      }
    } else if (cmd === "로그아웃") {
      out.push("로그아웃 됐어.");
      return { output: out.join("\n"), lastProjectId, session: null, pending: null };
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
        // 바로 만들지 않고 대화로 제목→스킬→소개→확인 순서로 물어본다(맥락 메모리 = pending).
        return {
          output: '새 프로젝트를 등록할게. 먼저 프로젝트 제목을 한 줄로 알려줘. (예: "AI 사내 상담봇")\n(취소하려면 "취소")',
          lastProjectId,
          pending: { kind: "register", step: "title", draft: {} },
        };
      }
    } else if (cmd === "삭제") {
      if (!ctx.session) {
        out.push(`프로젝트를 삭제하려면 먼저 로그인해야 해. ${LOGIN_HELP}`);
      } else {
        const explicitId = parts.length >= 2 && getP(parts[1]) ? getP(parts[1])!.id : null;
        const { id: nameId, score } = resolveProjectIdScored(line, projects);
        const targetId = explicitId ?? (score >= 2 ? nameId : null) ?? lastProjectId;
        if (!targetId) {
          out.push('어떤 프로젝트를 삭제할까? 프로젝트 이름을 말해줘. 예) "테스트봇 삭제해줘"');
        } else {
          const proj = getP(targetId);
          if (!proj) {
            out.push(`알 수 없는 프로젝트야: ${targetId}`);
          } else {
            const owner = await getProjectOwnerPhone(proj.id);
            if (owner && owner !== ctx.session.phone) {
              out.push(`『${proj.title}』은(는) 네가 등록한 게 아니라 삭제할 수 없어.`);
            } else {
              return {
                output: `『${proj.title}』을(를) 삭제할까? 신청 기록도 함께 사라져. (응 / 아니)`,
                lastProjectId,
                pending: { kind: "delete", projectId: proj.id, title: proj.title },
              };
            }
          }
        }
      }
    } else if (cmd === "제목수정") {
      if (!ctx.session) {
        out.push(`프로젝트를 수정하려면 먼저 로그인해야 해. ${LOGIN_HELP}`);
      } else {
        const explicitId = parts.length >= 2 && getP(parts[1]) ? getP(parts[1])!.id : null;
        const { id: nameId, score } = resolveProjectIdScored(line, projects);
        const targetId = explicitId ?? (score >= 2 ? nameId : null) ?? lastProjectId;
        if (!targetId) {
          out.push('어떤 프로젝트 제목을 바꿀까? 프로젝트 이름을 말해줘.');
        } else {
          const proj = getP(targetId);
          if (!proj) {
            out.push(`알 수 없는 프로젝트야: ${targetId}`);
          } else {
            const owner = await getProjectOwnerPhone(proj.id);
            if (owner && owner !== ctx.session.phone) {
              out.push(`『${proj.title}』은(는) 네가 등록한 게 아니라 수정할 수 없어.`);
            } else {
              return {
                output: `『${proj.title}』의 새 제목을 알려줘. (취소하려면 "취소")`,
                lastProjectId,
                pending: { kind: "rename", projectId: proj.id, oldTitle: proj.title },
              };
            }
          }
        }
      }
    } else if (cmd === "상태변경") {
      if (!ctx.session) {
        out.push(`프로젝트 상태를 바꾸려면 먼저 로그인해야 해. ${LOGIN_HELP}`);
      } else {
        const explicitId = parts.length >= 2 && getP(parts[1]) ? getP(parts[1])!.id : null;
        const { id: nameId, score } = resolveProjectIdScored(line, projects);
        const targetId = explicitId ?? (score >= 2 ? nameId : null) ?? lastProjectId;
        if (!targetId) {
          out.push('어떤 프로젝트 상태를 바꿀까? 프로젝트 이름을 말해줘.');
        } else {
          const proj = getP(targetId);
          if (!proj) {
            out.push(`알 수 없는 프로젝트야: ${targetId}`);
          } else {
            const owner = await getProjectOwnerPhone(proj.id);
            if (owner && owner !== ctx.session.phone) {
              out.push(`『${proj.title}』은(는) 네가 등록한 게 아니라 바꿀 수 없어.`);
            } else {
              // 한 문장에 상태값이 이미 있으면 바로 확정, 없으면 물어봄.
              const inline = pickStatus(line);
              if (inline) {
                await updateProjectStatus(proj.id, inline);
                const extra =
                  inline === "모집중" ? " 다시 구인 목록에 떠." : ["마감", "완료", "보류"].includes(inline) ? " 구인 목록에서는 내려가." : "";
                out.push(`『${proj.title}』 상태를 "${inline}"(으)로 바꿨어.${extra}`);
                lastProjectId = proj.id;
              } else {
                return {
                  output: `『${proj.title}』을(를) 어떤 상태로 바꿀까? ${STATUS_OPTIONS.join(" / ")} (현재: ${proj.status})`,
                  lastProjectId,
                  pending: { kind: "status", projectId: proj.id, title: proj.title },
                };
              }
            }
          }
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

  return { output: out.join("\n"), lastProjectId, pending: null };
}

export type { Project };
