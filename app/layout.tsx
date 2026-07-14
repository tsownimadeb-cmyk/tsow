import type React from "react"
import type { Metadata } from "next"
import { Noto_Sans_TC } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { AppShell } from "@/components/app-shell"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { PwaBootstrap } from "@/components/pwa-bootstrap"

const notoSansTC = Noto_Sans_TC({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "進銷貨管理系統",
  description: "完整的進銷貨管理解決方案",
  generator: "v0.app",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "進銷貨管理",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-TW" suppressHydrationWarning>
      <body className={`${notoSansTC.className} antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <AppShell>{children}</AppShell>
          <Toaster />
          <PwaBootstrap />
        </ThemeProvider>
        {process.env.VERCEL ? <Analytics /> : null}
      </body>
    </html>
  )
}
