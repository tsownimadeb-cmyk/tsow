import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8")

describe("navigation performance guards", () => {
  it("verifies Supabase sessions without a remote getUser call on every request", () => {
    const proxy = source("proxy.ts")

    expect(proxy).toContain("supabase.auth.getClaims()")
    expect(proxy).not.toContain("supabase.auth.getUser()")
    expect(proxy).toContain("data?.claims?.sub")
  })

  it("prefetches only the link a user is about to open", () => {
    const sidebar = source("components/sidebar.tsx")

    expect(sidebar).toContain("onMouseEnter={() => handleLinkPrefetch(item.href)}")
    expect(sidebar).toContain("onFocus={() => handleLinkPrefetch(item.href)}")
    expect(sidebar).toContain("prefetch={false}")
    expect(sidebar).not.toContain("PREFETCH_PATHS")
    expect(sidebar).not.toContain("requestIdleCallback")

    const welcomePage = source("app/page.tsx")
    expect(welcomePage).toContain("prefetch={false}")
  })
})
