/**
 * 進貨退回編輯頁面集成示例
 * 展示如何使用離線優先 API 更新退貨單
 */

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useOfflineSync } from '@/hooks/use-offline-sync';
import { toast } from '@/hooks/use-toast';

interface PurchaseReturnItem {
  id?: string;
  productPno: string;
  productName?: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  reason?: string;
}

interface PurchaseReturnEditPageProps {
  params: {
    id: string;
  };
}

export default function PurchaseReturnEditPage({
  params,
}: PurchaseReturnEditPageProps) {
  const router = useRouter();
  const { isOnline, isSyncing, pendingCount } = useOfflineSync();

  const [returnData, setReturnData] = useState<any>(null);
  const [items, setItems] = useState<PurchaseReturnItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // 載入數據
  useEffect(() => {
    const loadData = async () => {
      try {
        // 從 Supabase 載入現有資料
        const response = await fetch(`/api/purchase-returns/${params.id}`);
        if (!response.ok) throw new Error('載入失敗');

        const data = await response.json();
        setReturnData(data);
        setItems(data.items || []);
      } catch (error) {
        toast({
          title: '錯誤',
          description: '無法載入數據',
          variant: 'destructive',
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [params.id]);

  // 保存變更
  const handleSave = async () => {
    if (!returnData || items.length === 0) {
      toast({
        title: '驗證失敗',
        description: '請確保有至少一個退貨項目',
        variant: 'destructive',
      });
      return;
    }

    setSaving(true);

    try {
      const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

      // 使用新的離線優先 API
      const response = await fetch('/api/purchase-returns/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnId: params.id,
          totalAmount,
          items,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.message);
      }

      // 反饋信息
      if (result.offline) {
        toast({
          title: '已保存到本地',
          description: '將自動同步到雲端' + (!isOnline ? '（現在離線）' : ''),
          variant: 'default',
        });
      } else {
        toast({
          title: '已更新',
          description: '變更已同步到雲端',
        });
      }

      // 返回列表頁
      setTimeout(() => {
        router.push('/purchase-returns');
      }, 1500);
    } catch (error: any) {
      toast({
        title: '保存失敗',
        description: error.message || '發生錯誤',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4">載入中...</div>;
  }

  return (
    <div className="space-y-4">
      {/* 狀態欄 */}
      <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border">
        <div className="flex items-center gap-2">
          {isOnline ? (
            <div className="flex items-center gap-2 text-green-600">
              <span className="w-2 h-2 bg-green-600 rounded-full"></span>
              <span>線上{isSyncing && '（同步中）'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-amber-600">
              <span className="w-2 h-2 bg-amber-600 rounded-full animate-pulse"></span>
              <span>離線模式</span>
            </div>
          )}

          {pendingCount > 0 && (
            <span className="ml-4 text-sm text-slate-600">
              {pendingCount} 個待同步項目
            </span>
          )}
        </div>

        <div className="text-sm text-slate-600">
          {!isOnline && '編輯內容已保存到本機，網路恢復時自動同步'}
        </div>
      </div>

      {/* 退貨單信息 */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium">退貨日期</label>
          <input
            type="date"
            value={returnData?.return_date || ''}
            className="w-full border rounded px-3 py-2 mt-1"
            readOnly
          />
        </div>
        <div>
          <label className="text-sm font-medium">總金額</label>
          <input
            type="text"
            value={items.reduce((sum, item) => sum + item.amount, 0)}
            className="w-full border rounded px-3 py-2 mt-1"
            disabled
          />
        </div>
      </div>

      {/* 退貨明細表 */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-100">
            <tr>
              <th className="px-4 py-2 text-left">商品編號</th>
              <th className="px-4 py-2 text-left">商品名稱</th>
              <th className="px-4 py-2 text-right">數量</th>
              <th className="px-4 py-2 text-right">單價</th>
              <th className="px-4 py-2 text-right">小計</th>
              <th className="px-4 py-2 text-left">退貨原因</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-t">
                <td className="px-4 py-2">{item.productPno}</td>
                <td className="px-4 py-2">{item.productName}</td>
                <td className="px-4 py-2 text-right">{item.quantity}</td>
                <td className="px-4 py-2 text-right">{item.unitPrice}</td>
                <td className="px-4 py-2 text-right">{item.amount}</td>
                <td className="px-4 py-2">{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 操作按鈕 */}
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => router.back()}
          className="px-4 py-2 border rounded hover:bg-slate-50"
        >
          取消
        </button>
        <button
          onClick={handleSave}
          disabled={saving || isSyncing}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存變更'}
        </button>
      </div>

      {/* 離線提示 */}
      {!isOnline && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded">
          <p className="text-sm text-amber-800">
            💾 您現在處於離線模式。所有變更已保存到本機。
            當網路恢復時，系統將自動將變更同步到雲端。
          </p>
        </div>
      )}
    </div>
  );
}
