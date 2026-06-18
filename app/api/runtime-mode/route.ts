import { NextRequest, NextResponse } from "next/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"
import { LOCAL_ONLY_COOKIE } from "@/lib/runtime-mode-server"

export async function GET(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  return NextResponse.json({ success: true })
}

export async function POST(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }
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
