# 備份與還原（本機離線版）

這份專案現在有三層備份：

1. Git 歷史備份（`.bundle`）
2. Supabase/Postgres 資料庫備份（`pg_dump`）
3. 機密檔（`.env*`）加密備份（AES-256）

## 一次跑三種備份

```bash
npm run backup:all
```

> `backup:db` 需要先有 `pg_dump` 指令（安裝 PostgreSQL client tools）

## 個別執行

### 1) Git bundle

```bash
npm run backup:git
```

輸出路徑：`backups/git/*.bundle`

### 2) 資料庫備份

```bash
npm run backup:db
```

輸出路徑：`backups/database/*.dump`

需要環境變數（擇一）：

- `SUPABASE_DB_URL`
- `DATABASE_URL`

腳本會依序讀取：

1. 系統環境變數
2. `.env.local`
3. `.env`

連線字串需為 PostgreSQL 連線（不是 `NEXT_PUBLIC_SUPABASE_URL`），例如：

`postgresql://postgres.xxxxx:[YOUR_PASSWORD]@aws-0-ap-xxx.pooler.supabase.com:6543/postgres?sslmode=require`

### 3) 機密檔加密備份

```bash
npm run backup:secrets
```

預設會嘗試備份：

- `.env`
- `.env.local`
- `.env.production`
- `.env.development`

輸出路徑：`backups/secrets/*.enc`

## 還原

### 還原 Git 歷史

```bash
git clone backups/git/your-backup.bundle restored-project
```

### 還原機密檔

```bash
npm run backup:restore-secrets -- -EncryptedFile backups/secrets/your-file.enc
```

預設還原到：`backups/secrets/restored`

## 建議排程（Windows 工作排程器）

- 每日：`npm run backup:git`
- 每日：`npm run backup:db`
- 每週：`npm run backup:secrets`
- 每月：實際還原演練一次（至少 git + db）

## 注意

- `backups/` 已在 `.gitignore`，不會推到 GitHub。
- `.bundle` 只保護程式碼歷史，不含資料庫即時資料。
- 請把 `backups/` 再複製到外接硬碟/NAS（離線異地備份）。
