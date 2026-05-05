"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

type ReturnItem = {
  productId: string;
  productName: string;
  originalQty: number;
  unitPrice: number;
  returnQty: number;
  reason: string;
};

export default function EditSalesReturnPage() {
  const router = useRouter();
  const params = useParams();
  const returnId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orderNumber, setOrderNumber] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [items, setItems] = useState<ReturnItem[]>([]);

  useEffect(() => {
    const fetchReturn = async () => {
      setLoading(true);
      const supabase = createClient();

      // 1. 載入退回主表
      const { data: ret, error: retError } = await supabase
        .from("sales_returns")
        .select("*")
        .eq("id", returnId)
        .single();

      if (retError || !ret) {
        toast({ title: "載入失敗", description: "找不到此退回單", variant: "destructive" });
        router.push("/sales-returns");
        return;
      }

      setOrderNumber(ret.order_number || "");
      setReturnDate(ret.created_at || "");

      // 2. 載入客戶名稱
      if (ret.customer_code) {
        const { data: customer } = await supabase
          .from("customers")
          .select("name")
          .eq("code", ret.customer_code)
          .single();
        setCustomerName(customer?.name || ret.customer_code);
      }

      // 3. 載入明細
      const { data: retItems, error: itemsError } = await supabase
        .from("sales_return_items")
        .select("*")
        .eq("sales_return_id", returnId);

      if (itemsError) {
        toast({ title: "載入明細失敗", description: itemsError.message, variant: "destructive" });
        setLoading(false);
        return;
      }

      // 4. 查商品名稱
      const codes = Array.from(new Set((retItems || []).map((i: any) => i.product_code).filter(Boolean)));
      let productMap: Record<string, string> = {};
      if (codes.length > 0) {
        const { data: products } = await supabase
          .from("products")
          .select("code, name")
          .in("code", codes);
        if (products) {
          productMap = Object.fromEntries(products.map((p: any) => [p.code, p.name]));
        }
      }

      // 5. 查原始銷貨單的數量（用於顯示原銷貨數量）
      let originalQtyMap: Record<string, number> = {};
      if (ret.sales_order_id) {
        const { data: soItems } = await supabase
          .from("sales_order_items")
          .select("code, quantity")
          .eq("sales_order_id", ret.sales_order_id);
        if (soItems) {
          originalQtyMap = Object.fromEntries(soItems.map((i: any) => [i.code, i.quantity]));
        }
      }

      setItems(
        (retItems || []).map((i: any) => ({
          productId: i.product_code,
          productName: productMap[i.product_code] || i.product_code,
          originalQty: originalQtyMap[i.product_code] ?? i.quantity,
          unitPrice: i.unit_price,
          returnQty: i.quantity,
          reason: i.reason || "",
        }))
      );

      setLoading(false);
    };

    fetchReturn();
  }, [returnId]);

  const handleQtyChange = (productId: string, qty: number) => {
    setItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, returnQty: qty } : item
      )
    );
  };

  const handleReasonChange = (productId: string, reason: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, reason } : item
      )
    );
  };

  const handleSave = async () => {
    const itemsToReturn = items.filter((item) => Number(item.returnQty) > 0);
    if (itemsToReturn.length === 0) {
      toast({ title: "請輸入退回數量", description: "至少需有一項商品退回。", variant: "destructive" });
      return;
    }

    setSaving(true);
    const supabase = createClient();
    try {
      const totalAmount = itemsToReturn.reduce(
        (sum, item) => sum + item.returnQty * item.unitPrice,
        0
      );

      const { error } = await supabase.rpc("update_sales_return", {
        p_return_id:    returnId,
        p_total_amount: totalAmount,
        p_items: itemsToReturn.map((item) => ({
          product_code: item.productId,
          quantity:     item.returnQty,
          unit_price:   item.unitPrice,
          reason:       item.reason || null,
        })),
      });

      if (error) throw error;

      toast({ title: "儲存成功", description: "銷貨退回已更新。" });
      setTimeout(() => router.push("/sales-returns"), 600);
    } catch (err: any) {
      toast({ title: "儲存失敗", description: err.message || String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-center">載入中...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" onClick={() => router.push("/sales-returns")}>
          ← 返回
        </Button>
        <h2 className="text-2xl font-bold">編輯銷貨退回</h2>
      </div>

      {/* 基本資訊 */}
      <div className="mb-6 space-y-2 text-sm text-gray-600">
        <div><span className="font-medium text-gray-700">銷貨單號：</span>{orderNumber || "-"}</div>
        <div><span className="font-medium text-gray-700">客戶：</span>{customerName || "-"}</div>
        <div><span className="font-medium text-gray-700">退回日期：</span>{returnDate ? new Date(returnDate).toLocaleDateString("zh-TW") : "-"}</div>
      </div>

      {/* 桌面版表格 */}
      <div className="hidden md:block">
        <div className="grid grid-cols-[30%_15%_15%_15%_25%] bg-muted text-sm font-semibold border-b">
          <div className="py-2 px-3 text-left">商品名稱</div>
          <div className="py-2 px-3 text-right">原銷貨數量</div>
          <div className="py-2 px-3 text-right">售價</div>
          <div className="py-2 px-3 text-center">退回數量</div>
          <div className="py-2 px-3 text-center">退回原因</div>
        </div>
        {items.map((item) => (
          <div key={item.productId} className="grid grid-cols-[30%_15%_15%_15%_25%] border-b last:border-0 items-center">
            <div className="py-2 px-3 text-left break-all">{item.productName}</div>
            <div className="py-2 px-3 text-right tabular-nums">{item.originalQty}</div>
            <div className="py-2 px-3 text-right tabular-nums">{item.unitPrice}</div>
            <div className="py-2 px-3 flex justify-center items-center">
              <Input
                type="number"
                min={0}
                max={item.originalQty}
                value={item.returnQty}
                onChange={(e) => handleQtyChange(item.productId, Number(e.target.value))}
                onFocus={(e) => e.target.select()}
                className="h-9 w-full text-right"
                style={{ maxWidth: 80 }}
              />
            </div>
            <div className="py-2 px-3 flex items-center">
              <Input
                value={item.reason}
                onChange={(e) => handleReasonChange(item.productId, e.target.value)}
                className="h-9 w-full"
              />
            </div>
          </div>
        ))}
      </div>

      {/* 手機版卡片 */}
      <div className="block md:hidden space-y-4">
        {items.map((item) => (
          <Card key={item.productId} className="shadow-sm bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold truncate">{item.productName}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">原銷貨數量</span>
                <span className="tabular-nums">{item.originalQty}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">售價</span>
                <span className="tabular-nums">{item.unitPrice}</span>
              </div>
              <div className="flex justify-between items-center text-sm mt-2">
                <span className="text-gray-500">退回數量</span>
                <Input
                  type="number"
                  min={0}
                  max={item.originalQty}
                  value={item.returnQty}
                  onChange={(e) => handleQtyChange(item.productId, Number(e.target.value))}
                  onFocus={(e) => e.target.select()}
                  className="h-9 w-20 text-right"
                />
              </div>
              <div className="flex justify-between items-center text-sm mt-2">
                <span className="text-gray-500">退回原因</span>
                <Input
                  value={item.reason}
                  onChange={(e) => handleReasonChange(item.productId, e.target.value)}
                  className="h-9 w-32"
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-6">
        <Button onClick={handleSave} disabled={saving} className="w-full md:w-auto">
          {saving ? "儲存中..." : "儲存"}
        </Button>
      </div>
    </div>
  );
}
