export function isLocalOnlyMode(): boolean {
  const nextPublic = process.env.NEXT_PUBLIC_LOCAL_ONLY_MODE === "true"
  if (typeof window === "undefined") {
    return nextPublic || process.env.LOCAL_ONLY_MODE === "true"
  }

  return nextPublic
}
