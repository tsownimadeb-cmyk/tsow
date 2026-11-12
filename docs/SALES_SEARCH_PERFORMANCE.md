# 銷貨商品搜尋分頁

`scripts/061-optimize-sales-search.sql` 建立唯讀函式 `search_sales_orders_page` 及搜尋索引。函式在資料庫內依商品名稱／編號、單號／客戶／備註篩選，計算總筆數，再回傳當頁銷貨單與完整明細。網站不再下載全部符合的銷貨單來排序。

先在 Supabase SQL Editor 執行此 SQL，再部署網站。SQL 可以重複執行；不修改商品、銷貨單、庫存或帳款資料。若網站先部署且函式尚未建立，會暫時使用原有搜尋。已建立函式的權限、網路或 SQL 錯誤會正常顯示錯誤，不會被相容流程隱藏。

函式使用 `SECURITY INVOKER`，遵守呼叫者的資料表 RLS；只有 `authenticated`、`service_role` 可執行。百分號、底線及反斜線會當成搜尋文字。排序依銷貨日期、建立時間及 id，確保分頁順序固定。

必要時可移除此函式，讓網站恢復原有搜尋；新增索引可保留：

```sql
DROP FUNCTION IF EXISTS public.search_sales_orders_page(text, text, integer, integer);
NOTIFY pgrst, 'reload schema';
```

一般檢查：`npm test`、`npm run typecheck`、`npm run build`。

實際 PostgreSQL 測試為選用檢查，需要 `pg` 驅動套件及現有 `.env.local` 的 `SUPABASE_DB_URL`。在 PowerShell 執行：

```powershell
$env:RUN_POSTGRES_SEARCH_TESTS = "true"
npm test -- tests/sales-search-postgres.test.ts
Remove-Item Env:RUN_POSTGRES_SEARCH_TESTS
```

測試在獨立 schema 建立 5,000 張銷貨單和 1,200 個同名商品，完成後回滾整個 transaction；不寫入正式業務資料。測試涵蓋分頁、完整明細、組合搜尋、特殊字元、RLS 和重複執行 migration。

精確總筆數仍需要資料庫計算符合的單據，極深的頁數也有 OFFSET 成本；這次改善主要移除大量資料傳輸及網站逐批查詢、排序的負擔。客戶／商品編輯選項仍沿用頁面原有載入流程。
