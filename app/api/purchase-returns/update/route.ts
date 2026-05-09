import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getLocalDb, addToSyncQueue, markSyncComplete, updateSyncError } from '@/lib/local-db';
import { v4 as uuidv4 } from 'uuid';

/**
 * 更新進貨退回單（支持離線）
 * 流程：先更新本地 SQLite → 再同步到遠端 Supabase
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { returnId, totalAmount, items, expectedUpdatedAt } = body;

    if (!returnId || !items || !Array.isArray(items)) {
      return NextResponse.json(
        { success: false, message: '資料不完整' },
        { status: 400 }
      );
    }

    // 0. 線上版本檢查：避免覆蓋其他裝置最新資料
    try {
      if (expectedUpdatedAt) {
        const supabase = await createClient();
        const { data: latest, error: latestError } = await supabase
          .from('purchase_returns')
          .select('updated_at')
          .eq('id', returnId)
          .single();

        if (!latestError && latest?.updated_at) {
          const remoteIso = new Date(latest.updated_at).toISOString();
          const expectedIso = new Date(expectedUpdatedAt).toISOString();
          if (remoteIso !== expectedIso) {
            return NextResponse.json(
              {
                success: false,
                message: '資料已在其他裝置更新，請重新整理後再提交。',
                code: 'VERSION_CONFLICT',
                remoteUpdatedAt: remoteIso,
                expectedUpdatedAt: expectedIso,
              },
              { status: 409 }
            );
          }
        }
      }
    } catch {
      // 若無法連線雲端，仍允許先寫本地與離線佇列
    }

    // 1️⃣ 先更新本地資料庫（離線可用）
    const localDb = getLocalDb();

    localDb.exec('BEGIN TRANSACTION');
    try {
      // 還原舊明細的庫存
      const oldItems = localDb
        .prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ?')
        .all(returnId);

      for (const oldItem of oldItems) {
        localDb.prepare(
          'UPDATE products SET stock_qty = stock_qty + ?, updated_at = ? WHERE pno = ?'
        ).run(oldItem.quantity, new Date().toISOString(), oldItem.product_pno);
      }

      // 刪除舊明細
      localDb
        .prepare('DELETE FROM purchase_return_items WHERE purchase_return_id = ?')
        .run(returnId);

      // 更新主表金額
      localDb
        .prepare(
          'UPDATE purchase_returns SET total_amount = ?, updated_at = ? WHERE id = ?'
        )
        .run(totalAmount, new Date().toISOString(), returnId);

      // 插入新明細並更新庫存
      for (const item of items) {
        const itemId = item.id || uuidv4();
        localDb.prepare(
          `INSERT INTO purchase_return_items 
           (id, purchase_return_id, product_pno, quantity, unit_price, amount, reason, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          itemId,
          returnId,
          item.productPno,
          item.quantity,
          item.unitPrice,
          item.amount,
          item.reason || null,
          new Date().toISOString(),
          new Date().toISOString()
        );

        // 扣庫存
        localDb.prepare(
          'UPDATE products SET stock_qty = stock_qty - ?, updated_at = ? WHERE pno = ?'
        ).run(item.quantity, new Date().toISOString(), item.productPno);
      }

      // 標記為未同步
      localDb
        .prepare('UPDATE purchase_returns SET synced = FALSE WHERE id = ?')
        .run(returnId);

      localDb.exec('COMMIT');
    } catch (e) {
      localDb.exec('ROLLBACK');
      throw e;
    }

    // 2️⃣ 異步同步到遠端 Supabase
    syncToSupabaseAsync(returnId, totalAmount, items, expectedUpdatedAt);

    return NextResponse.json({
      success: true,
      message: '已保存到本地，將自動同步到雲端',
      offline: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || '更新失敗' },
      { status: 500 }
    );
  }
}

/**
 * 異步同步到 Supabase（不阻塞用戶操作）
 */
async function syncToSupabaseAsync(
  returnId: string,
  totalAmount: number,
  items: any[],
  expectedUpdatedAt?: string
) {
  setImmediate(async () => {
    try {
      const supabase = await createClient();

      if (expectedUpdatedAt) {
        const { data: latest, error: latestError } = await supabase
          .from('purchase_returns')
          .select('updated_at')
          .eq('id', returnId)
          .single();

        if (!latestError && latest?.updated_at) {
          const remoteIso = new Date(latest.updated_at).toISOString();
          const expectedIso = new Date(expectedUpdatedAt).toISOString();
          if (remoteIso !== expectedIso) {
            throw new Error('VERSION_CONFLICT');
          }
        }
      }

      // 調用 RPC 函數
      const { error } = await supabase.rpc('update_purchase_return', {
        p_return_id: returnId,
        p_total_amount: totalAmount,
        p_items: JSON.stringify(
          items.map((item) => ({
            product_id: item.productPno,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            amount: item.amount,
            reason: item.reason || null,
          }))
        ),
      });

      if (error) throw error;

      // 標記為已同步
      const localDb = getLocalDb();
      localDb
        .prepare(
          'UPDATE purchase_returns SET synced = TRUE, sync_timestamp = ? WHERE id = ?'
        )
        .run(Date.now(), returnId);
    } catch (error: any) {
      // 添加到同步隊列，稍後重試
      addToSyncQueue(
        'update',
        'purchase_returns',
        { returnId, totalAmount, items, expectedUpdatedAt },
        returnId
      );
      console.error('Sync to Supabase failed, queued for retry:', error);
    }
  });
}
