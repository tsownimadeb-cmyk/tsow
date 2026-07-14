"use client"

import { useCallback, useEffect, useState } from "react"

const DB_NAME = "backup-prefs"
const STORE_NAME = "directory"
const KEY = "handle"

type PermissionAwareDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>
  requestPermission(options?: { mode?: "read" | "readwrite" }): Promise<PermissionState>
}

const withPermissionMethods = (handle: FileSystemDirectoryHandle) =>
  handle as PermissionAwareDirectoryHandle

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function getStoredHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await openDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const req = tx.objectStore(STORE_NAME).get(KEY)
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    tx.objectStore(STORE_NAME).put(handle, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function removeHandle(): Promise<void> {
  try {
    const db = await openDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      tx.objectStore(STORE_NAME).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    // ignore
  }
}

export function useBackupDirectory() {
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [dirName, setDirName] = useState<string | null>(null)

  useEffect(() => {
    getStoredHandle().then(async (handle) => {
      if (!handle) return
      try {
        const perm = await withPermissionMethods(handle).queryPermission({ mode: "readwrite" })
        setDirName(handle.name)
        if (perm === "granted") {
          setDirHandle(handle)
        }
        // even if not yet granted, show the name so user knows it's set
      } catch {
        // ignore
      }
    })
  }, [])

  const pickDirectory = useCallback(async (): Promise<FileSystemDirectoryHandle> => {
    if (!("showDirectoryPicker" in window)) {
      throw new Error("此瀏覽器不支援資料夾選擇，請使用 Chrome 或 Edge")
    }
    const handle = await (window as Window & { showDirectoryPicker: (opts?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: "readwrite" })
    await storeHandle(handle)
    setDirHandle(handle)
    setDirName(handle.name)
    return handle
  }, [])

  const getWritableHandle = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
    const handle = dirHandle ?? await getStoredHandle()
    if (!handle) return null
    try {
      const perm = await withPermissionMethods(handle).requestPermission({ mode: "readwrite" })
      if (perm !== "granted") return null
      if (!dirHandle) {
        setDirHandle(handle)
        setDirName(handle.name)
      }
      return handle
    } catch {
      return null
    }
  }, [dirHandle])

  const saveFileTo = useCallback(async (blob: Blob, fileName: string): Promise<boolean> => {
    const handle = await getWritableHandle()
    if (!handle) return false
    try {
      const fileHandle = await handle.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return true
    } catch {
      return false
    }
  }, [getWritableHandle])

  const clearDirectory = useCallback(async () => {
    await removeHandle()
    setDirHandle(null)
    setDirName(null)
  }, [])

  return { dirName, pickDirectory, saveFileTo, clearDirectory }
}
