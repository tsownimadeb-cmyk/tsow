const AUTH_COOKIE_NAME = "site_auth"
const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 天（2592000 秒）
const AUTH_TOKEN_VERSION = 2
const MAX_CLOCK_SKEW_SECONDS = 5 * 60

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface AuthPayload {
  version: number
  issuedAt: number
  expiresAt: number
  nonce: string
}

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

const getSecret = () => process.env.SITE_AUTH_SECRET || `site-auth-secret:${getSitePassword()}`

const encodePayload = (payload: AuthPayload) => {
  const bytes = encoder.encode(JSON.stringify(payload))
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

const decodePayload = (encoded: string): AuthPayload | null => {
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return JSON.parse(decoder.decode(bytes)) as AuthPayload
  } catch {
    return null
  }
}

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
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = encodePayload({
    version: AUTH_TOKEN_VERSION,
    issuedAt,
    expiresAt: issuedAt + AUTH_COOKIE_MAX_AGE,
    nonce: crypto.randomUUID(),
  })
  const signature = await signPayload(payload)
  return `${payload}.${signature}`
}

export async function verifyAuthToken(token: string | undefined | null) {
  if (!token) return false
  const parts = token.split(".")
  if (parts.length !== 2) return false
  const [payload, signature] = parts
  if (!payload || !signature) return false

  const expected = await signPayload(payload)
  if (!timingSafeEqual(signature, expected)) return false

  const decoded = decodePayload(payload)
  if (!decoded || decoded.version !== AUTH_TOKEN_VERSION) return false
  if (!Number.isInteger(decoded.issuedAt) || !Number.isInteger(decoded.expiresAt)) return false
  if (typeof decoded.nonce !== "string" || !decoded.nonce) return false

  const now = Math.floor(Date.now() / 1000)
  if (decoded.issuedAt > now + MAX_CLOCK_SKEW_SECONDS) return false
  if (decoded.expiresAt <= now || decoded.expiresAt <= decoded.issuedAt) return false
  if (decoded.expiresAt - decoded.issuedAt > AUTH_COOKIE_MAX_AGE) return false

  return true
}

export function isPasswordCorrect(password: string) {
  const sitePassword = getSitePassword()
  if (!sitePassword) return false
  return timingSafeEqual(password, sitePassword)
}

export { AUTH_COOKIE_NAME, AUTH_COOKIE_MAX_AGE }
