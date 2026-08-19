// 관리자 접근 감시 — 이상 징후를 감지해 메일로 알린다.
//
// 목적: 유출/추측된 비밀번호로 누가 실제 접근했는지 알아채고, 그때 비밀번호를 교체하기 위함.
// 설계 원칙: 이 모듈은 인증 경로 위에 있으므로 **절대 예외를 밖으로 던지지 않는다**.
//            로그 저장이나 메일 발송이 실패해도 로그인 자체는 정상 동작해야 한다.
//
// 선행 조건: supabase/migrations/2026-08-19-admin-access-alert.sql 적용 필요.

import type { NextRequest } from "next/server";
import { supabase } from "@/lib/supabase";
import { sendMail } from "@/lib/mailer";

export type AdminAccessEvent = "login_success" | "login_fail" | "bad_token";

// 감지 임계값
const WINDOW_MIN = 10;          // 관찰 구간(분)
const FAIL_THRESHOLD = 5;       // 같은 IP에서 이만큼 실패하면 무차별 대입으로 간주
const SPRAY_IP_THRESHOLD = 3;   // 서로 다른 IP가 이만큼 실패하면 분산 시도로 간주
const BAD_TOKEN_THRESHOLD = 3;  // 위조 쿠키 시도 임계값
const ALERT_COOLDOWN_MIN = 30;  // 같은 알림 재발송 최소 간격(분)

type RequestMeta = { ip: string; userAgent: string; path: string };

export function requestMeta(req: NextRequest): RequestMeta {
  const h = req.headers;
  // Vercel은 x-forwarded-for에 "실제IP, 프록시IP..." 형태로 넣는다. 첫 번째가 클라이언트.
  const forwarded = h.get("x-forwarded-for") || "";
  const ip = forwarded.split(",")[0]!.trim() || h.get("x-real-ip") || "unknown";
  return {
    ip,
    userAgent: h.get("user-agent") || "unknown",
    path: req.nextUrl?.pathname || "unknown",
  };
}

