import { NextRequest, NextResponse } from "next/server"
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, createAuthToken, isPasswordCorrect } from "@/lib/site-auth"

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_LOGIN_FAILURES = 5
const attempts = new Map<string, { failures: number; resetAt: number }>()

const getClientKey = (request: NextRequest) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip")?.trim() ||
  "local-client"

const cleanupAttempts = (now: number) => {
  if (attempts.size < 100) return
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key)
  }
}

export async function POST(request: NextRequest) {
  const now = Date.now()
  const clientKey = getClientKey(request)
  cleanupAttempts(now)

  const currentAttempt = attempts.get(clientKey)
  if (currentAttempt && currentAttempt.resetAt > now && currentAttempt.failures >= MAX_LOGIN_FAILURES) {
    const retryAfter = Math.max(1, Math.ceil((currentAttempt.resetAt - now) / 1000))
    return NextResponse.json(
      { success: false, message: "登入嘗試次數過多，請稍後再試" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    )
  }

  try {
    const body = (await request.json()) as { password?: string }
    const password = body?.password || ""

    if (!isPasswordCorrect(password)) {
      const activeAttempt = currentAttempt && currentAttempt.resetAt > now
        ? currentAttempt
        : { failures: 0, resetAt: now + LOGIN_WINDOW_MS }
      activeAttempt.failures += 1
      attempts.set(clientKey, activeAttempt)
      return NextResponse.json({ success: false, message: "密碼錯誤" }, { status: 401 })
    }

    attempts.delete(clientKey)
    const token = await createAuthToken()
    const response = NextResponse.json({ success: true })

    response.cookies.set(AUTH_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE,
    })

    return response
  } catch {
    return NextResponse.json({ success: false, message: "登入失敗" }, { status: 400 })
  }
}
