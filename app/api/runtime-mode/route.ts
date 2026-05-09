import { NextRequest, NextResponse } from "next/server"
import { LOCAL_ONLY_COOKIE } from "@/lib/runtime-mode-server"

export async function GET() {
  return NextResponse.json({ success: true })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { enabled?: boolean }
  const enabled = Boolean(body?.enabled)

  const response = NextResponse.json({ success: true, enabled })
  response.cookies.set(LOCAL_ONLY_COOKIE, enabled ? "true" : "false", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  })

  return response
}
