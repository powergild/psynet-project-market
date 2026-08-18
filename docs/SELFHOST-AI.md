# 자연어 명령 해석 — 백엔드 전환 가이드 (API ↔ CLI)

터미널 자연어 명령 해석(`lib/aiCommand.ts`)의 AI 백엔드를 `AI_BACKEND` 환경변수로 고른다.
**어느 백엔드든 실패/비활성 시 규칙 파서(`nlToCommand`)로 폴백** — AI가 죽어도 서비스는 정상 동작한다.

| AI_BACKEND | 동작 | 비용 | 실행 위치 |
|---|---|---|---|
| `api` | `@anthropic-ai/sdk` 호출 | **API 크레딧** 소모 | 어디서나(Vercel 포함) |
| `cli` | `claude -p` 호출 | **Claude 구독**으로 처리(크레딧 0) | claude CLI 깔린 **상시 호스트만** |
| (미설정) | 키 있으면 api, 없으면 비활성 | — | — |

관련 env: `ANTHROPIC_API_KEY`(api용), `CLAUDE_BIN`(기본 `claude`), `AI_CLI_MODEL`(기본 `claude-haiku-4-5`).

---

## CLI 백엔드(`cli`)를 쓰려면 — 왜 Vercel은 안 되나
`claude -p`는 **`claude` 바이너리가 설치되고 로그인(OAuth)된 머신**에서만 돈다. 로그인 자격은 `~/.claude`에 저장되어 재사용된다.
Vercel/Netlify/Cloudflare Workers 같은 **서버리스는 (a) CLI 바이너리 없음 (b) 요청마다 새 샌드박스라 로그인 세션 유지 불가** → 불가능.
그래서 CLI 백엔드는 **상시 켜진 호스트**가 필요하다.

### 배포 형태 두 가지
**A. 전체 자체 호스팅 (권장·단순)** — Vercel 대신 서버에서 앱을 직접 구동
```bash
# 상시 호스트(VPS/VM/사무실 상시 PC)에서 1회 셋업
npm i -g @anthropic-ai/claude-code     # claude CLI 설치
claude                                  # 1회 대화형 로그인(OAuth) → ~/.claude 에 저장
# 앱 실행
export AI_BACKEND=cli
npm run build && npm start              # (혹은 pm2/docker로 상시화)
```
- 호스트 후보: 소형 VPS(DigitalOcean/Vultr/Lightsail), Fly.io·Railway·Render(**퍼시스턴트 볼륨 + 커스텀 Dockerfile 필수**, 헤드리스 로그인은 `~/.claude` 자격을 볼륨에 심어야 함), 또는 사무실 상시 PC + Cloudflare Tunnel.
- 도메인(mitocreate.ai)은 Vercel에서 이 호스트로 옮기면 됨(A레코드/CNAME 또는 터널).

**B. 하이브리드 (앱은 Vercel 유지)** — 해석만 자체 워커로
- 상시 호스트에 `/api/exec`의 해석 부분만 도는 작은 워커(또는 이 앱 1벌)를 두고, Vercel 앱이 그 워커 URL을 호출.
- 앱 본체는 Vercel 그대로, AI 해석 요청만 우회. 네트워크 홉이 하나 늘어난다.

### 주의
- Next API 라우트는 `node:child_process`를 쓰므로 **Node 런타임**에서 실행돼야 함(Edge 불가). 현재 `/api/exec`는 Node 런타임.
- 지연: 호출당 수 초(프로세스 spawn + 모델). 20초 타임아웃, 초과/에러 시 규칙 파서 폴백. 트래픽 적은 현 서비스엔 무리 없음.
- 헤드리스 컨테이너에서 `claude` 로그인 자격 유지가 유일한 까다로운 지점 — 퍼시스턴트 볼륨에 `~/.claude`를 보존할 것.

## 로컬에서 테스트
```bash
export AI_BACKEND=cli        # claude CLI 로그인돼 있으면 바로 됨
npm run dev
# 터미널에 "AI 관련 프로젝트 뭐 있어?" 같은 자유문장 입력 → 규칙 파서가 못 잡으면 claude -p 가 해석
```
