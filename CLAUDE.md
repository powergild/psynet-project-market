# PROJECT MARKET (mitocreate.ai)

> **진행 상황·다음 할 일은 [WORKLOG.md](./WORKLOG.md)에 있음.** 이 파일은 구조·규칙 설명용(잘 안 바뀜), WORKLOG는 세션마다 갱신. 작업 시작 전 WORKLOG 먼저 읽고, 끝나면 WORKLOG부터 업데이트할 것.

PSYNET 내부 프로젝트 매칭 플랫폼. Next.js 15(App Router) + TypeScript + Supabase(Postgres). Vercel(`psynet-project-market`, 계정 junholee940930)에 배포, 도메인 `mitocreate.ai`. GitHub 저장소 **`powergild/psynet-project-market`**(2026-08-19 junholee940930에서 이전)는 **public** — 실명·비공개 데이터는 절대 git에 커밋하지 말 것 (DB에만 저장).

원래 사내에서 쓰던 Python 로컬 도구(`app.py`, 파일 기반 저장)를 서버리스 배포 가능한 형태로 이식하면서 시작됐고, 이후 여러 차례 기능이 추가/단순화됨.

## 핵심 기능 3가지

1. **프로젝트 마켓** — 자연어 터미널 UI로 프로젝트 검색 → 신청 → PM 수락/거절. 지분 협의 기능은 제거됨(단순 신청/수락만).
2. **관리자 대시보드** (`/admin`) — 비밀번호 보호. 전체 유저 목록 + 프로젝트별 신청 현황 + 프로젝트 참여자 관리.
3. **미토크리에이트** — 실명제 랜덤 1:1 매칭 채팅. `/start` 터미널 화면 안에 완전히 통합돼 있음(별도 페이지 없음).

## 데이터 소스: 정적 카탈로그 vs Supabase

- **`data/projects.json`** — 프로젝트 카탈로그(제목/PM/필요스킬/상태). **빌드타임 정적 파일**이라 런타임에 못 바꿈. PM 이름은 마스킹(성+`**`)돼서 들어감(공개 repo라서).
  - 원천 데이터: 사내 스프레드시트(엑셀)를 사람이 붙여넣어줌 → 보안/내부행정 프로젝트 제외하고 스크립트로 재생성. 재생성 스크립트는 매번 애드혹으로 짜서 씀(엑셀 파일 경로가 바뀌므로 고정 스크립트 없음).
  - `scripts/migrate-projects.mjs` — 예전에 `source-data/projects/*.md`(gitignored, 로컬에만 있음) 기준으로 생성하던 원래 스크립트. 지금은 엑셀 기준으로 재생성했지만 참고용으로 남겨둠.
- **`project_pm_map`** (Supabase, 비공개 테이블) — 실명 PM 매핑. "내 프로젝트에 누가 신청했어?" 같은 PM 자가관리 기능에서 로그인한 사람 실명과 대조하는 용도로만 서버 코드에서 조회. **화면에 그대로 노출 금지.** `scripts/seed-pm-map.mjs`는 예전 source-data 기준 시드 스크립트 — 지금은 엑셀에서 직접 읽어 업서트하는 애드혹 스크립트를 매번 새로 씀.

- **자연어 해석 모델**: `lib/aiCommand.ts`의 `claude-haiku-4-5`. **항상 최신 Haiku를 쓴다는 방침** — 다만 "최신"을 자동 추적하는 별칭은 API에 없으므로, 새 Haiku가 나오면 이 문자열을 직접 교체할 것. 모델 ID에 날짜 접미사(`-20251001` 등)를 붙이지 말 것. Haiku 4.5는 `effort` 파라미터 미지원.

## 인증 모델

- **일반 로그인**: 비밀번호 없음. 이름+전화번호만으로 자가등록(`users` 테이블, phone이 유니크 키). `lib/auth.ts`.
- **관리자(`/admin`)**: 비밀번호 하나(`ADMIN_PASSWORD` env)로 보호. **값은 문서에 적지 말 것** — Vercel 환경변수와 로컬 `.env.local`에만 존재(2026-08-19 노출 이력으로 교체됨). sha256 해시를 httpOnly 쿠키(`pm_admin`)에 저장. `lib/adminAuth.ts`.

### 관리자 이상 접근 알림

