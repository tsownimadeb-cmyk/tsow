import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { upsertPurchaseSnapshot } from '@/lib/desktop-offline-mutations';
import { isLocalOnlyMode } from '@/lib/runtime-mode-server';
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/site-auth';
import { randomUUID } from 'crypto';
import {
  isAtomicOrderTransportError,
  isMissingAtomicOrderRpc,
  PURCHASE_ORDER_ATOMIC_RPC,
} from '@/lib/order-atomic-rpc';

function isUuid(value: unknown) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function POST(req: NextRequest) {
  const cookieValue = req.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  try {
    const body = await req.json();
    const { id, po_number, supplier_id, order_date, total_amount, shipping_fee, status = 'draft', is_paid = false, notes, items } = body;
    const normalizedId = isUuid(id) ? id : randomUUID();

    if (await isLocalOnlyMode()) {
      upsertPurchaseSnapshot({
        id: normalizedId,
        order_no: po_number,
        supplier_id,
        order_date,
        total_amount: total_amount || 0,
        shipping_fee: shipping_fee || 0,
        status,
        is_paid: Boolean(is_paid),
        notes,
        items,
      });
      return NextResponse.json({ success: true, offline: true, localOnly: true, id: normalizedId });
    }

    // 嘗試線上操作
    try {
      const supabase = await createClient();

      const atomicResult = await supabase.rpc(PURCHASE_ORDER_ATOMIC_RPC, {
        p_order_id: normalizedId,
        p_order_no: po_number,
        p_supplier_id: supplier_id || null,
        p_order_date: order_date,
        p_total_amount: total_amount || 0,
        p_shipping_fee: shipping_fee || 0,
        p_status: status,
        p_is_paid: Boolean(is_paid),
        p_notes: notes || null,
        p_items: (items || []).map((item: any) => ({
          code: item.product_pno ?? item.code,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      });

      if (!atomicResult.error) {
        return NextResponse.json({ success: true, offline: false, atomic: true, id: normalizedId });
      }

      if (!isMissingAtomicOrderRpc(atomicResult.error, PURCHASE_ORDER_ATOMIC_RPC)) {
        if (isAtomicOrderTransportError(atomicResult.error)) {
          throw atomicResult.error;
        }

        return NextResponse.json(
          { error: atomicResult.error.message || '進貨單儲存失敗' },
          { status: 400 },
        );
      }

      // 1. 建立主表
      const { error: purchaseError } = await supabase.from('purchase_orders').insert({
        id: normalizedId,
        order_no: po_number,
        supplier_id,
        order_date,
        total_amount: total_amount || 0,
        shipping_fee: shipping_fee || 0,
        status,
        is_paid: Boolean(is_paid),
        notes,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      if (purchaseError) throw purchaseError;

      // 2. 建立細項
      if (items && items.length > 0) {
        const itemsPayload = items.map((item: any) => ({
          id: isUuid(item.id) ? item.id : randomUUID(),
          purchase_order_id: normalizedId,
          order_no: po_number,
          code: item.product_pno,
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          subtotal: item.amount || 0,
          created_at: new Date().toISOString(),
        }));

        const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsPayload);
        if (itemsError) throw itemsError;
      }

      return NextResponse.json({ success: true, offline: false, id: normalizedId });
    } catch (onlineError: any) {
      return NextResponse.json(
        { success: false, error: onlineError?.message || '雲端儲存失敗，操作已保留在瀏覽器等待重試。' },
        { status: 502 },
      );
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const cookieValue = req.cookies.get(AUTH_COOKIE_NAME)?.value
  const isAuthenticated = await verifyAuthToken(cookieValue)

  if (!isAuthenticated) {
    return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
  }

  try {
    const body = await req.json();
    const { id, po_number, supplier_id, order_date, total_amount, shipping_fee, status, is_paid = false, notes, items } = body;
    if (!isUuid(id)) {
      return NextResponse.json({ error: 'Invalid purchase id' }, { status: 400 });
    }

    if (await isLocalOnlyMode()) {
      upsertPurchaseSnapshot({
        id,
        order_no: po_number,
        supplier_id,
        order_date,
        total_amount: total_amount || 0,
        shipping_fee: shipping_fee || 0,
        status,
        is_paid: Boolean(is_paid),
        notes,
        items,
      });
      return NextResponse.json({ success: true, offline: true, localOnly: true, id });
    }

    // 嘗試線上操作
    try {
      const supabase = await createClient();

      const atomicResult = await supabase.rpc(PURCHASE_ORDER_ATOMIC_RPC, {
        p_order_id: id,
        p_order_no: po_number,
        p_supplier_id: supplier_id || null,
        p_order_date: order_date,
        p_total_amount: total_amount || 0,
        p_shipping_fee: shipping_fee || 0,
        p_status: status,
        p_is_paid: Boolean(is_paid),
        p_notes: notes || null,
        p_items: (items || []).map((item: any) => ({
          code: item.product_pno ?? item.code,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      });

      if (!atomicResult.error) {
        return NextResponse.json({ success: true, offline: false, atomic: true, id });
      }

      if (!isMissingAtomicOrderRpc(atomicResult.error, PURCHASE_ORDER_ATOMIC_RPC)) {
        if (isAtomicOrderTransportError(atomicResult.error)) {
          throw atomicResult.error;
        }

        return NextResponse.json(
          { error: atomicResult.error.message || '進貨單儲存失敗' },
          { status: 400 },
        );
      }

      const { error: updateError } = await supabase
        .from('purchase_orders')
        .update({
          order_no: po_number,
          supplier_id,
          order_date,
          total_amount: total_amount || 0,
          shipping_fee: shipping_fee || 0,
          status,
          is_paid: Boolean(is_paid),
          notes,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (updateError) throw updateError;

      // 2. 更新細項（刪除舊的、插入新的）
      if (items && items.length > 0) {
        await supabase.from('purchase_order_items').delete().eq('purchase_order_id', id);

        const itemsPayload = items.map((item: any) => ({
          id: isUuid(item.id) ? item.id : randomUUID(),
          purchase_order_id: id,
          order_no: po_number,
          code: item.product_pno,
          quantity: item.quantity || 0,
          unit_price: item.unit_price || 0,
          subtotal: item.amount || 0,
          created_at: item.created_at || new Date().toISOString(),
        }));

        const { error: itemsError } = await supabase.from('purchase_order_items').insert(itemsPayload);
        if (itemsError) throw itemsError;
      }

      return NextResponse.json({ success: true, offline: false });
    } catch (onlineError: any) {
      return NextResponse.json(
        { success: false, error: onlineError?.message || '雲端儲存失敗，操作已保留在瀏覽器等待重試。' },
        { status: 502 },
      );
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
