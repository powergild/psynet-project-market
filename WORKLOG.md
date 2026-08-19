# WORKLOG — mitocreate-web

작업 이어받기용 로그. **Claude Desktop 앱 / Claude Code CLI 어느 쪽에서 작업하든 이 파일을 먼저 읽고, 작업이 끝나면 여기부터 갱신할 것.**

- 구조·규칙 설명은 [CLAUDE.md](./CLAUDE.md), 진행 상황·다음 할 일은 이 파일.
- 이 repo는 **public** — 실명·전화번호·비밀번호·DB URL 등은 여기 절대 쓰지 말 것.
- 기록 규칙: 최신 세션이 맨 위. 세션마다 `## YYYY-MM-DD` 헤더 + 한 일 / 남은 일 / 주의점.

---

## 현재 상태 (2026-08-19 기준)

| 항목 | 상태 |
|---|---|
| 브랜치 | `main` |
| 레포 | **`powergild/psynet-project-market`** (2026-08-19 이전됨) · **public** |
| 배포 | **`git push`만으로 Vercel 자동배포**(~45s Ready). Vercel 프로젝트는 junholee940930 계정. `vercel --prod` 불필요. |
| 이 PC 자격 | gh 활성계정 = **powergild**(레포 소유자). Vercel CLI = junholee940930(프로젝트 소유자). |

### ⚠️ 열린 작업 (다음 세션에서 제일 먼저 확인)

1. ~~**Supabase RPC 마이그레이션 적용**~~ ✅ **완료(2026-08-19)** — SQL Editor에서 `2026-08-18-connect-liveness.sql` 실행됨. `connect_match_or_queue` 12초 신선도 필터 동작, 유령 큐 0 확인.

2. 🔴 **관리자 비밀번호 교체 — 이제 "보류" 아님, 지금 필요 (2026-08-19 승격)**
   - repo가 **다시 public**이 됨(배포 위해) → **git history의 옛 비밀번호가 재노출**. private 전환 완화책이 무효화됨.
   - 감시(이상접근 알림)만으로는 부족 — **`ADMIN_PASSWORD`를 교체할 것.**
   - 절차: Vercel env `ADMIN_PASSWORD` 수정 → **`git push`(빈 커밋)로 자동재배포** → 로컬 `.env.local` 동기화. (sha256 토큰이라 교체 시 기존 관리자 쿠키 자동 무효화)
   - 대안(private 유지가 우선이면): repo 다시 private + Vercel을 powergild 계정으로 완전 이전(그래야 배포 유지). git history rewrite는 여전히 안 하기로 함(교체가 더 간단).

3. **알림 메일 활성화 — 사용자 조치 필요**
   - 코드는 완성됐지만 `RESEND_API_KEY`가 없으면 메일이 안 나가고 서버 로그에만 남는다.
   - [ ] `supabase/migrations/2026-08-19-admin-access-alert.sql`을 Supabase SQL Editor에서 실행 (선행 필수)
   - [ ] resend.com 가입 → API 키 발급 → Vercel env `RESEND_API_KEY` 등록
   - [ ] 도메인 인증 전이면 `ALERT_EMAIL_FROM=onboarding@resend.dev` (Resend 가입 계정 본인 메일로만 발송됨).
         `junholee940930@psynet.co.kr`로 받으려면 그 주소로 가입하거나 psynet.co.kr 도메인 인증 필요.
   - [ ] 재배포 후 일부러 비밀번호 틀리기 5회 → 알림 메일 오는지 확인

4. `.claude/launch.json` 변경 커밋할지 결정 (사소, 커밋해도 무방)


### 백로그 (급하지 않음)

- `connect_projects`(미토크리에이트에서 생성된 프로젝트)가 메인 카탈로그(`/projects`, "매칭" 명령)에 안 뜸 → `lib/projects.ts`를 정적 JSON 전용에서 DB 병합 구조로 바꿔야 하는 큰 리팩터.
- `data/projects.json` 재생성 파이프라인 없음 (매번 애드혹 스크립트). 엑셀 새로 받으면 다시 짜야 함.
- 이벤트형 매칭: 지금은 "상대가 큐에 있으면 상시 즉시 매칭". 향후 동시접속 N명 이상 / 특정 시간대에만 매칭 열리는 게이트를 `connect_match_or_queue` 앞단에 두는 구조 검토.


---

## 세션 로그

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
