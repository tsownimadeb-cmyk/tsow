import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAuthToken, isPasswordCorrect, verifyAuthToken } from "../lib/site-auth"

describe("site authentication tokens", () => {
  beforeEach(() => {
    process.env.SITE_PASSWORD = "test-password"
    process.env.SITE_AUTH_SECRET = "test-signing-secret-with-more-than-32-characters"
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-14T00:00:00Z"))
  })

  afterEach(() => {
    vi.useRealTimers()
    delete process.env.SITE_PASSWORD
    delete process.env.SITE_AUTH_SECRET
  })

  it("accepts a freshly issued signed token", async () => {
    const token = await createAuthToken()
    await expect(verifyAuthToken(token)).resolves.toBe(true)
  })

  it("rejects a token whose signature was changed", async () => {
    const token = await createAuthToken()
    const [payload, signature] = token.split(".")
    const replacement = signature.endsWith("0") ? "1" : "0"
    const tampered = `${payload}.${signature.slice(0, -1)}${replacement}`

    await expect(verifyAuthToken(tampered)).resolves.toBe(false)
  })

  it("rejects a token after its signed expiry time", async () => {
    const token = await createAuthToken()
    vi.advanceTimersByTime(31 * 24 * 60 * 60 * 1000)

    await expect(verifyAuthToken(token)).resolves.toBe(false)
  })

  it("compares the configured password", () => {
    expect(isPasswordCorrect("test-password")).toBe(true)
    expect(isPasswordCorrect("wrong-password")).toBe(false)
  })
})
