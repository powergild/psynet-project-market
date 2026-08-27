# WORKLOG — mitocreate-web

작업 이어받기용 로그. **Claude Desktop 앱 / Claude Code CLI 어느 쪽에서 작업하든 이 파일을 먼저 읽고, 작업이 끝나면 여기부터 갱신할 것.**

- 구조·규칙 설명은 [CLAUDE.md](./CLAUDE.md), 진행 상황·다음 할 일은 이 파일.
- 이 repo는 **public** — 실명·전화번호·비밀번호·DB URL 등은 여기 절대 쓰지 말 것.
- 기록 규칙: 최신 세션이 맨 위. 세션마다 `## YYYY-MM-DD` 헤더 + 한 일 / 남은 일 / 주의점.

---

## 현재 상태 (2026-08-25 기준)

| 항목 | 상태 |
|---|---|
| 브랜치 | `main` |
| 레포 | **`powergild/psynet-project-market`** (2026-08-19 이전됨) · **public** |
| 배포 | **`git push`만으로 Vercel 자동배포**(~45s Ready). Vercel 프로젝트는 junholee940930 계정. `vercel --prod` 불필요. |
| 이 PC 자격 | gh 활성계정 = **powergild**(레포 소유자). Vercel CLI = junholee940930(프로젝트 소유자). |
| **서비스 단계** | **🚀 실서비스 전환 완료(2026-08-25)** — 시드 데이터 전부 삭제, 실사용자만 남김 |
| **users** | **3명**(이준호·김만지·박효신). 시즌2 시드 28명 삭제됨 |
| **프로젝트 카탈로그** | **DB `projects` 테이블**(정적 `data/projects.json`은 `[]`로 비움·폐기). 현재 0건 — 사용자가 터미널에서 직접 등록 |
| AI 해석 | `claude-haiku-4-5` **크레딧 정상**(2026-08-25 실측: 의도해석·yes/no 보조 동작) |

### ⚠️ 열린 작업 (다음 세션에서 제일 먼저 확인)

1. ~~**Supabase RPC 마이그레이션 적용**~~ ✅ **완료(2026-08-19)** — SQL Editor에서 `2026-08-18-connect-liveness.sql` 실행됨. `connect_match_or_queue` 12초 신선도 필터 동작, 유령 큐 0 확인.

2. ~~**관리자 비밀번호 교체**~~ ✅ **완료(2026-08-25)**
   - 배경: repo가 public이라 **git history에 옛 비밀번호가 그대로 남아 있었음**(현재 파일에서 지워도 삭제 커밋 diff에 값이 보존됨). 실측 확인: `172ee76`(2026-07-23 추가), `ff1ffc5`(2026-08-19 삭제) 두 커밋에서 조회 가능했음.
   - 조치: `ADMIN_PASSWORD`를 **강력한 랜덤 24자로 교체**(Vercel Production env + 로컬 `.env.local` 동기화) → 빈 커밋 `c3141dd`로 재배포. 검증: 배포 Ready, `/admin` 로그인 화면 정상(env 인식), 기존 관리자 쿠키는 sha256 해시 불일치로 전부 자동 무효화.
   - **git history rewrite는 하지 않음(불필요)** — GitHub 캐시/기존 clone에 남아 완전 제거가 불가능하고, 값이 이미 무효라 히스토리의 옛 값은 무해함. 다시 문제 제기하지 말 것.
   - ⚠️ 교훈: 비밀번호·키는 어떤 문서에도 적지 말 것(`CLAUDE.md`에 규칙 명시됨). 적었다면 파일 수정이 아니라 **값 교체**가 유일한 해결책.

3. **알림 메일 활성화 — 사용자 조치 필요**
   - 코드는 완성됐지만 `RESEND_API_KEY`가 없으면 메일이 안 나가고 서버 로그에만 남는다.
   - [ ] `supabase/migrations/2026-08-19-admin-access-alert.sql`을 Supabase SQL Editor에서 실행 (선행 필수)
   - [ ] resend.com 가입 → API 키 발급 → Vercel env `RESEND_API_KEY` 등록
   - [ ] 도메인 인증 전이면 `ALERT_EMAIL_FROM=onboarding@resend.dev` (Resend 가입 계정 본인 메일로만 발송됨).
         `junholee940930@psynet.co.kr`로 받으려면 그 주소로 가입하거나 psynet.co.kr 도메인 인증 필요.
   - [ ] 재배포 후 일부러 비밀번호 틀리기 5회 → 알림 메일 오는지 확인

4. `.claude/launch.json` 변경 커밋할지 결정 (사소, 커밋해도 무방)


