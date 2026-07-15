# Supabase 上鎖發布手冊

這份手冊把「程式上線」和「資料庫上鎖」分開。先完成程式與登入驗證，再執行 RLS migration；順序不可顛倒。

## 1. 建立專用 Supabase 使用者

1. 到 Supabase Dashboard 的 Authentication → Users。
2. 建立一個只供本系統使用的 Email/Password 使用者。
3. 關閉公開註冊；不要把管理者 service role key 放進網站或 Vercel。
4. 將該使用者的 Email 與密碼保存在密碼管理器，不要寫進 Git。

## 2. 設定 Vercel Production 環境變數

在 Vercel Project Settings → Environment Variables，為 Production 設定：

- `SITE_PASSWORD`：使用者在登入畫面輸入的密碼，建議至少 16 個字元且不得重用。
- `SITE_AUTH_SECRET`：獨立的隨機簽章密鑰，至少 32 個字元；不可與網站密碼相同。
- `SUPABASE_AUTH_EMAIL`：上一步建立的專用 Supabase 使用者 Email。
- `SUPABASE_AUTH_PASSWORD`：該 Supabase 使用者的密碼。
- 保留既有 `NEXT_PUBLIC_SUPABASE_URL` 與 `NEXT_PUBLIC_SUPABASE_ANON_KEY`。

設定後重新部署。程式缺少或收到過短的 `SITE_AUTH_SECRET` 時會拒絕登入，不再從 `SITE_PASSWORD` 推導替代密鑰。

## 3. 上鎖前驗證

在尚未套用 migration 的狀態驗證：

1. Production 登入成功，商品、客戶、供應商、進貨、銷貨與帳款頁可正常讀取。
2. 建立一筆可刪除的非正式測試資料，確認新增、修改、刪除與重新整理後一致。
3. 登出後頁面與 `/api/` 路徑都回到未登入狀態。
4. 純本機模式仍可在沒有網路與 Supabase Auth 的情況下使用 SQLite。

## 4. 備份與還原驗證（必要）

1. 執行專案既有的資料庫備份流程，產生全新的備份。
2. 將備份還原到另一個 Supabase 專案或本機 PostgreSQL。
3. 核對核心表筆數，並抽查商品庫存、單據、明細與 AR/AP 金額。
4. 記錄備份時間、檔名、還原環境與驗證結果。沒有成功還原紀錄，不得操作 Production RLS。

## 5. 套用與驗證上鎖

備份驗證完成後，依序執行：

1. `scripts/048-create-order-delete-rpc-functions.sql`，先提供新的原子刪除功能。
2. 部署與這兩份 migration 配套的程式版本，登入並完成基本讀寫及刪除驗證。
3. `scripts/047-lock-down-supabase-authenticated-only.sql`，最後撤銷匿名權限。

完成後立即驗證：

1. 不帶 Supabase 使用者 session、只帶 anon key 的 REST 請求無法讀取任何業務資料。
2. 正常登入網站後可讀寫資料。
3. 原子儲存、原子刪除、退貨、客戶代碼更名及報表 RPC 正常。
4. 有收付款、支票或退貨紀錄的單據會拒絕刪除，未付款且無退貨的測試單可完整刪除並正確反向庫存。
5. 登出後 API 回應 401，重新登入後恢復。

若登入後無法使用，先停止寫入並使用備份還原。不要臨時恢復 `anon` 的全面權限；應先找出漏帶 session 的程式路徑，在可回復環境修正並重測。
