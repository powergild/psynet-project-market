# 데이터 박스 (Data Box) — mitocreate.ai

> **진행 상황·다음 할 일은 [WORKLOG.md](./WORKLOG.md)에 있음.** 이 파일은 구조·규칙 설명용(잘 안 바뀜), WORKLOG는 세션마다 갱신. 작업 시작 전 WORKLOG 먼저 읽고, 끝나면 WORKLOG부터 업데이트할 것.

유저가 스포츠 데이터 축을 엑셀처럼 자유 조합하면 AI가 교차 셀을 **승률(%)** 로 채우고, 경기에 들어가면 유효한 셀이 **발광**하는 개인화 분석 도구. Next.js 15(App Router) + TypeScript + Supabase(Postgres). Vercel(`psynet-project-market`, 계정 junholee940930)에 배포, 도메인 `mitocreate.ai`.

GitHub 저장소 **`powergild/psynet-project-market`** 는 **public** — 실명·비공개 데이터는 절대 git에 커밋하지 말 것.

> **2026-10-20 피봇**: 이 레포는 원래 사내 프로젝트 매칭 플랫폼(PROJECT MARKET)이었다. URL·Vercel·Supabase·레포는 그대로 두고 **안의 서비스만 통째로 바꿨다.** 구 서비스 코드(터미널 UI, 미토크리에이트 매칭, 프로젝트 등록)는 삭제됐고, 구 테이블(`projects`/`applications`/`connect_*`/`users`)은 건드리지 않고 방치한다.

원본 기획: `데이터박스-기획서.md`(SPEC-2026-000 v2.5) + `데이터박스-앱.html` 프로토타입. 둘 다 레포 밖(Downloads)에 있고 커밋하지 않는다.

## 핵심 개념

| 개념 | 정의 |
|---|---|
| **박스** | 행 × 열 격자 하나. 유저의 소유물이자 거래 단위 |
| **행(기준)** | 무엇을 기준으로 보는가 — 팀·선수·환경·상황 |
| **열(지표)** | 어떤 관점으로 재는가 — 기대값·기록·흐름 |
| **셀** | **그 기준이 그 지표 관점에서 유리할 확률 = 승률(%)** |
| **발광** | 경기 맥락상 지금 유효한 셀. 곧 예측 선언이고, 경기 종료 후 채점된다 |
| **SCO** | 인앱 재화. 타인 축 추가·박스 열람·업그레이드에 소모 |

**셀 단위는 하나여야 한다.** 지표마다 단위가 달라지면(1.73 / 62.4% / 23) 격자를 가로세로로 읽을 수 없다. 모든 셀은 승률 %다. 이건 되돌리지 말 것 — 한 번 지표 원값으로 만들었다가 갈아엎은 적 있다.

## 화면 구조

| 경로 | 화면 | 비고 |
|---|---|---|
| `/` | **내 박스** (SCR-001) | 메인. 경기에 묶이지 않는다. 발광 없음 |
| `/matches` | 경기 목록 | |
| `/match/[id]` | **그 경기 전용 박스** (SCR-003) | 선수 축 가능. 발광·추천·채점 |
| `/market` | 박스 마켓 (SCR-004) | 정렬 탭(적중률·인기·최신) |
| `/box/[id]` | 박스 상세 (SCR-005) | SCO 열람 → 셀 값 공개 → 축 가져오기 |
| `/wallet` | SCO 지갑 (SCR-006) | |
| `/admin` | 관리자 | 비밀번호 보호(구 서비스에서 유지) |

**메인과 경기 박스는 서로 다른 박스다.** 저장 키가 `databox_v1:global` / `databox_v1:<matchId>`로 갈린다. 플로팅 버튼(기획서 SCR-000)은 두지 않았다 — 호스트 앱 없이 단독 웹으로 뜨므로 박스가 첫 화면이어야 한다.

## 데이터 흐름

```
설문(SetupSheet) → 격자 생성 → 화면 채우기 → /api/cells → 캐시 or AI or 폴백
                                                 ↓
경기 안: 격자 완성 → /api/glow → 발광 셀 선정 → glow_records(예측 선언)
                                                 ↓
                              경기 종료 → scoreMatch → hit 확정 → 적중률 배지
```

### 하이브리드 AI (기존 서비스에서 확립한 패턴 그대로)

`lib/cellEngine.ts` — **캐시 우선 → 없으면 Haiku 배치 산출 → 실패하면 결정적 폴백.**
AI가 죽어도 격자는 항상 채워진다. 폴백은 해시 기반이라 같은 조합이면 항상 같은 값이 나온다.

- 모델은 `claude-haiku-4-5`. **항상 최신 Haiku를 쓴다는 방침** — 자동 추적 별칭이 없으므로 새 Haiku가 나오면 이 문자열을 직접 교체. 날짜 접미사 붙이지 말 것.
- 출력은 `output_config.format.json_schema`로 강제하고, 그 뒤에도 `coerce()`로 범위(5~95)를 다시 검증한다. 모델이 스키마를 지켜도 값이 터무니없을 수 있다.
- 캐시 키는 `wr2:` 접두사. **단위 체계를 바꾸면 접두사를 올려야 한다** — 안 그러면 옛 단위 값이 캐시에서 그대로 서빙돼 수정이 무의미해진다(실제로 겪음).
- 로컬 `.env.local`엔 `ANTHROPIC_API_KEY`가 없다 → 로컬은 항상 폴백. AI 실동작 확인은 프로덕션에서.

