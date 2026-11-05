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

## 2. 부팅 시 자동 실행 (작업 스케줄러)

PC를 껐다 켜도 서버가 혼자 올라오게 한다.

```bash
schtasks /Create /TN "databox-server" /SC ONSTART /RL HIGHEST /RU "%USERNAME%" ^
  /TR "node \"C:\Users\psynet1\Desktop\이준호\mitocreate.ai\mitocreate-web\scripts\serve.mjs\""
```

등록 후 확인: `schtasks /Query /TN "databox-server"`

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

## 6. 터널도 서비스로 등록

```bash
cloudflared service install
```

Windows 서비스로 등록되어 부팅 시 자동 시작한다.

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
