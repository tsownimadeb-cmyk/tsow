const LOCAL_ONLY_COOKIE = "ims_local_only_mode"

function isTruthy(value: string | undefined | null) {
  return value === "true" || value === "1"
}

function readCookie(name: string) {
  if (typeof document === "undefined") return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function isLocalOnlyMode() {
  const cookieValue = readCookie(LOCAL_ONLY_COOKIE)
  if (cookieValue !== null) {
    return isTruthy(cookieValue)
  }

  return isTruthy(process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE)
}

export { LOCAL_ONLY_COOKIE }
