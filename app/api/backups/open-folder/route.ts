import { NextRequest, NextResponse } from "next/server"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

export const runtime = "nodejs"

const runProcess = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: "ignore",
    })

    child.once("error", reject)
    child.once("close", (code) => {
      if (code === 0 || code === null) {
        resolve()
        return
      }
      reject(new Error(`${command} exited with code ${code}`))
    })
  })

export async function POST(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const isAuthenticated = await verifyAuthToken(cookieValue)

    if (!isAuthenticated) {
      return NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 })
    }

    const backupDir = path.join(process.cwd(), "backups", "git")
    await mkdir(backupDir, { recursive: true })

    if (process.platform !== "win32") {
      return NextResponse.json(
        { success: false, message: "Open folder action is only supported on Windows" },
        { status: 400 },
      )
    }

    let launchError: unknown = null

    try {
      await runProcess("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Start-Process -FilePath explorer.exe -ArgumentList '${backupDir.replace(/'/g, "''")}'`,
      ])
    } catch (error) {
      launchError = error
      try {
        await runProcess("cmd.exe", ["/c", "start", "", backupDir])
        launchError = null
      } catch (fallbackError) {
        launchError = fallbackError
      }
    }

    if (launchError) {
      const message = launchError instanceof Error ? launchError.message : "Unknown error"
      return NextResponse.json(
        {
          success: false,
          folderPath: backupDir,
          message: "Failed to open folder: " + message,
        },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, folderPath: backupDir, message: "Folder opened" })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Open folder failed"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
