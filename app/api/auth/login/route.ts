import { NextResponse } from "next/server"
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, createAuthToken, isPasswordCorrect } from "@/lib/site-auth"

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { password?: string }
    const password = body?.password || ""

    if (!isPasswordCorrect(password)) {
      return NextResponse.json({ success: false, message: "密碼錯誤" }, { status: 401 })
    }

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
