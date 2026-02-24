# 資料庫設定步驟

## 重要！必須先執行以下步驟才能使用系統

### 步驟 1: 在 Supabase 中執行 SQL 腳本

1. 登入 Supabase 控制台: https://supabase.com/dashboard
2. 選擇您的專案
3. 進入 SQL Editor（SQL 編輯器）
4. **依序執行以下三個 SQL 腳本**：

#### 第一步：建立表格
- 複製並執行 `scripts/001-create-tables.sql` 的所有內容
- 此腳本會建立所有必要的表格和 RLS 政策

#### 第二步：新增初始測試資料
- 複製並執行 `scripts/002-seed-data.sql` 的所有內容
- 此腳本會新增示例供應商、客戶和分類資料

#### 第三步（可選）：清理 SKU 欄位
- 如果需要，可執行 `scripts/003-remove-sku.sql`

### 步驟 2: 驗證資料庫

在 Supabase 控制台中，檢查是否有以下表格：
- ✓ categories（商品分類）
- ✓ suppliers（供應商）
- ✓ customers（客戶）
- ✓ products（商品）
- ✓ purchase_orders（進貨單）
- ✓ purchase_order_items（進貨明細）
- ✓ sales_orders（銷貨單）
- ✓ sales_order_items（銷貨明細）

### 步驟 3: 測試應用

完成 SQL 執行後：
1. 重新整理瀏覽器頁面（刷新 F5）
2. 嘗試新增供應商、客戶、商品等
3. 應該能看到成功或失敗的通知訊息

## 常見問題

### 問題：新增後沒有任何反應
- 檢查是否已執行 SQL 腳本
- 檢查 Supabase 環境變數是否正確（`.env.local`）
- 打開瀏覽器開發者工具（F12）查看 Console 中的錯誤

### 問題：看不到成功/失敗的提示
- 確保 layout.tsx 中有 `<Toaster />` 組件
- 重新整理瀏覽器頁面
- 檢查是否有 JavaScript 錯誤

### 問題：收到 RLS 相關錯誤
- 確認已執行 `001-create-tables.sql` 中的 RLS 政策部分
- 所有表格應該有 "Allow public access" 政策

## 環境變數檢查

確保 `.env.local` 中有以下設定：
```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
```

這些值應該在 Supabase 專案設定 > API 中找到。
