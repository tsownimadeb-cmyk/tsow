"use client"

import { useEffect, useRef } from "react"
import { useToast } from "@/hooks/use-toast"

interface ErrorToastProps {
  messages: string[]
}

export function ErrorToast({ messages }: ErrorToastProps) {
  const { toast } = useToast()
  const shownRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const message of messages) {
      const normalized = String(message || "").trim()
      if (!normalized || shownRef.current.has(normalized)) continue
      shownRef.current.add(normalized)
      toast({
        title: "錯誤",
        description: normalized,
        variant: "destructive",
      })
    }
  }, [messages, toast])

  return null
}
