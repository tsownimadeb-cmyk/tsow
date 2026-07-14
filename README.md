# 水聰飼料行進銷存系統

以 Next.js、Supabase 與本機 SQLite 建置的進貨、銷貨、庫存、應收與應付管理系統，支援離線操作與資料備份。

## 第一次啟動

1. 安裝 Node.js 20.9 以上版本。
2. 執行 `npm install` 安裝套件。
3. 複製 `.env.local.example` 為 `.env.local`，填入 Supabase 連線資訊、網站密碼與獨立的登入簽章密鑰。
4. 依照 [SETUP_DATABASE.md](./SETUP_DATABASE.md) 建立資料庫。
5. 執行 `npm run dev`，再開啟 <http://localhost:3000>。

Windows 使用者也可直接執行 `啟動應用.bat`。

## 上線前檢查

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

正式啟動使用 `npm run start`。建置階段會執行 TypeScript 檢查，型別錯誤不會再被忽略。

## 維護文件

- [資料備份與還原](./BACKUP.md)
- [離線同步操作](./OFFLINE_SYNC_GUIDE.md)
- [資料庫設定](./SETUP_DATABASE.md)