### 백로그 (급하지 않음)

- ~~카탈로그 DB 병합 리팩터~~ ✅ **완료(2026-08-25)** — `projects` 테이블 + `lib/projectsDb.ts`로 전환.
- ~~`data/projects.json` 재생성 파이프라인 없음~~ → **불필요해짐**(엑셀 일괄시드 방식 폐기, 사용자 직접 등록).
- `connect_projects`(미토크리에이트 호감 성사 시 생성)는 아직 메인 카탈로그(`projects`)와 **별개** — 메인에서 검색·신청 안 됨. 통합하려면 `connect_projects` → `projects` 편입 로직 필요.
- 이벤트형 매칭: 지금은 "상대가 큐에 있으면 상시 즉시 매칭". 향후 동시접속 N명 이상 / 특정 시간대에만 매칭 열리는 게이트를 `connect_match_or_queue` 앞단에 두는 구조 검토.
- 대화형 확장 여지: 스킬 수정·소개(summary) 수정은 아직 대화형 없음(등록 시에만 입력). 같은 `pending` 패턴으로 추가 가능.
- `projects.max_participants` 미사용(등록 시 null). 모집 인원 개념 쓰려면 등록 대화에 스텝 추가 필요.


---

## 세션 로그

### 2026-08-25 (실서비스 전환 + 프로젝트 등록 기능 신설 + 대화형 UX)

**1. 🚀 실서비스 전환 — 데이터 초기화 (되돌릴 수 없는 작업, 백업 있음)**
- `users` **3명만 남기고 28명 삭제**(시즌2 시드 전원 + 이준호 사번 합성계정 `emp-00053`). 남은 계정: 이준호(실계정)·김만지·박효신.
- 프로젝트 연관 데이터 **전부 삭제**: `applications`·`project_participants`(296)·`project_pm_map`(99)·`connect_rooms/likes/projects`·`invites`·`negotiations` → 전부 0.
- `data/projects.json` 86건 → `[]`로 비우고 배포.
- **삭제 직전 전체 스냅샷 백업**: `source-data/_backup_prelaunch_2026-08-25T00-27-25-013Z.json` (**gitignore**, 실명 PII 포함, 복구용). ⚠️ 커밋 금지.

**2. 프로젝트 등록 기능 신설 + 카탈로그 DB 이관**
- 기존엔 **등록 기능 자체가 없었음**(엑셀 일괄시드만). 카탈로그를 비우면서 필수가 됨.
- **`projects` 테이블** 신설 → 선행 SQL `supabase/migrations/2026-08-25-projects-table.sql` **실행 완료**.
- `lib/projects.ts`는 **순수 헬퍼만**(gradeFor/ALL_SKILLS/타입 — client에서 import 안전), DB 접근은 **`lib/projectsDb.ts`**(서버 전용)로 분리 → 서비스키 클라이언트 누출 방지.
- 소비처 전부 DB 조회로 전환: 랜딩 `/`·`/start` 배너 카운트, `/admin`, `lib/admin.ts`, `lib/participants.ts`, `/api/recruiting`. `/projects`(client)는 신설 **`/api/projects`** 로 로드.
- 등록자가 곧 PM(`pm_phone`=소유자, `pm` 마스킹 표시) + `project_pm_map` 업서트로 수락/거절 권한 연결.

**3. 대화형 UX + 맥락 메모리(`pending`) — 사용자 피드백 반영**
- 문제: `"프로젝트 등록할래. 협업자 구해야하거든"` → **설명을 제목으로 오인해 즉시 생성**됐고, `"이거 삭제해줘"`는 아예 명령이 없었음. 원인 = 대화 맥락 메모리 부재.
- **`Pending` 상태**를 `lastProjectId`처럼 client↔server로 왕복시켜 여러 턴 기억(exec body `pending` 필드 + `Terminal.tsx` state).
- 대화형으로 전환/신설한 것:
  | 기능 | 흐름 |
  |---|---|
  | 등록 | "등록할래" → 제목 → 스킬 → 소개 → 확인 → 생성 |
  | 삭제 | "이거 삭제해줘" → 확인 → cascade 삭제(신청기록 포함) |
  | 제목수정 | "제목 바꿔줘" → 새 제목 → 변경 |
  | 상태변경 | "마감해줘"(인라인 즉시) / "상태 바꿔줘"(선택지 제시) |
  | 신청 | "신청할래" → **"참여자로 신청할까?"** 확인 → 등록 |
- 전 흐름 **"취소"로 이탈** 가능. 수정/삭제/상태변경은 **본인(pm_phone) 것만**.
- 상태값: `모집중/마감/진행중/완료/보류` — **모집중만 구인 목록 노출**. 자연어 매칭(`pickStatus`: "끝났어"→완료, "다시 모집"→모집중 등).

