"use client"

import { useEffect } from "react"
import { saveMobileCache } from "@/lib/mobile-cache"

type MobileCacheWriterProps<T> = {
  cacheKey: string
  data: T
}

export function MobileCacheWriter<T>({ cacheKey, data }: MobileCacheWriterProps<T>) {
  useEffect(() => {
    saveMobileCache(cacheKey, data)
  }, [cacheKey, data])

  return null
}
