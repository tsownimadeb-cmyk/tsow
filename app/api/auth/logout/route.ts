import { NextRequest, NextResponse } from "next/server"
import { AUTH_COOKIE_NAME } from "@/lib/site-auth"
import { createRouteClient } from "@/lib/supabase/route"

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true })

  try {
    const supabase = createRouteClient(request, response)
    await supabase.auth.signOut({ scope: "local" })
  } catch {
    // Even if Supabase is unavailable, the site cookie must still be cleared.
  }

  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  })

  return response
}