비밀번호를 선제적으로 바꾸는 대신, **유출 징후가 보일 때 메일로 알리고 그때 교체**하는 구조. `lib/adminAlert.ts` + `lib/mailer.ts`.

| 감지 | 조건 | 의미 |
|---|---|---|
| 새 IP 로그인 성공 | 기록에 없던 IP에서 `login_success` | 🔴 비밀번호 유출 의심 — 교체 필요 |
| 무차별 대입 | 같은 IP 10분간 5회 이상 실패 | 🟠 아직 안 뚫림 |
| 분산 시도 | 10분간 서로 다른 IP 3곳 이상 실패 | 🟠 봇 스캔 |
| 쿠키 위조 | 같은 IP 10분간 유효하지 않은 토큰 3회 이상 | 🟠 로그인 우회 시도 |

- 같은 알림은 30분 쿨다운(`admin_alert_state`). 새 IP 알림은 IP별 1회.
- 로그 테이블 `admin_access_log`. 감시 코드는 예외를 밖으로 던지지 않으므로 감시가 죽어도 로그인은 정상 동작.
- 수신 주소는 `ALERT_EMAIL_TO` env. `RESEND_API_KEY`가 없으면 메일 미발송 + 서버 로그만 남김.
- **선행: `supabase/migrations/2026-08-19-admin-access-alert.sql`을 Supabase SQL Editor에서 실행해야 함.**

## 미토크리에이트 상세

**컨셉**: 실명제 랜덤 1:1 매칭 채팅. 누구나 이름+전화번호로 로그인하면 참여(폐쇄형 추천/초대 구조는 제거됨 — 초대코드·외부인 한도·`invites`·`redeemInvite` 없음). `users.is_external` 컬럼은 DB에 남아있지만 사용 안 함.

**UX 원칙**: 별도 페이지/버튼 없음. `/start`(터미널) 화면 안에서 전부 진행됨 — `components/Terminal.tsx`가 command 모드와 connect 모드를 다 처리하는 상태머신.
- 로그인하면 백그라운드에서 조용히 매칭 대기 시작(공지 없음, 매칭되면 그때 배너로 알림).
- 타이틀바 밑에 "대기 중 N명 · 대화 중인 방 N개" 상시 표시(실제 값, 더미 보정 없음).
- 매칭되면 대화는 폴링 기반(1.5초 간격, 실시간 소켓 아님). 매칭은 실제 유저 2명 이상 동시 대기 시에만 성사(시뮬레이션 봇 제거됨).
- `"종료"` 입력 → 방 종료 + 메시지 영구 삭제(신고/차단 없음).
- `"호감"` 입력 → 호감표시. 맞호감이면 상대의 **참여 프로젝트 리스트**(`project_participants`)를 터미널에 띄우고 ↑/↓·마우스로 선택 → 그 프로젝트에 함께 참여 신청(`applications`). 참여 기록 없으면 프로젝트 제목 입력받아 `connect_projects`에 새로 생성(폴백).

**매칭 로직**: `connect_match_or_queue` Postgres 함수(`supabase/schema.sql`)로 원자적 처리 — `FOR UPDATE SKIP LOCKED`로 동시 요청 레이스 방지.

**대기열 유령 방지**: 대기 중 탭 닫기/페이지 이탈 시 `beforeunload` + `sendBeacon`(또는 fallback fetch keepalive)으로 `/api/connect/leave` 호출해서 큐에서 자동 이탈. (이거 안 해서 실제 사고 난 적 있음 — 아래 "알려진 이슈" 참고.)

### 관련 테이블 (`supabase/schema.sql`)

| 테이블 | 용도 |
|---|---|
| `connect_queue` | 매칭 대기열 (phone PK) |
| `connect_rooms` | 매칭된 방. 종료돼도 row는 남음(누구랑 매칭됐었는지는 필요) |
| `connect_messages` | 채팅 메시지. 방 종료 시 전부 delete |
| `connect_likes` | 호감표시 |
| `connect_projects` | 미토크리에이트에서 생성된 프로젝트 (정적 카탈로그와 별개) |

## 로컬 개발 시 반드시 주의할 것

