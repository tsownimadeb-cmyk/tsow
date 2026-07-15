import { NextRequest, NextResponse } from "next/server"
import {
  AUTH_COOKIE_MAX_AGE,
  AUTH_COOKIE_NAME,
  createAuthToken,
  getSiteAuthConfigurationError,
  isPasswordCorrect,
} from "@/lib/site-auth"
import { LOCAL_ONLY_COOKIE } from "@/lib/runtime-mode-server"
import { createRouteClient } from "@/lib/supabase/route"

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
    if (getSiteAuthConfigurationError()) {
      return NextResponse.json(
        { success: false, message: "登入服務尚未完成安全設定，請聯絡管理者。" },
        { status: 503 },
      )
    }

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

    const response = NextResponse.json({ success: true })
    const localOnlyCookie = request.cookies.get(LOCAL_ONLY_COOKIE)?.value
    const localOnly = localOnlyCookie === "true" || localOnlyCookie === "1"
      || process.env.LOCAL_ONLY_MODE === "true"
      || process.env.LOCAL_ONLY_MODE === "1"
      || process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "true"
      || process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "1"

    if (!localOnly) {
      const email = process.env.SUPABASE_AUTH_EMAIL || ""
      const authPassword = process.env.SUPABASE_AUTH_PASSWORD || ""
      if (!email || !authPassword) {
        return NextResponse.json(
          { success: false, message: "登入服務尚未完成雲端帳號設定，請聯絡管理者。" },
          { status: 503 },
        )
      }

      const supabase = createRouteClient(request, response)
      const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword })
      if (error) {
        return NextResponse.json(
          { success: false, message: "雲端登入失敗，請確認管理者設定。" },
          { status: 503 },
        )
      }
    }

    attempts.delete(clientKey)
    const token = await createAuthToken()

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
