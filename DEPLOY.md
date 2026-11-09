# 자체 호스팅 — 사내 서버 + Cloudflare Tunnel

2026-11-03 결정. Vercel 차단(계정 스코프)을 계기로 자체 호스팅으로 옮긴다.
다른 무료 호스팅은 전송량 한도와 비상업 심사가 똑같이 붙으므로 답이 아니다.

```
인터넷 → Cloudflare (DNS + TLS + CDN 캐시)
           ↓ Tunnel (아웃바운드 연결 — 포트 개방 불필요)
        cloudflared  (이 PC에서 상시 실행)
           ↓ http://127.0.0.1:3100
        node .next/standalone/server.js
```

> ⚠ **`192.168.100.137`은 별도 장비가 아니라 이 PC다.**
> 그래서 **이 PC가 켜져 있고 절전에 들어가지 않을 때만 사이트가 뜬다.**
> 제어판 → 전원 옵션에서 절전·디스크 끄기를 "안 함"으로 둘 것.

---

## 1. 빌드·구동 — 확인 완료

```bash
STANDALONE=1 npm run build
node scripts/serve.mjs
```

`scripts/serve.mjs`를 거치는 이유는 셋이다. 직접 `server.js`를 부르면 전부 빠진다.

1. 자립형 번들은 `.env` 파일을 **스스로 읽지 않는다.**
2. `.env.local`의 **`CLAUDE_CLI`를 떨군다.** 운영에 켜지면 `/api/warm`이 인증 없는
   무제한 AI 호출 창구가 된다. (검증: 운영 모드에서 `/api/warm` → `403`)
3. 빌드가 복사해 주지 않는 `.next/static`을 번들 안에 넣어 준다. 없으면 CSS·JS가 전부 404다.

**검증된 상태** (2026-11-03, `127.0.0.1:3100`)

| 항목 | 결과 |
|---|---|
| 응답 | `200` |
| `Cache-Control` | `s-maxage=31536000` — **`no-store`가 아니다.** 차단 원인이 사라졌다 |
| `x-nextjs-cache` | `HIT` (prerender에서 바로 나감) |
| 신버전 식별자 `defbar` | 있음 |
| `/api/warm` | `403` |

---

## 2. 부팅 시 자동 실행 (작업 스케줄러) — 2026-11-09 재작성

PC를 껐다 켜도 서버가 혼자 올라오게 한다. **관리자 PowerShell에서** 한 번:

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\psynet1\databox\register-task.ps1
```

레포 밖, ASCII 경로에 파일 둘이 있다:

| 파일 | 역할 |
|---|---|
| `C:\Users\psynet1\databox\start-databox.ps1` | 런처. `serve.mjs`를 돌리고, 죽으면 5초 뒤 되살린다. 로그는 `databox\serve.log` |
| `C:\Users\psynet1\databox\register-task.ps1` | 작업 등록. 같은 이름이 있으면 지우고 다시 만든다 |

> ⚠ **이 파일들이 레포 안이 아니라 ASCII 경로에 있는 이유.**
> 프로젝트 경로에 한글(`이준호`)이 있어서, 그 경로를 **명령줄에 넣으면** 콘솔 코드페이지에 따라
> 깨진다(2026-11-09에 실제로 겪었다). 그래서 한글 경로는 **파일 안에만** 적고,
> 명령줄에는 ASCII 경로만 둔다. 런처는 UTF-8 **BOM 포함**으로 저장해야 PowerShell 5.1이 제대로 읽는다.

> ⚠ **옛 문서에 있던 `schtasks /Create ... ^` 한 줄짜리 명령은 쓰지 말 것.**
> `^`는 cmd의 줄바꿈이라 Git Bash·PowerShell에서 깨지고, `%USERNAME%`도 확장되지 않는다.
> 그 명령은 **"성공"을 출력하면서 작업을 만들지 않았다** — `Get-ScheduledTask` 조회 0건,
> `C:\Windows\System32\Tasks\`에 XML도 없었다. 그래서 `register-task.ps1`은 등록 직후
> 되조회해서 없으면 `throw`한다. **등록 성공 메시지를 증거로 삼지 말 것.**

설정은 이 PC에서 **실제로 도는** `ClonetownServer` 작업을 베꼈다 —
`UserId psynet1` · `LogonType S4U`(비밀번호 저장 없이, 로그인 안 해도 부팅 때 실행) ·
트리거 둘(부팅 + 로그온) · `ExecutionTimeLimit 0`(상시 서버라 필수) · `MultipleInstances IgnoreNew`.

---

## 3. cloudflared 설치

winget이 가장 간단하다.

```bash
winget install --id Cloudflare.cloudflared
```

확인: `cloudflared --version`

---

## 4. Cloudflare 계정 · 도메인 연결 — **사용자가 직접 해야 하는 단계**

1. https://dash.cloudflare.com 에서 계정 생성(무료)
2. `mitocreate.ai` 를 사이트로 추가 → Free 플랜
3. Cloudflare가 네임서버 두 개를 알려준다. **도메인을 산 등록기관에서 네임서버를 그걸로 교체**한다.
4. 반영까지 보통 수 분 ~ 수 시간. Cloudflare 대시보드가 `Active`로 바뀌면 완료.

> 이 단계가 끝나기 전에는 5단계의 DNS 연결이 실패한다.

---

## 5. 터널 생성

```bash
cloudflared tunnel login
```

브라우저가 열리고 Cloudflare 로그인 + 도메인 선택을 요구한다. **사용자 승인이 필요하다.**

```bash
cloudflared tunnel create databox
cloudflared tunnel route dns databox mitocreate.ai
```

설정 파일 `C:\Users\psynet1\.cloudflared\config.yml`:

```yaml
tunnel: databox
credentials-file: C:\Users\psynet1\.cloudflared\<터널ID>.json

