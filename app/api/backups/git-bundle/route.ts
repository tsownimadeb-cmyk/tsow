import { NextRequest, NextResponse } from "next/server"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

export const runtime = "nodejs"

const execFileAsync = promisify(execFile)

export async function POST(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const isAuthenticated = await verifyAuthToken(cookieValue)

    if (!isAuthenticated) {
      return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
    }

    const backupDir = path.join(process.cwd(), "backups", "git")
    await mkdir(backupDir, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const fileName = `git-backup-${timestamp}.bundle`
    const bundlePath = path.join(backupDir, fileName)

    await execFileAsync("git", ["bundle", "create", bundlePath, "--all"], {
      cwd: process.cwd(),
      windowsHide: true,
    })

    return NextResponse.json({
      success: true,
      filePath: `backups/git/${fileName}`,
      message: "Git bundle 建立成功",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "建立備份失敗"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
