export type PendingOperation = {
  id: string
  endpoint: string
  method: "PUT" | "POST" | "DELETE"
  body: Record<string, unknown>
  createdAt: number
}

export type SyncConflict = {
  id: string
  endpoint: string
  reason: string
  payload: Record<string, unknown>
  createdAt: number
}

const QUEUE_KEY = "ims_mobile_pending_ops_v1"
const CONFLICT_KEY = "ims_mobile_conflicts_v1"
const QUEUE_EVENT = "ims-mobile-queue-changed"

function getQueue(): PendingOperation[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setQueue(queue: PendingOperation[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT))
}

function getConflicts(): SyncConflict[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(CONFLICT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setConflicts(conflicts: SyncConflict[]) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(CONFLICT_KEY, JSON.stringify(conflicts))
  window.dispatchEvent(new CustomEvent(QUEUE_EVENT))
}

function addConflict(conflict: Omit<SyncConflict, "id" | "createdAt">) {
  const conflicts = getConflicts()
  conflicts.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...conflict,
  })
  setConflicts(conflicts.slice(0, 200))
}

export function enqueuePendingOperation(input: Omit<PendingOperation, "id" | "createdAt">) {
  const queue = getQueue()
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...input,
  })
  setQueue(queue)
}

export function getPendingOperationCount() {
  return getQueue().length
}

export function getConflictCount() {
  return getConflicts().length
}

export function listConflicts() {
  return getConflicts()
}

export function removeConflict(id: string) {
  const conflicts = getConflicts().filter((item) => item.id !== id)
  setConflicts(conflicts)
}

export function requeueConflict(id: string) {
  const conflicts = getConflicts()
  const target = conflicts.find((item) => item.id === id)
  if (!target) return false

  const queue = getQueue()
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    endpoint: target.endpoint,
    method: "PUT",
    body: target.payload,
    createdAt: Date.now(),
  })
  setQueue(queue)
  removeConflict(id)
  return true
}

export function clearConflicts() {
  setConflicts([])
}

export function onPendingQueueChanged(handler: () => void) {
  if (typeof window === "undefined") return () => {}
  const wrapped = () => handler()
  window.addEventListener(QUEUE_EVENT, wrapped)
  return () => window.removeEventListener(QUEUE_EVENT, wrapped)
}

export async function flushPendingOperations() {
  if (typeof window === "undefined") return { flushed: 0, remaining: 0, conflicts: 0 }
  if (!navigator.onLine) return { flushed: 0, remaining: getQueue().length, conflicts: getConflictCount() }

  let queue = getQueue()
  if (queue.length === 0) return { flushed: 0, remaining: 0, conflicts: getConflictCount() }

  let flushed = 0
  const remaining: PendingOperation[] = []

  for (const item of queue) {
    try {
      const response = await fetch(item.endpoint, {
        method: item.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item.body),
      })

      if (response.status === 409) {
        const conflictBody = await response.json().catch(() => null)
        addConflict({
          endpoint: item.endpoint,
          reason: conflictBody?.message || "版本衝突，請重新整理後再提交",
          payload: item.body,
        })
        continue
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json().catch(() => null)
      if (data && data.success === false) {
        throw new Error(data.message || "sync failed")
      }

      flushed += 1
    } catch {
      remaining.push(item)
    }
  }

  queue = remaining
  setQueue(queue)
  return { flushed, remaining: queue.length, conflicts: getConflictCount() }
}
