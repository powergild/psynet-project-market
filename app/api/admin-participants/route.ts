import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, isValidAdminToken } from "@/lib/adminAuth";
import { recordAdminAccess } from "@/lib/adminAlert";
import { addParticipant, listParticipants, removeParticipant } from "@/lib/participants";

export const runtime = "nodejs";

async function auth(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(ADMIN_COOKIE)?.value;
  if (isValidAdminToken(token)) return true;
  // 로그인 화면을 거치지 않고 관리자 API를 직접 두드리는 시도 — 감시 대상.
  if (token) await recordAdminAccess("bad_token", req);
  return false;
}

// 프로젝트의 참여자 목록
export async function GET(req: NextRequest) {
  if (!(await auth(req))) return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  try {
    const participants = await listParticipants(projectId);
    return NextResponse.json({ ok: true, participants });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// 참여자 추가
export async function POST(req: NextRequest) {
  if (!(await auth(req))) return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const projectId = body?.projectId;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const role = body?.role === "PM" ? "PM" : "협업자";
  if (typeof projectId !== "string" || !projectId || !name) {
    return NextResponse.json({ ok: false, error: "projectId/name 필요" }, { status: 400 });
  }
  try {
    await addParticipant(projectId, name, role);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// 참여자 삭제
export async function DELETE(req: NextRequest) {
  if (!(await auth(req))) return NextResponse.json({ ok: false, error: "인증 필요" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "number") return NextResponse.json({ ok: false, error: "id 필요" }, { status: 400 });
  try {
    await removeParticipant(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