ingress:
  - hostname: mitocreate.ai
    service: http://127.0.0.1:3100
  - service: http_status:404
```

시험 구동:

```bash
cloudflared tunnel run databox
```

---

## 6. 터널도 서비스로 등록 — 2026-11-09 재작성

**`cloudflared service install`을 쓰지 말 것.** 그 명령은 `--config` **없이** 서비스를 등록한다.
그래서 설정 파일을 어디에 복사해도 서비스는 그것을 읽지 않는다. 직접 등록한다 —
**관리자 PowerShell에서**:

```
sc.exe create CloudflaredDatabox binPath= "C:\cloudflared\cloudflared.exe --config C:\Windows\System32\config\systemprofile\.cloudflared\config.yml --no-autoupdate tunnel run" start= auto
sc.exe failure CloudflaredDatabox reset= 86400 actions= restart/5000/restart/10000/restart/30000
sc.exe start CloudflaredDatabox
```

사전 준비 둘:

1. **`cert.pem` · `config.yml` · `<터널ID>.json`을 `C:\Windows\System32\config\systemprofile\.cloudflared\`로 복사**하고, `config.yml` 안의 `credentials-file` 경로도 그쪽으로 고친다. 서비스는 `LocalSystem`으로 돌아 사용자 홈을 못 본다.
   돌리기 전에 검증: `cloudflared --config <그 경로> tunnel ingress validate` → `OK`
2. **`cloudflared.exe`를 `C:\cloudflared\`로 복사**한다.

> ⚠ **왜 exe를 공백 없는 경로로 복사하나.** `binPath=` 값이 `"`로 시작하면 PowerShell이
> 네이티브 exe에 인수를 넘길 때 그 따옴표를 망가뜨려 `sc create`가 **사용법만 출력하고 끝난다.**
> 경로에 공백이 없으면 값 안에 따옴표가 필요 없어 이 문제가 사라진다.
> 대가: **winget 업데이트가 사본을 갱신하지 않는다.** 그래서 `--no-autoupdate`와 짝이다 —
> 업데이트할 때 `C:\cloudflared\cloudflared.exe`도 같이 덮어쓸 것.

> ⚠ **`--no-autoupdate`를 빼지 말 것.** 자동 업데이트는 자기 프로세스를 재시작하는데,
> 서비스로 돌 때 그게 조용히 실패하면 터널이 돌아오지 않는다.

`sc.exe failure`가 하는 일: 터널이 죽으면 **5초 뒤 자동 재시작**. 2026-11-09에 cloudflared가
종료 로그도 없이 죽어 502가 난 일이 있었다 — 그 복구를 서비스가 스스로 한다.

### 확인 — 두 줄만 보면 된다

```
sc.exe qc CloudflaredDatabox
```

- `START_TYPE : 2 AUTO_START`
- `BINARY_PATH_NAME`에 **`--config`가 보일 것**

`--config`가 없으면 터널은 떠도 **ingress를 모른다.** 그 상태의 커넥터가 같은 터널에 붙어 있으면
Cloudflare가 요청을 그쪽에도 나눠 보내 **502가 섞여 나온다.** 실제로 겪었다.

### 커넥터는 하나여야 한다

```
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Select ProcessId,ParentProcessId
```

둘 이상 보이면 설정 없는 쪽이 요청을 받고 있다. 옛 `Cloudflared` 서비스가 남아 있으면
`sc.exe delete`가 **삭제를 예약만 하고**(프로세스가 핸들을 쥐고 있어서) 그 뒤의
`service install`이 "already installed"로 거부된다. 그때는 **남은 프로세스를 직접 죽인다** —
그 순간 서비스 항목도 레지스트리에서 사라진다. `services.msc` 창이 열려 있으면 먼저 닫을 것.

---

## 7. 확인

```bash
curl -sI https://mitocreate.ai | grep -i "cache-control\|cf-cache-status\|server"
curl -s https://mitocreate.ai | grep -c defbar     # 1 이면 신버전
```

- `cf-cache-status: HIT` 가 뜨면 Cloudflare가 캐시해 주는 것이다 — 이 PC로 오는 요청이 줄어든다.
- **`200`이 왔다고 배포 성공이 아니다.** 반드시 `defbar`로 버전을 확인할 것.

---

## 남는 일

- Vercel 프로젝트 셋은 **정지 상태로 둔다.** 라이브가 두 군데로 갈리면 어느 쪽이 진짜인지 흐려진다.
- 차단 해제 요청은 별개로 살려 둔다 — 복구 경로 하나는 남겨 두는 것이다.
- 캐시 예열(`scripts/warm-cache.mjs`)은 전과 같이 **로컬에서 구독(CLI)으로** 돌린다.
  같은 Supabase를 보므로 운영에 바로 반영된다.
