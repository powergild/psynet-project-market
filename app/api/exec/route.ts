import { NextRequest, NextResponse } from "next/server";
import { processCommand, type Pending } from "@/lib/commands";
import type { Session } from "@/lib/auth";

export const runtime = "nodejs";

function parseSession(body: unknown): Session | null {
  if (
    body &&
    typeof body === "object" &&
    "session" in body &&
    body.session &&
    typeof (body.session as Session).name === "string" &&
    typeof (body.session as Session).phone === "string"
  ) {
    const s = body.session as Session;
    return { name: s.name, phone: s.phone };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.cmd !== "string") {
    return NextResponse.json({ output: "[오류] 잘못된 요청", lastProjectId: null }, { status: 400 });
  }

  const result = await processCommand(body.cmd, {
    session: parseSession(body),
    lastProjectId: typeof body.lastProjectId === "string" ? body.lastProjectId : null,
    pending: (body.pending ?? null) as Pending,
  });

  return NextResponse.json(result);
}
