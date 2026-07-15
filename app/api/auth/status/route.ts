import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/site-auth'
import { isLocalOnlyMode } from '@/lib/runtime-mode-server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const siteAuthenticated = await verifyAuthToken(cookieValue)
    if (!siteAuthenticated) return NextResponse.json({ authenticated: false })
    if (await isLocalOnlyMode()) return NextResponse.json({ authenticated: true, localOnly: true })

    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    return NextResponse.json({ authenticated: !error && Boolean(data.user) })
  } catch {
    return NextResponse.json({ authenticated: false })
  }
}
