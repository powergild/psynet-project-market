// 알림 메일 발송. Resend HTTP API 사용 (SDK 의존성 없이 fetch만).
//
// 필요한 환경변수:
//   RESEND_API_KEY   — 없으면 발송을 건너뛰고 서버 로그에만 남긴다(기능은 안 죽음).
//   ALERT_EMAIL_TO   — 수신자. 기본값은 아래 DEFAULT_TO.
//   ALERT_EMAIL_FROM — 발신자. Resend에서 도메인 인증을 끝낸 주소여야 한다.
//                      인증 전에는 'onboarding@resend.dev'로 두면 Resend 가입 계정
//                      본인 메일로만 발송된다(테스트 모드).

const DEFAULT_TO = "junholee940930@psynet.co.kr";
const DEFAULT_FROM = "onboarding@resend.dev";

export type MailResult = { sent: boolean; reason?: string };

export async function sendMail(subject: string, text: string): Promise<MailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.ALERT_EMAIL_TO || DEFAULT_TO;
  const from = process.env.ALERT_EMAIL_FROM || DEFAULT_FROM;

  if (!apiKey) {
    // 키가 없어도 서비스는 정상 동작해야 하므로 조용히 넘어가되, 흔적은 남긴다.
    console.warn(`[alert] RESEND_API_KEY 없음 — 메일 미발송. subject=${subject}\n${text}`);
    return { sent: false, reason: "RESEND_API_KEY 미설정" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[alert] 메일 발송 실패 ${res.status}: ${detail}`);
      return { sent: false, reason: `HTTP ${res.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("[alert] 메일 발송 예외:", e);
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}
