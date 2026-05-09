import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addToSyncQueue, setOfflineSnapshot, getLocalDb } from '@/lib/local-db';
import { upsertPurchaseSnapshot } from '@/lib/desktop-offline-mutations';
import { isLocalOnlyMode } from '@/lib/runtime-mode-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, po_number, supplier_id, order_date, delivery_date, total_amount, status = 'draft', notes, items } = body;

    if (await isLocalOnlyMode()) {
      upsertPurchaseSnapshot({
        id,
        order_no: po_number,
        supplier_id,
        order_date,
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

      // 1. 建立主表
      const { error: purchaseError } = await supabase.from('purchases').insert({
        id,
        po_number,
        supplier_id,
        order_date,
        delivery_date,
        total_amount: total_amount || 0,
        status,
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (purchaseError) throw purchaseError;

      // 2. 建立細項
      if (items && items.length > 0) {
        const itemsPayload = items.map((item: any) => ({
          id: item.id || `item-${Math.random().toString(36).substring(7)}`,
          purchase_id: id,
          product_pno: item.product_pno,
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          amount: item.amount || 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        const { error: itemsError } = await supabase.from('purchase_items').insert(itemsPayload);
        if (itemsError) throw itemsError;
      }

      // 3. 更新本機快照
      setOfflineSnapshot('desktop-purchases-page', null);

      return NextResponse.json({ success: true, offline: false, id });
    } catch (onlineError: any) {
      // 網路失敗：存到本機隊列
      const db = getLocalDb();
      const queueId = addToSyncQueue('create', 'purchases', {
        id,
        po_number,
        supplier_id,
        order_date,
        delivery_date,
        total_amount,
        status,
        notes,
        items,
      });

      // 同時寫入本機快照（離線模式可以讀到）
      const localPurchase = {
        id,
        po_number,
        supplier_id,
        order_date,
        delivery_date,
        total_amount,
        status,
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // 若有細項，也寫到本機
      if (items && items.length > 0) {
        db.prepare(`
          INSERT INTO purchase_items (id, purchase_id, product_pno, quantity, unit_price, amount, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          `item-${Math.random().toString(36).substring(7)}`,
          id,
          items[0].product_pno,
          items[0].quantity,
          items[0].unit_price,
          items[0].amount,
          new Date().toISOString(),
          new Date().toISOString()
        );
      }

      return NextResponse.json({
        success: true,
        offline: true,
        queueId,
        message: 'Saved locally, will sync when online',
        id,
      });
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, po_number, supplier_id, order_date, delivery_date, total_amount, status, notes, items } = body;

    if (await isLocalOnlyMode()) {
      upsertPurchaseSnapshot({
        id,
        order_no: po_number,
        supplier_id,
        order_date,
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
        .from('purchases')
        .update({
          po_number,
          supplier_id,
          order_date,
          delivery_date,
          total_amount: total_amount || 0,
          status,
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      // 2. 更新細項（刪除舊的、插入新的）
      if (items && items.length > 0) {
        await supabase.from('purchase_items').delete().eq('purchase_id', id);

        const itemsPayload = items.map((item: any) => ({
          id: item.id || `item-${Math.random().toString(36).substring(7)}`,
          purchase_id: id,
          product_pno: item.product_pno,
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          amount: item.amount || 0,
          created_at: item.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));

        const { error: itemsError } = await supabase.from('purchase_items').insert(itemsPayload);
        if (itemsError) throw itemsError;
      }

      // 3. 更新快照
      setOfflineSnapshot('desktop-purchases-page', null);

      return NextResponse.json({ success: true, offline: false });
    } catch (onlineError: any) {
      // 網路失敗：存到本機隊列
      addToSyncQueue('update', 'purchases', {
        id,
        po_number,
        supplier_id,
        order_date,
        delivery_date,
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
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
