import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addToSyncQueue, setOfflineSnapshot, getLocalDb } from '@/lib/local-db';
import { upsertSaleSnapshot } from '@/lib/desktop-offline-mutations';
import { isLocalOnlyMode } from '@/lib/runtime-mode-server';
import { randomUUID } from 'crypto';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

function isUuid(value: unknown) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, so_number, customer_id, order_date, delivery_date, delivery_method, total_amount, status = 'draft', notes, items } = body;
    const normalizedId = isUuid(id) ? id : randomUUID();

    if (await isLocalOnlyMode()) {
      upsertSaleSnapshot({
        id: normalizedId,
        order_no: so_number,
        customer_cno: customer_id,
        order_date,
        delivery_method,
        total_amount: total_amount || 0,
        status,
        notes,
        items,
      });
      return NextResponse.json({ success: true, offline: true, localOnly: true, id: normalizedId });
    }

    // 嘗試線上操作
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      // 1. 建立主表
      const { error: saleError } = await supabase.from('sales_orders').insert({
        id: normalizedId,
        order_no: so_number,
        customer_cno: customer_id,
        order_date,
        delivery_method,
        total_amount: total_amount || 0,
        status,
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (saleError) throw saleError;

      // 2. 建立細項
      if (items && items.length > 0) {
        const itemsPayload = items.map((item: any) => ({
          id: isUuid(item.id) ? item.id : randomUUID(),
          sales_order_id: normalizedId,
          code: item.product_pno,
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          subtotal: item.amount || 0,
          created_at: new Date().toISOString(),
        }));

        const { error: itemsError } = await supabase.from('sales_order_items').insert(itemsPayload);
        if (itemsError) throw itemsError;
      }

      // 3. 更新本機快照
      setOfflineSnapshot('desktop-sales-page', null);

      return NextResponse.json({ success: true, offline: false, id: normalizedId });
    } catch (onlineError: any) {
      // 線上失敗後才嘗試本機佇列；若本機 DB 不可用，回傳線上錯誤。
      try {
        getLocalDb();
        const queueId = addToSyncQueue('create', 'sales', {
          id: normalizedId,
          so_number,
          customer_id,
          order_date,
          delivery_date,
          delivery_method,
          total_amount,
          status,
          notes,
          items,
        });

        return NextResponse.json({
          success: true,
          offline: true,
          queueId,
          message: 'Saved locally, will sync when online',
          id: normalizedId,
        });
      } catch {
        return NextResponse.json(
          { error: onlineError?.message || '線上儲存失敗，且本機離線儲存不可用' },
          { status: 502 }
        );
      }
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, so_number, customer_id, order_date, delivery_date, delivery_method, total_amount, status, notes, items } = body;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid sales id' }, { status: 400 });
    }

    if (await isLocalOnlyMode()) {
      upsertSaleSnapshot({
        id,
        order_no: so_number,
        customer_cno: customer_id,
        order_date,
        delivery_method,
        total_amount: total_amount || 0,
        status,
        notes,
        items,
      });
      return NextResponse.json({ success: true, offline: true, localOnly: true, id });
    }

    // 嘗試線上操作
    try {
      const supabase = createClient(supabaseUrl, supabaseAnonKey);

      const { error: updateError } = await supabase
        .from('sales_orders')
        .update({
          order_no: so_number,
          customer_cno: customer_id,
          order_date,
          delivery_method,
          total_amount: total_amount || 0,
          status,
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      // 2. 更新細項（刪除舊的、插入新的）
      if (items && items.length > 0) {
        await supabase.from('sales_order_items').delete().eq('sales_order_id', id);

        const itemsPayload = items.map((item: any) => ({
          id: isUuid(item.id) ? item.id : randomUUID(),
          sales_order_id: id,
          code: item.product_pno,
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          subtotal: item.amount || 0,
          created_at: item.created_at || new Date().toISOString(),
        }));

        const { error: itemsError } = await supabase.from('sales_order_items').insert(itemsPayload);
        if (itemsError) throw itemsError;
      }

      // 3. 更新快照
      setOfflineSnapshot('desktop-sales-page', null);

      return NextResponse.json({ success: true, offline: false });
    } catch (onlineError: any) {
      // 線上失敗後才嘗試本機佇列；若本機 DB 不可用，回傳線上錯誤。
      try {
        addToSyncQueue('update', 'sales', {
          id,
          so_number,
          customer_id,
          order_date,
          delivery_date,
          delivery_method,
          total_amount,
          status,
          notes,
          items,
        });

        return NextResponse.json({
          success: true,
          offline: true,
          message: 'Saved locally, will sync when online',
        });
      } catch {
        return NextResponse.json(
          { error: onlineError?.message || '線上儲存失敗，且本機離線儲存不可用' },
          { status: 502 }
        );
      }
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
