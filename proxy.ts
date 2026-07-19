import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"
import { LOCAL_ONLY_COOKIE } from "@/lib/runtime-mode-server"
import { createRouteClient } from "@/lib/supabase/route"

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/auth/status"])

function isLocalOnlyRequest(request: NextRequest) {
  const cookieValue = request.cookies.get(LOCAL_ONLY_COOKIE)?.value
  if (cookieValue !== undefined) return cookieValue === "true" || cookieValue === "1"
  return process.env.LOCAL_ONLY_MODE === "true"
    || process.env.LOCAL_ONLY_MODE === "1"
    || process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "true"
    || process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "1"
}

function unauthorized(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ success: false, message: "登入已失效，請重新登入。" }, { status: 401 })
  }
  return NextResponse.redirect(new URL("/login", request.url))
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const siteAuthenticated = await verifyAuthToken(cookieValue)

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname !== "/login" || !siteAuthenticated) return NextResponse.next()
    if (isLocalOnlyRequest(request)) return NextResponse.redirect(new URL("/", request.url))

    const refreshResponse = NextResponse.next({ request: { headers: request.headers } })
    try {
      const supabase = createRouteClient(request, refreshResponse)
      const { data, error } = await supabase.auth.getClaims()
      if (error || !data?.claims?.sub) return NextResponse.next()

      const redirect = NextResponse.redirect(new URL("/", request.url))
      refreshResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie))
      return redirect
    } catch {
      return NextResponse.next()
    }
  }

  if (!siteAuthenticated) return unauthorized(request)
  if (isLocalOnlyRequest(request)) return NextResponse.next()

  const response = NextResponse.next({ request: { headers: request.headers } })
  try {
    const supabase = createRouteClient(request, response)
    const { data, error } = await supabase.auth.getClaims()
    if (error || !data?.claims?.sub) return unauthorized(request)
  } catch {
    return unauthorized(request)
  }

  return response
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
}