**`.env.local`의 Supabase는 프로덕션과 동일한 DB다.** 로컬 dev 서버로 미토크리에이트 매칭을 테스트하면 **실제 유저(특히 이준호 계정)와 매칭될 수 있다** — 이미 여러 번 실제로 벌어진 사고임. 매칭/큐 관련 기능을 테스트할 땐:
1. 테스트 전에 `curl .../api/connect/stats`로 실제 대기 인원부터 확인
2. 매칭을 성사시키려면 서로 다른 계정 2개로 동시에 대기해야 함(봇 없음) — 테스트 계정 사용 권장
3. 실제 큐를 거치는 테스트를 했다면 테스트 계정과 생성된 room/message/like/project를 전부 정리
4. 혹시 실유저와 매칭됐다면 즉시 정리하고 사용자에게 알릴 것

## 배포

- `git add` (파일 명시적으로 지정 — `agency-agents-main/`, `project-market-landing_2.html` 등 무관한 미커밋 파일들이 워킹디렉토리에 계속 있음, 절대 한꺼번에 add 금지)
- **배포는 `git push origin main`이면 끝** — 레포가 public + Vercel git 연동 유지라 push마다 자동배포(실측 ~45s Ready, 2026-08-19). `npx vercel --prod --yes`는 즉시배포 원할 때만(선택).
- Windows Git Bash에서 커밋 메시지에 `/`로 시작하는 경로 비슷한 문자열(`/start` 등) 쓰면 MSYS가 Windows 경로로 자동변환해서 메시지가 깨짐 — `MSYS_NO_PATHCONV=1 git commit ...`로 방지
- push 자격: 이 PC gh 활성계정 = **powergild**(레포 소유자), remote도 powergild. 커밋 author는 junholee940930. `git push` 정상. (다시 403/차단이면 `gh auth status`로 powergild 활성인지 확인.)
- Node/npm이 PATH에 없는 환경 → `export PATH="/c/Program Files/nodejs:$PATH"` 붙여서 실행
- 로컬 dev 서버는 `.claude/launch.json` 대신 그냥 `nohup npm run dev > /tmp/dev.log 2>&1 &`로 띄우고 끝나면 `netstat`로 PID 찾아서 `taskkill //PID <n> //F` — `preview_start` 도구는 한글 경로 때문에 자주 깨짐(cmd.exe 인코딩 문제).

## 알려진 이슈 / 앞으로 고려할 것

- 미토크리에이트에서 생성된 프로젝트(`connect_projects`)가 메인 카탈로그(`/projects`, "매칭" 명령)에 안 뜸 — 통합하려면 `lib/projects.ts`를 정적 JSON 전용에서 DB 병합 구조로 바꿔야 함(꽤 큰 리팩터).
- `data/projects.json` 재생성이 애드혹 스크립트 기반이라 재현 가능한 파이프라인이 없음 — 다음에 엑셀 새로 받으면 다시 스크립트 짜야 함.
- **프로젝트 참여자(project_participants)**: 사람(실명)↔프로젝트 매핑. 미토크리에이트에서 서로 호감이면 상대의 참여 프로젝트 리스트를 터미널에 띄우고(↑/↓·마우스 선택) 선택 시 그 프로젝트에 함께 참여 신청. 관리자(/admin)에서 추가/삭제. 실명이 들어가 public GitHub엔 스키마만 커밋 — 시드는 `source-data/season2-participants.json`(git 제외) + `node scripts/seed-participants.mjs`(로컬 1회, .env.local 사용). **선행: Supabase SQL 편집기에서 project_participants 테이블 생성(schema.sql 참고).** 시즌1 봇(민준/서연/도윤/하은/지호) 및 /api/connect/simulate는 제거됨 — 매칭은 실제 유저 2명 이상일 때만.
- **(향후) 이벤트형 매칭 활성화**: 지금은 "상대가 큐에 있으면 상시 즉시 매칭"인데, 나중에는 조건 충족 시에만 매칭이 열리는 구조로 전환 고려 — 예) 동시 접속자 100명 이상일 때, 또는 정해진 시간대(밤 9시 등)에만 활성화. 대기 인원 게이트/스케줄 게이트를 큐 로직(`connect_match_or_queue`) 앞단에 두는 형태. 접속자 수 트래킹(현재는 `connect_queue` count만 있음)과 활성 시간 관리가 선행 필요.