**4. 자연어 파서 버그 수정**
- `"프로젝트 뭐 있어?"` → **"뭐"를 검색어로 잡아 0건**이던 문제 → 의문사/목록성 스톱워드 + **토큰 기반 필터**(한글자 토큰 제거, "다"는 빼되 "다크모드"는 보존)로 수정. 남는 토큰 없으면 전체 목록.
- `"지금 등록된 프로젝트 다 보여줘"`가 **등록 의도로 오인**되던 문제 → `REGISTER_KEYS`를 **행위형만**(`등록할/등록하/등록해`)으로 좁힘. "등록된/등록한"은 목록으로.
- 삭제/제목수정/상태변경 대상 이름매칭 **완화(score>=1)** — 제목 일부만 말해도 인식(본인 것 + 확인 있어 안전).

**5. 확인(응/아니) 판정에 LLM 보조 — 하이브리드 승인 구조**
- `resolveConfirm`: **결정적 우선**(응/아니 등) → 애매하면 **`interpretYesNo`(Haiku)** → 키/크레딧 없으면 `unclear`로 **재질문**(오작동 대신 안전 실패).
- 실측: `"콜"`·`"그렇게 해줘"` → YES, `"됐어 하지마"` → NO 정상 인식.
- 설계 원칙: **의도해석/필드추출은 LLM, 승인 게이트·실행은 결정적 코드** — 크레딧 없어도 서비스 안 멈춤.

**6. 종합 인수테스트 — 24 PASS / 0 FAIL (라이브)**
- 3계정(PM 이준호 / 신청자 김만지·박효신)으로 권한·등록·검색·신청·수락·수정·상태·취소·삭제 전 경로 검증. 테스트 데이터 전부 정리(projects·applications 0 확인).

**7. 🔐 관리자 비밀번호 교체(열린작업 2 해소)**
- git history에 옛 값이 남아 public 조회 가능했던 것 확인(`172ee76`, `ff1ffc5`) → **랜덤 24자로 교체**, Vercel Production env + 로컬 `.env.local` 동기화, 빈 커밋 `c3141dd`로 재배포. 검증 완료(배포 Ready, `/admin` env 인식).
- 교체 스크립트는 임시 scratchpad에 만들어 씀(세션 종료 시 사라짐 — 필요하면 재작성). cmd.exe에는 bash가 PATH에 없어 실행 불가 → Git Bash를 열거나, Git 설치 경로의 bin/bash.exe를 전체 경로로 지정해 실행할 것.

**주의점(다음 세션)**
- 라이브 API 호출 테스트는 **Git Bash `curl`에서 한글이 깨짐** → Node `fetch` 스크립트로 할 것.
- `connect_queue`에 항목이 보여도 실사용자가 대기 중일 수 있음 — **joined_at 확인 후** 손댈 것(12초 신선도 필터가 유령은 자동 정리).

### 2026-08-19 (CLI 세션 · 배포 파이프라인 대수술)
- **🚨 배포 근본 원인 규명 + 해결**: 며칠간 push해도 프로덕션 반영 안 되던 것 = **Vercel Hobby가 "협업자(powergild)가 push한 private 레포 커밋"의 배포를 차단**하고 있었음(대시보드 "Deployment Blocked", CLI엔 status `UNKNOWN`으로 보임). 이 PC의 gh/git 자격이 powergild(협업자)였고 소유자는 junholee940930이라 발생.
  - 해결: **GitHub 레포를 `junholee940930/psynet-project-market` → `powergild/…`로 Transfer + 다시 public 전환**. → 협업 차단 소멸, 이제 **`git push`만으로 자동배포됨(실측: push 20s 뒤 배포 생성, ~45s Ready, 도메인 자동 반영)**. `vercel --prod` 불필요.
  - Vercel 프로젝트는 junholee940930 계정 그대로 둠(public이라 문제없음, 사용자 결정). 이 PC gh 활성계정=powergild(레포 소유자).
