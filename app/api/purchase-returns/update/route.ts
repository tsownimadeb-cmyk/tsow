import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getLocalDb } from '@/lib/local-db';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/site-auth';
import { isLocalOnlyMode } from '@/lib/runtime-mode-server';
import { v4 as uuidv4 } from 'uuid';

interface LocalPurchaseReturnItemRow {
  quantity: number;
  product_pno: string;
}

async function syncPurchaseReturnNow(returnId: string, totalAmount: number, items: any[]) {
  const supabase = await createClient();
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

  if (error) {
    throw new Error(error.message || '同步雲端失敗');
  }
}

/**
 * 更新進貨退回單（支持離線）
 * 流程：先更新本地 SQLite → 再同步到遠端 Supabase
 */
export async function PUT(request: NextRequest) {
  const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  try {
    const body = await request.json();
    const { returnId, totalAmount, items, expectedUpdatedAt } = body;

    if (!returnId || !items || !Array.isArray(items)) {
      return NextResponse.json(
        { success: false, message: '資料不完整' },
        { status: 400 }
      );
    }

    if (!(await isLocalOnlyMode())) {
      if (expectedUpdatedAt) {
        const supabase = await createClient();
        const { data: latest, error: latestError } = await supabase
          .from('purchase_returns')
          .select('updated_at')
          .eq('id', returnId)
          .single();

        if (latestError) throw latestError
        if (latest?.updated_at) {
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

      await syncPurchaseReturnNow(returnId, totalAmount, items)
      return NextResponse.json({
        success: true,
        message: '已同步到雲端',
        offline: false,
      })
    }

    // 純本機模式才可寫入 SQLite；雲端模式絕不把 Vercel 暫存目錄當成離線佇列。
    const localDb = getLocalDb();

    localDb.exec('BEGIN TRANSACTION');
    try {
      // 還原舊明細的庫存
      const oldItems = localDb
        .prepare('SELECT * FROM purchase_return_items WHERE purchase_return_id = ?')
        .all(returnId) as LocalPurchaseReturnItemRow[];

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

    return NextResponse.json({
      success: true,
      message: '已保存到本機',
      offline: true,
      localOnly: true,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error.message || '更新失敗' },
      { status: 500 }
    );
  }
}
