import { cookies } from "next/headers"

const LOCAL_ONLY_COOKIE = "ims_local_only_mode"

function isTruthy(value: string | undefined | null) {
  return value === "true" || value === "1"
}

export async function isLocalOnlyMode() {
  const cookieStore = await cookies()
  const cookieValue = cookieStore.get(LOCAL_ONLY_COOKIE)?.value
  if (cookieValue !== undefined) {
    return isTruthy(cookieValue)
  }

  return isTruthy(process.env.LOCAL_ONLY_MODE) || isTruthy(process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE)
}

export { LOCAL_ONLY_COOKIE }
