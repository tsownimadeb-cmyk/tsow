const AUTH_COOKIE_NAME = "site_auth"
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 8
const AUTH_PAYLOAD = "site-auth:v1"

const encoder = new TextEncoder()

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

const getSitePassword = () => process.env.SITE_PASSWORD || ""

const getSecret = () => `site-auth-secret:${getSitePassword()}`

async function signPayload(payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload))
  return toHex(new Uint8Array(signature))
}

export async function createAuthToken() {
  const signature = await signPayload(AUTH_PAYLOAD)
  return `${AUTH_PAYLOAD}.${signature}`
}

export async function verifyAuthToken(token: string | undefined | null) {
  if (!token) return false
  const [payload, signature] = token.split(".")
  if (!payload || !signature) return false
  if (payload !== AUTH_PAYLOAD) return false

  const expected = await signPayload(payload)
  return timingSafeEqual(signature, expected)
}

export function isPasswordCorrect(password: string) {
  const sitePassword = getSitePassword()
  if (!sitePassword) return false
  return timingSafeEqual(password, sitePassword)
}

export { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE }
