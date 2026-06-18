import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/site-auth'

export async function GET(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const isAuthenticated = await verifyAuthToken(cookieValue)
    return NextResponse.json({ authenticated: Boolean(isAuthenticated) })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}
