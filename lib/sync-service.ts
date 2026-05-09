import { createClient } from '@/lib/supabase/client';
import {
  getLocalDb,
  getPendingSyncQueue,
  markSyncComplete,
  updateSyncError,
} from './local-db';

/**
 * 同步待機隊列中的所有未同步項目
 */
export async function syncPendingChanges() {
  const queue = getPendingSyncQueue();

  if (queue.length === 0) {
    console.log('No pending sync items');
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  const supabase = createClient();

  for (const item of queue) {
    try {
      const data = JSON.parse(item.data);

      // 根據操作類型進行同步
      if (item.operation === 'update' && item.entity === 'purchase_returns') {
        await syncPurchaseReturn(supabase, data);
        markSyncComplete(item.id);
        synced++;
      } else if (item.operation === 'update' && item.entity === 'sales_returns') {
        await syncSalesReturn(supabase, data);
        markSyncComplete(item.id);
        synced++;
      }
    } catch (error: any) {
      failed++;
      updateSyncError(item.id, error.message);
      console.error(
        `Sync failed for ${item.entity}/${item.entity_id}:`,
        error.message
      );
    }
  }

  console.log(`Sync completed: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

/**
 * 同步進貨退回單
 */
async function syncPurchaseReturn(supabase: any, data: any) {
  const { returnId, totalAmount, items } = data;

  const { error } = await supabase.rpc('update_purchase_return', {
    p_return_id: returnId,
    p_total_amount: totalAmount,
    p_items: JSON.stringify(
      items.map((item: any) => ({
        product_id: item.productPno,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        amount: item.amount,
        reason: item.reason || null,
      }))
    ),
  });

  if (error) {
    throw new Error(error.message);
  }

  // 標記為已同步
  const localDb = getLocalDb();
  localDb
    .prepare(
      'UPDATE purchase_returns SET synced = TRUE, sync_timestamp = ? WHERE id = ?'
    )
    .run(Date.now(), returnId);
}

/**
 * 同步銷貨退回單
 */
async function syncSalesReturn(supabase: any, data: any) {
  const { returnId, totalAmount, items } = data;

  const { error } = await supabase.rpc('update_sales_return', {
    p_return_id: returnId,
    p_total_amount: totalAmount,
    p_items: JSON.stringify(
      items.map((item: any) => ({
        product_code: item.productPno,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        reason: item.reason || null,
      }))
    ),
  });

  if (error) {
    throw new Error(error.message);
  }

  // 標記為已同步
  const localDb = getLocalDb();
  localDb
    .prepare(
      'UPDATE sales_returns SET synced = TRUE, sync_timestamp = ? WHERE id = ?'
    )
    .run(Date.now(), returnId);
}

/**
 * 監聽網路狀態並自動同步（客戶端使用）
 */
export function setupOfflineSync() {
  if (typeof window === 'undefined') return;

  // 監聽網路恢復
  window.addEventListener('online', () => {
    console.log('Network restored, syncing pending changes...');
    syncPendingChanges();
  });

  // 定期檢查（每 30 秒）
  setInterval(() => {
    if (navigator.onLine) {
      syncPendingChanges().catch(console.error);
    }
  }, 30000);
}
