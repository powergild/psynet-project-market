import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminToken } from "@/lib/adminAuth";
import { recordAdminAccess } from "@/lib/adminAlert";
import { supabase } from "@/lib/supabase";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (!isValidAdminToken(token)) {
    // 로그인 화면을 거치지 않고 관리자 API를 직접 두드리는 시도 — 감시 대상.
    if (token) await recordAdminAccess("bad_token", req);
    return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = body?.id;
  const action = body?.action;
  if (typeof id !== "number" || (action !== "accept" && action !== "reject")) {
    return NextResponse.json({ ok: false, error: "잘못된 요청" }, { status: 400 });
  }

  const status = action === "accept" ? "accepted" : "rejected";
  const { error } = await supabase.from("applications").update({ status }).eq("id", id);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
