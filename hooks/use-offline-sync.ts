import { useEffect, useCallback, useState } from 'react';

/**
 * 離線優先同步 Hook
 * 監聽網路狀態，自動同步待機項目
 */
export function useOfflineSync() {
  const [isOnline, setIsOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  // 執行同步
  const performSync = useCallback(async () => {
    if (!isOnline || isSyncing) return;

    setIsSyncing(true);
    try {
      const response = await fetch('/api/sync');
      const data = await response.json();

      if (data.success) {
        console.log(
          `✅ Sync completed: ${data.synced} items synced, ${data.failed} failed`
        );
        setPendingCount(data.failed);
      } else {
        console.error('Sync failed:', data.message);
      }
    } catch (error) {
      console.error('Sync error:', error);
    } finally {
      setIsSyncing(false);
    }
  }, [isOnline, isSyncing]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 監聽網路狀態
    const handleOnline = () => {
      setIsOnline(true);
      performSync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // 定期檢查（如果有網路）
    const syncInterval = setInterval(() => {
      if (navigator.onLine) {
        performSync();
      }
    }, 30000); // 30 秒檢查一次

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(syncInterval);
    };
  }, [performSync]);

  return {
    isOnline,
    isSyncing,
    pendingCount,
    performSync,
  };
}