### 축 카탈로그 (`lib/axes.ts`)

순수 데이터·헬퍼만. **supabase import 금지** — 클라이언트에서도 쓰므로 서비스키가 번들에 샐 수 있다.

- 행/열은 **분류체계가 다르다**. `catalogFor("row"|"col", players?, sport?)`로 갈라서 낸다. 뒤집힌 조합(득점기대값 × 홈팀)은 만들 수 없다.
- 지표는 **종목별**로 갈린다(축구/야구/농구 기록). 야구 경기에서 코너킥이 뜨면 안 된다.
- 선수 축은 행에서만, 경기 안에서만(F-17).

### 화면 채우기

**칸 크기는 고정이다.** 남는 자리는 행·열을 늘려서가 아니라 **항목을 더 넣어서** 채운다(`DataBox`의 fit 이펙트). 측정 → 들어갈 만큼 축 추가 → 빈 셀만 계산 → 다시 측정, 수렴할 때까지. 계산 중(`pending`)에는 측정하지 않는다.

## 테이블 (`supabase/migrations/2026-10-20-databox.sql`)

| 테이블 | 용도 |
|---|---|
| `axis_catalog` | 축 카탈로그(현재는 코드 상수가 소스, 예비) |
| `boxes` | 박스. 발광 기록이 FK로 참조하므로 선언 전에 `ensureBox` |
| `box_axes` / `box_cells` | 박스 영속(현재 미사용 — 박스는 localStorage) |
| `cell_cache` | **전역 조합 캐시.** 박스가 달라도 같은 조합이면 재사용 |
| `cell_formulas` | 계산식 가중치(현재 조정값은 클라이언트 보관) |
| `glow_records` | **예측 선언 + 채점.** 적중률의 유일한 소스 |

전부 RLS 켜짐 — service role로만 접근. **SQL은 git push로 반영되지 않는다.** Supabase SQL Editor에서 직접 실행해야 함.

> ⚠️ Supabase 테이블 존재 확인할 때 `select("*", {count:"exact", head:true})` 쓰지 말 것. 없는 테이블에도 **에러 없이 `count: null`** 을 돌려줘서 "있다"고 오판한다. **항상 컬럼명을 명시해서 select** 할 것. 두 번 당했다.

## 아직 시드인 것 (교체 지점)

- **경기 데이터** — `lib/matches.ts`의 `getMatchSource()`. LIVE스코어 연동 시 `MatchSource` 구현만 갈아끼우면 된다. 서버팀 확인 대기 중.
- **마켓** — `lib/market.ts`의 `getMarket()`. 실제 제작자가 쌓이기 전까지 시드 박스 4개.
- **SCO** — `lib/wallet.ts`, localStorage. 실제 정산(F-13)은 범위 밖.
- **박스 영속** — localStorage. 계정 간 이동·기기 간 동기화는 아직 없다.

## 인증

- **관리자(`/admin`)**: 비밀번호 하나(`ADMIN_PASSWORD` env). **값은 문서에 적지 말 것** — Vercel 환경변수와 로컬 `.env.local`에만. 2026-08-19 노출 이력으로 1회 교체됨(git 히스토리 재작성은 일부러 안 함 — 이미 무효한 값이라 의미 없고 GitHub 캐시·클론이 남는다. **다시 제기하지 말 것**).
- 일반 사용자 로그인은 피봇 이후 쓰지 않는다. 박스 소유자는 `anon`.

## 배포

- `git push origin main`이면 끝 — public 레포 + Vercel git 연동이라 push마다 자동배포(~45s).
- Node/npm이 PATH에 없는 환경 → `export PATH="/c/Program Files/nodejs:$PATH"`.
- **로컬 dev 서버는 `preview_start` 도구 쓰지 말 것** — 한글 경로 때문에 cmd.exe 인코딩이 깨진다. `(npm run dev > /tmp/dev.log 2>&1 &)`로 띄우고, 끝나면 `netstat -ano | grep :3001` → `taskkill //PID <n> //F`. 브라우저는 `preview_start {url:"http://localhost:3001"}`로 붙인다.
- **dev 서버가 떠 있는 동안 `next build` 돌리지 말 것** — `.next`를 덮어써서 dev가 `Cannot find module './611.js'`로 죽는다. 빌드했으면 `rm -rf .next` 후 dev 재시작.
- Git Bash에서 커밋 메시지에 `/`로 시작하는 경로 비슷한 문자열 쓰면 MSYS가 변환해 깨짐 → `MSYS_NO_PATHCONV=1`.
- 한글이 많이 든 파일은 Bash heredoc보다 Write 도구가 안전하다(cp949 인코딩 사고).
