# WORKLOG — mitocreate-web

작업 이어받기용 로그. **Claude Desktop 앱 / Claude Code CLI 어느 쪽에서 작업하든 이 파일을 먼저 읽고, 작업이 끝나면 여기부터 갱신할 것.**

- 구조·규칙 설명은 [CLAUDE.md](./CLAUDE.md), 진행 상황·다음 할 일은 이 파일.
- 이 repo는 **public** — 실명·전화번호·비밀번호·DB URL 등은 여기 절대 쓰지 말 것.
- 기록 규칙: 최신 세션이 맨 위. 세션마다 `## YYYY-MM-DD` 헤더 + 한 일 / 남은 일 / 주의점.

---

## 현재 상태 (2026-08-19 기준)

| 항목 | 상태 |
|---|---|
| 브랜치 | `main` (origin/main과 동기화됨, ahead/behind 0) |
| 마지막 커밋 | `4403a61` 2026-08-18 17:09 — connect 매칭: 실시간 접속자만 (유령 방어) |
| 미커밋 변경 | `.claude/launch.json` (dev 실행 구성 이름을 `미토 웹페이지` → `mitocreate-web`로 변경, 기능 영향 없음) |
| 배포 | Vercel `psynet-project-market` → `mitocreate.ai` |

### ⚠️ 열린 작업 (다음 세션에서 제일 먼저 확인)

1. **Supabase RPC 마이그레이션 적용 여부 미확인** — 최우선
   - 파일: `supabase/migrations/2026-08-18-connect-liveness.sql`
   - 내용: `connect_match_or_queue`에 12초 신선도 필터 + 오래된 큐 정리, `getConnectStats` 대기 카운트도 최근 12초 내만
   - **git push / Vercel 배포로는 반영되지 않음.** Supabase SQL Editor에서 직접 실행하거나 `SUPABASE_DB_URL` 설정 후 `node scripts/apply-connect-liveness.mjs` 실행 필요.
   - 적용됐는지 확인: Supabase에서 `connect_match_or_queue` 함수 정의에 `12 seconds` / `joined_at` 신선도 조건이 들어있는지 본다. 적용 안 됐으면 코드(`lib/connect.ts`)만 새 로직이고 DB는 옛 로직이라 **유령 대기자가 계속 매칭됨**.
   - 적용 확인 후 이 항목 체크 표시하고 결과를 아래 세션 로그에 남길 것.

2. **관리자 비밀번호 — 교체는 보류, 감시로 대체 (2026-08-19 결정)**
   - repo private 전환 완료, `CLAUDE.md`에서 값 제거 완료.
   - **당장 교체하지 않음.** 대신 이상 접근 알림을 붙이고, 알림이 오면 그때 교체하기로 함.
   - 교체하게 될 때 절차: Vercel env `ADMIN_PASSWORD` 수정 → `npx vercel --prod --yes` 재배포 → 로컬 `.env.local` 동기화.
     (토큰이 sha256(비밀번호)라 교체 시 기존 관리자 쿠키는 자동 무효화됨)
   - git history rewrite는 하지 않기로 함.

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
