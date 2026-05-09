# 離線優先使用指南

## 🎯 功能概述

此系統現已支持**離線優先**模式：
- ✅ 無網路時：本地 SQLite 資料庫儲存變更
- ✅ 有網路時：自動同步到 Supabase
- ✅ 衝突處理：採用樂觀更新策略

---

## 📁 新增檔案結構

```
lib/
  ├── local-db.ts           # SQLite 本地資料庫層
  └── sync-service.ts       # 同步服務

hooks/
  └── use-offline-sync.ts   # React 離線同步 Hook

app/api/
  ├── purchase-returns/update/   # 進貨退回更新 API
  ├── sales-returns/update/      # 銷貨退回更新 API
  └── sync/                      # 手動同步 API
```

---

## 🔧 使用方式

### 1️⃣ **在更新退貨單時調用新 API**

#### 進貨退回更新（PUT）

```typescript
// 發送請求到新 API
const response = await fetch('/api/purchase-returns/update', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    returnId: 'uuid...',
    totalAmount: 1000,
    items: [
      {
        id: 'item-uuid',
        productPno: 'P001',
        quantity: 5,
        unitPrice: 200,
        amount: 1000,
        reason: '品質不符',
      },
    ],
  }),
});

const data = await response.json();
console.log(data.offline); // true = 已保存到本地，待同步
```

#### 銷貨退回更新（PUT）

```typescript
// 發送請求到新 API
const response = await fetch('/api/sales-returns/update', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    returnId: 'uuid...',
    totalAmount: 1000,
    items: [
      {
        id: 'item-uuid',
        productPno: 'P001',
        quantity: 5,
        unitPrice: 200,
        reason: '客戶要求',
      },
    ],
  }),
});

const data = await response.json();
// 數據已保存本地，自動同步到雲端
```

### 2️⃣ **在 React 組件中使用離線同步 Hook**

```typescript
'use client';

import { useOfflineSync } from '@/hooks/use-offline-sync';

export function MyComponent() {
  const { isOnline, isSyncing, pendingCount, performSync } = useOfflineSync();

  return (
    <div>
      {!isOnline ? (
        <div className="offline-banner">
          ⚠️ 離線模式 - {pendingCount} 個待同步項目
        </div>
      ) : (
        <div className="online-badge">
          ✅ 線上 {isSyncing && '(同步中...)'}
        </div>
      )}
      
      {pendingCount > 0 && (
        <button onClick={performSync} disabled={isSyncing}>
          {isSyncing ? '同步中...' : '手動同步'}
        </button>
      )}
    </div>
  );
}
```

### 3️⃣ **手動觸發同步**

```typescript
// 發送 GET 請求手動同步
const response = await fetch('/api/sync');
const data = await response.json();

console.log(`已同步: ${data.synced}, 失敗: ${data.failed}`);
```

---

## 📊 數據流程

```
用戶操作
  ↓
PUT /api/purchase-returns/update (或 /sales-returns/update)
  ↓
✅ 立即保存到本地 SQLite (離線可用)
  ↓
返回 { success: true, offline: true }
  ↓
后台異步同步到 Supabase
  ├─ 成功 → 標記為 synced = TRUE
  └─ 失敗 → 加入 sync_queue 等待重試
```

---

## 🔄 同步機制

### 自動同步觸發：
1. **網路恢復時** - 監聽 `online` 事件自動同步
2. **定期檢查** - 每 30 秒檢查一次（如果有網路）
3. **手動同步** - 用戶點擊"同步"按鈕

### 重試邏輯：
- 失敗的同步會加入 `sync_queue` 表
- 最多重試 3 次
- 每次重試記錄錯誤信息

---

## 🗄️ 本地資料庫表結構

```sql
-- 進貨退回
purchase_returns
  ├── id (PRIMARY KEY)
  ├── purchase_order_id
  ├── supplier_id
  ├── total_amount
  ├── synced (FALSE = 待同步)
  └── sync_timestamp

purchase_return_items
  ├── id (PRIMARY KEY)
  ├── purchase_return_id
  ├── product_pno
  ├── quantity
  ├── unit_price
  └── amount

-- 銷貨退回
sales_returns
  ├── id (PRIMARY KEY)
  ├── sales_order_id
  ├── customer_id
  ├── total_amount
  └── synced

sales_return_items
  ├── id (PRIMARY KEY)
  ├── sales_return_id
  ├── product_pno
  ├── quantity
  └── unit_price

-- 同步隊列
sync_queue
  ├── id (PRIMARY KEY)
  ├── operation (create/update/delete)
  ├── entity (purchase_returns/sales_returns)
  ├── data (JSON)
  ├── retry_count
  ├── last_error
  └── created_at
```

---

## 🚀 部署注意事項

### 開發環境
```bash
npm run dev
# 自動初始化本地 SQLite 於 ~/.inventory-system/local.db
```

### 生產環境
```bash
npm run build
npm run start
# 確保 Node.js 可以寫入 ~/.inventory-system/ 目錄
```

### 權限設置
```bash
# Linux/Mac - 確保應用可寫入目錄
chmod 700 ~/.inventory-system/
```

---

## ⚠️ 已知限制

1. **SQLite 限制**：single-file 資料庫，不適合極高並發
2. **同步延遲**：離線編輯後可能有幾秒延遲才能同步
3. **衝突解決**：目前採用簡單的「最後寫入獲勝」策略
4. **儲存限制**：SQLite 本地儲存受硬碟空間限制

---

## 🔧 故障排查

### 同步失敗？
```typescript
// 查看 sync_queue 表
SELECT * FROM sync_queue WHERE retry_count >= 3;

// 手動清理隊列
DELETE FROM sync_queue WHERE id = '...';
```

### 本地資料庫路徑
```
Windows: %USERPROFILE%\.inventory-system\local.db
Linux/Mac: ~/.inventory-system/local.db
```

### 強制重新同步
```typescript
// 重置 synced 標記
const db = getLocalDb();
db.prepare('UPDATE purchase_returns SET synced = FALSE').run();

// 然後手動調用同步
fetch('/api/sync');
```

---

## 📚 相關 SQL 函數

已支持的 RPC 函數：
- ✅ `update_purchase_return()` - 進貨退回更新
- ✅ `update_sales_return()` - 銷貨退回更新

---

## 🎓 最佳實踐

1. **始終監聽網路狀態** - 在頂層組件使用 `useOfflineSync`
2. **顯示同步狀態** - 向用戶反饋待同步項目數
3. **定期備份** - 在連接雲端時確保數據同步完成
4. **避免大批量編輯** - 離線時大量改動可能導致同步變慢

---

更多問題？查看 `lib/local-db.ts` 和 `lib/sync-service.ts` 的詳細註釋。