- **🔴 보안 후속(필수)**: repo를 다시 public으로 바꾸면서 **git history에 남아있는 옛 관리자 비밀번호가 재노출됨**(교체·history rewrite 안 된 상태). → **`ADMIN_PASSWORD` 교체 필요**(열린작업 2를 "보류"→"지금 교체"로 승격). private 유지가 우선이면 대신 Vercel을 powergild로 이전(A안) 후 다시 private.
- **connect liveness SQL 적용 완료** — 열린작업 1 해결. 사용자가 Supabase SQL Editor에서 `2026-08-18-connect-liveness.sql` 실행함. 확인: `connect_queue` 유령 0, 매칭 12초 신선도 필터 동작. (스코어러/스킬 매핑은 별도 `stove-league/`—이 repo 밖.)
- **AI 자연어 해석 라이브 복구** — 원인은 코드 아니라 **Anthropic 크레딧 부족**이었음. 사용자가 크레딧 충전 → `claude-haiku-4-5` 정상 작동(자유문장 검색 실측 통과).
- **현황/접속자 조회 + 인사 intent 추가**(`stats` intent + 규칙 트리거 + 핸들러). "지금 몇 명 접속했어?" → 대기/대화방/등록유저 수 응답, "안녕" → 친절 안내(기존 "모르는 명령어" 해소).
- **이메일 필수화** 라이브(로그인 시 이메일 필수, 기존 저장 이메일 있으면 자동충족) + `/start` 하단 메일 CTA + `이메일 <주소>` 명령.
- **터미널 환영 문구 예시 제거** — 로그인 인사에서 `예) "AI/ML 프로젝트 찾아줘"` 빼고 "뭐든 편하게 말해봐 — 알아서 알아들어."로(AI가 자유문장 해석하므로).
- 폴더명 `미토 웹페이지` → `mitocreate-web` 리네임(경로 참조 갱신 완료).

### 2026-08-19
- 작업 인계용 `WORKLOG.md` 신설 (Desktop 앱 ↔ CLI 양방향 이어받기 목적).
- 리포지토리 상태 점검: main 동기화 완료, 미커밋은 `.claude/launch.json` 하나뿐.
- 08-18 커밋의 Supabase SQL 적용이 미확인 상태임을 확인 → 위 "열린 작업 1"로 등록.
- **보안**: repo가 public이던 시절 `CLAUDE.md`에 관리자 비밀번호가 평문 노출된 것을 발견. repo는 private로 전환됨.
  - git history 전체 스캔 결과 **노출은 이 비밀번호 하나뿐**. `.env` 계열 커밋 이력 없음(`.env.example`만), Supabase 키/DB URL/API 키 없음(플레이스홀더만), `lib/adminAuth.ts`에 하드코딩 폴백 없음.
  - `CLAUDE.md`에서 값 제거 + "값 적지 말 것" 규칙 명시. 비밀번호 실제 교체는 위 "열린 작업 2" 참고.
- **관리자 이상 접근 알림 구현** (`lib/adminAlert.ts`, `lib/mailer.ts`, 마이그레이션 SQL, 관리자 라우트 3곳 연결).
  - 비밀번호 즉시 교체 대신 "유출 징후 감지 → 메일 알림 → 그때 교체" 방식으로 결정.
  - 수신 주소 `junholee940930@psynet.co.kr` (env `ALERT_EMAIL_TO`로 변경 가능).
  - 메일 전송은 Resend HTTP API(fetch만 사용, npm 의존성 추가 없음). 키 없으면 서버 로그 폴백.
  - `npm run build` 통과 확인.
- **`/start` 화면의 명령어 예시 그리드 제거** — "이렇게 말하면 돼요" 10개 목록이 "이 10개만 된다"로 읽혀 자연어 컨셉과 충돌. `lib/examples.ts`, `app/globals.css`의 `.examples*` 블록까지 같이 삭제. 온보딩 힌트는 터미널 첫 줄 한 줄로 충분.
- **자연어 해석 모델 확인** — 이미 `claude-haiku-4-5`(현재 최신 Haiku, 날짜 접미사 없는 정식 ID)라 변경 불필요. 호출부도 정상(Haiku 4.5 미지원인 `effort` 미사용).

### 2026-08-18 (커밋 기록 기반 요약)
- `4403a61` connect 매칭 실시간 접속자만 필터링 (유령 대기자 방어) + 마이그레이션 SQL·적용 스크립트 추가
- `f37b678` 자체호스팅 CLI 백엔드 제거 — 자연어 해석은 API 백엔드로 확정
- `00a59a2` (되돌려짐) 자연어 해석 CLI 백엔드(`claude -p`) 추가 시도
- `2df23e3` 이메일 필수화 + 재연락 채널 강화

### 2026-07-29 이전
- `/start` 화면 구인 배너 중심으로 정리, "지금 구인 중 프로젝트" 화면 추가
- 폐쇄형 추천/초대 구조 제거 (로그인만으로 참여)
- 호감 성사 시 상대 참여 프로젝트 선택 기능 + 참여자 관리, 시즌1 시뮬레이션 봇 제거
- 자연어 명령 AI 폴백 모델 정리
