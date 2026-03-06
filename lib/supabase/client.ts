import { createBrowserClient } from "@supabase/ssr"

const RETRYABLE_FETCH_ERROR = /failed to fetch/i

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.")
  }

  return createBrowserClient(supabaseUrl, supabaseAnonKey, {
    global: {
      fetch: async (input, init) => {
        const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        const safeUrl = (() => {
          try {
            const parsed = new URL(rawUrl)
            return `${parsed.origin}${parsed.pathname}`
          } catch {
            return rawUrl
          }
        })()

        const maxAttempts = 3
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            return await fetch(input, init)
          } catch (error: any) {
            const isRetryable = error instanceof TypeError && RETRYABLE_FETCH_ERROR.test(String(error.message || ""))
            if (isRetryable && attempt < maxAttempts) {
              await delay(250 * attempt)
              continue
            }

            if (isRetryable) {
              throw new Error(`Unable to reach Supabase (${safeUrl}). Check network/VPN/firewall and your environment variables.`)
            }

            throw error
          }
        }

        throw new Error(`Unable to reach Supabase (${safeUrl}). Check network/VPN/firewall and your environment variables.`)
      },
    },
  })
}