function since(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

/**
 * 관리자 인증 이벤트를 기록하고, 이상 징후면 메일을 보낸다.
 * 실패해도 예외를 던지지 않는다 — 호출부는 결과를 신경 쓰지 않아도 된다.
 */
export async function recordAdminAccess(event: AdminAccessEvent, req: NextRequest): Promise<void> {
  const meta = requestMeta(req);
  try {
    // 판정은 "이번 이벤트를 넣기 전" 기준으로 해야 한다.
    // (특히 새 IP 판정 — 방금 넣은 성공 기록이 스스로를 '기존 IP'로 만들면 안 됨)
    const alert = await detect(event, meta);

    await supabase.from("admin_access_log").insert({
      event,
      ip: meta.ip,
      user_agent: meta.userAgent,
      path: meta.path,
    });

    if (alert) await maybeSend(alert.key, alert.subject, alert.body);
  } catch (e) {
    console.error("[adminAlert] 기록/판정 실패:", e);
  }
}

type Alert = { key: string; subject: string; body: string };

async function detect(event: AdminAccessEvent, meta: RequestMeta): Promise<Alert | null> {
  const when = new Date().toISOString();
  const footer =
    `\n\n--\nIP: ${meta.ip}\n` +
    `User-Agent: ${meta.userAgent}\n` +
    `경로: ${meta.path}\n` +
    `시각: ${when}\n` +
    `대시보드: https://mitocreate.ai/admin\n`;

  if (event === "login_success") {
    // 이 IP에서 이전에 성공한 적이 있나?
    const { data, error } = await supabase
      .from("admin_access_log")
      .select("id")
      .eq("event", "login_success")
      .eq("ip", meta.ip)
      .limit(1);
    if (error) throw error;

    if (!data || data.length === 0) {
      return {
        key: `new_ip_login:${meta.ip}`,
        subject: "[mitocreate 보안] 처음 보는 IP에서 관리자 로그인 성공",
        body:
          "지금까지 기록에 없던 IP에서 /admin 로그인에 **성공**했습니다.\n\n" +
          "본인이 아니라면 비밀번호가 유출된 것입니다. 즉시 조치하세요:\n" +
          "  1) Vercel 환경변수 ADMIN_PASSWORD를 새 값으로 교체\n" +
          "  2) npx vercel --prod --yes 로 재배포 (교체 시 기존 로그인 쿠키는 전부 무효화됨)\n" +
          "  3) /admin에서 최근 변경된 신청 상태·참여자 목록 확인\n\n" +
          "본인이 맞다면(새 기기/새 네트워크) 무시해도 됩니다. 같은 IP로는 다시 알리지 않습니다." +
          footer,
      };
    }
    return null;
  }

  if (event === "login_fail") {
    const { data, error } = await supabase
      .from("admin_access_log")
      .select("ip")
      .eq("event", "login_fail")
      .gte("at", since(WINDOW_MIN))
      .limit(500);
    if (error) throw error;

    const rows = data ?? [];
    // 이번 시도까지 포함해서 센다.
    const sameIp = rows.filter((r) => r.ip === meta.ip).length + 1;
    const distinctIps = new Set([...rows.map((r) => r.ip), meta.ip]).size;

    if (sameIp >= FAIL_THRESHOLD) {
      return {
        key: `brute_force:${meta.ip}`,
        subject: "[mitocreate 보안] 관리자 비밀번호 반복 실패 (무차별 대입 의심)",
        body:
          `같은 IP에서 최근 ${WINDOW_MIN}분간 ${sameIp}회 로그인에 실패했습니다.\n\n` +
          "아직 뚫린 건 아니지만, 비밀번호가 약하면 시간 문제입니다.\n" +
          "성공 알림이 뒤따라 오는지 주시하고, 필요하면 선제적으로 교체하세요." +
          footer,
      };
    }
    if (distinctIps >= SPRAY_IP_THRESHOLD) {
      return {
        key: "spray",
        subject: "[mitocreate 보안] 여러 IP에서 관리자 로그인 실패 (분산 시도 의심)",
        body:
          `최근 ${WINDOW_MIN}분간 서로 다른 IP ${distinctIps}곳에서 로그인 실패가 발생했습니다.\n` +
          "봇 스캔일 가능성이 높습니다." +
          footer,
      };
    }
    return null;
  }

  // bad_token — 유효하지 않은 관리자 쿠키로 관리자 API를 직접 호출한 경우
  const { data, error } = await supabase
    .from("admin_access_log")
    .select("id")
    .eq("event", "bad_token")
    .eq("ip", meta.ip)
    .gte("at", since(WINDOW_MIN))
    .limit(100);
  if (error) throw error;

  if ((data?.length ?? 0) + 1 >= BAD_TOKEN_THRESHOLD) {
    return {
      key: `bad_token:${meta.ip}`,
      subject: "[mitocreate 보안] 관리자 쿠키 위조 시도 감지",
      body:
        `같은 IP에서 최근 ${WINDOW_MIN}분간 유효하지 않은 관리자 토큰으로 ` +
        "관리자 API 호출이 반복됐습니다.\n로그인 화면을 우회하려는 시도로 보입니다." +
        footer,
    };
  }
  return null;
}

/** 같은 알림이 쿨다운 안에 이미 나갔으면 건너뛴다. */
async function maybeSend(key: string, subject: string, body: string): Promise<void> {
  const { data, error } = await supabase
    .from("admin_alert_state")
    .select("last_sent_at")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;

  if (data?.last_sent_at) {
    const elapsedMin = (Date.now() - new Date(data.last_sent_at).getTime()) / 60_000;
    if (elapsedMin < ALERT_COOLDOWN_MIN) return;
  }

  const result = await sendMail(subject, body);
  // 발송에 실패해도 상태를 갱신하면 재시도 기회를 잃으므로, 성공했을 때만 기록한다.
  if (result.sent) {
    await supabase
      .from("admin_alert_state")
      .upsert({ key, last_sent_at: new Date().toISOString() }, { onConflict: "key" });
  }
}
