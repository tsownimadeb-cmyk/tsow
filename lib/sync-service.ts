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
      } else if (item.entity === 'products') {
        await syncProductCrud(supabase, item.operation, data);
        markSyncComplete(item.id);
        synced++;
      } else if (item.entity === 'customers') {
        await syncCustomerCrud(supabase, item.operation, data);
        markSyncComplete(item.id);
        synced++;
      } else if (item.entity === 'suppliers') {
        await syncSupplierCrud(supabase, item.operation, data);
        markSyncComplete(item.id);
        synced++;
      } else if (item.entity === 'purchases') {
        await syncPurchaseCrud(supabase, item.operation, data);
        markSyncComplete(item.id);
        synced++;
      } else if (item.entity === 'sales') {
        await syncSalesCrud(supabase, item.operation, data);
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

async function syncProductCrud(supabase: any, operation: string, data: any) {
  if (operation === 'create') {
    const { error } = await supabase.from('products').insert(data);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === 'update') {
    const code = String(data?.code || '').trim();
    const payload = data?.payload || {};
    const { error } = await supabase.from('products').update(payload).eq('code', code);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === 'delete') {
    const code = String(data?.code || '').trim();
    const { error } = await supabase.from('products').delete().eq('code', code);
    if (error) throw new Error(error.message);
  }
}

async function syncCustomerCrud(supabase: any, operation: string, data: any) {
  if (operation === 'create') {
    const { error } = await supabase.from('customers').insert(data);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === 'update') {
    const code = String(data?.targetCode || data?.code || '').trim();
    const payload = data?.payload || {};

    const nextCode = String(payload?.code || '').trim();
    if (code && nextCode && code !== nextCode) {
      const rpcResult = await supabase.rpc('rename_customer_code', {
        p_old_code: code,
        p_new_code: nextCode,
      });

      if (rpcResult.error && !/Could not find the function|does not exist|schema cache/i.test(String(rpcResult.error.message || ''))) {
        throw new Error(rpcResult.error.message);
      }

      if (rpcResult.error) {
        const renameFallback = await supabase.from('customers').update({ code: nextCode }).eq('code', code);
        if (renameFallback.error) throw new Error(renameFallback.error.message);
      }
    }

    const { error } = await supabase.from('customers').update(payload).eq('code', nextCode || code);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === 'delete') {
    const code = String(data?.code || '').trim();
    const { error } = await supabase.from('customers').delete().eq('code', code);
    if (error) throw new Error(error.message);
  }
}

async function syncSupplierCrud(supabase: any, operation: string, data: any) {
  if (operation === 'create') {
    const { error } = await supabase.from('suppliers').insert(data);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === 'update') {
    const id = String(data?.id || '').trim();
    const payload = data?.payload || {};
    const { error } = await supabase.from('suppliers').update(payload).eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }

  if (operation === 'delete') {
    const id = String(data?.id || '').trim();
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }
}

async function syncPurchaseCrud(supabase: any, operation: string, data: any) {
  if (operation === 'create') {
    const { id, po_number, supplier_id, order_date, delivery_date, total_amount, status, notes, items } = data;

    // 建立進貨單主表
    const { error: purchaseError } = await supabase.from('purchase_orders').insert({
      id,
      order_no: po_number,
      supplier_id,
      order_date,
      total_amount,
      status,
      notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (purchaseError) throw new Error(purchaseError.message);

    // 建立進貨明細
    if (items && items.length > 0) {
      const itemsPayload = items.map((item: any) => ({
        purchase_order_id: id,
        order_no: po_number,
        code: item.product_pno,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.amount,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsPayload);
      if (itemsError) throw new Error(itemsError.message);
    }

    return;
  }

  if (operation === 'update') {
    const { id, po_number, supplier_id, order_date, delivery_date, total_amount, status, notes, items } = data;

    // 更新主表
    const { error: updateError } = await supabase
      .from('purchase_orders')
      .update({
        supplier_id,
        order_date,
        total_amount,
        status,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // 刪除舊明細、插入新明細
    await supabase.from('purchase_order_items').delete().eq('purchase_order_id', id);

    if (items && items.length > 0) {
      const itemsPayload = items.map((item: any) => ({
        purchase_order_id: id,
        order_no: po_number,
        code: item.product_pno,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.amount,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsPayload);
      if (itemsError) throw new Error(itemsError.message);
    }

    return;
  }
}

async function syncSalesCrud(supabase: any, operation: string, data: any) {
  if (operation === 'create') {
    const { id, so_number, customer_id, order_date, delivery_date, delivery_method, total_amount, status, notes, items } = data;

    // 建立銷貨單主表
    const { error: saleError } = await supabase.from('sales_orders').insert({
      id,
      order_no: so_number,
      customer_cno: customer_id,
      order_date,
      delivery_method,
      total_amount,
      status,
      notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (saleError) throw new Error(saleError.message);

    // 建立銷貨明細
    if (items && items.length > 0) {
      const itemsPayload = items.map((item: any) => ({
        sales_order_id: id,
        code: item.product_pno,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.amount,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: itemsError } = await supabase.from('sales_order_items').insert(itemsPayload);
      if (itemsError) throw new Error(itemsError.message);
    }

    return;
  }

  if (operation === 'update') {
    const { id, so_number, customer_id, order_date, delivery_date, delivery_method, total_amount, status, notes, items } = data;

    // 更新主表
    const { error: updateError } = await supabase
      .from('sales_orders')
      .update({
        customer_cno: customer_id,
        order_date,
        delivery_method,
        total_amount,
        status,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) throw new Error(updateError.message);

    // 刪除舊明細、插入新明細
    await supabase.from('sales_order_items').delete().eq('sales_order_id', id);

    if (items && items.length > 0) {
      const itemsPayload = items.map((item: any) => ({
        sales_order_id: id,
        code: item.product_pno,
        quantity: item.quantity,
        unit_price: item.unit_price,
        subtotal: item.amount,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: itemsError } = await supabase.from('sales_order_items').insert(itemsPayload);
      if (itemsError) throw new Error(itemsError.message);
    }

    return;
  }
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
