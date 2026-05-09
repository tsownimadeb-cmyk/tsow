@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM 設置應用目錄
set APP_DIR=D:\inventory-management-system
set PORT=3000

REM 檢查目錄是否存在
if not exist "%APP_DIR%" (
    echo.
    echo ❌ 錯誤：應用目錄不存在
    echo 路徑：%APP_DIR%
    echo.
    pause
    exit /b 1
)

REM 清空屏幕
cls

REM 顯示啟動信息
echo.
echo ╔════════════════════════════════════════════╗
echo ║      📦 庫存管理系統                        ║
echo ║      Inventory Management System           ║
echo ╚════════════════════════════════════════════╝
echo.
echo 🔄 啟動中...
echo.

REM 進入應用目錄
cd /d "%APP_DIR%"

REM 檢查 npm
where npm >nul 2>nul
if errorlevel 1 (
    echo ❌ 錯誤：找不到 npm
    echo 請確保已安裝 Node.js
    echo 下載：https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM 啟動應用
echo ✅ 應用正在啟動...
echo.
echo 本地訪問：http://localhost:%PORT%
echo.
echo 💡 提示：不用打開 VS Code，直接用瀏覽器訪問上面的網址
echo 💡 按 Ctrl + C 可以停止應用
echo.
echo ════════════════════════════════════════════
echo.

timeout /t 2 /nobreak

REM 自動打開瀏覽器
start http://localhost:%PORT%

REM 啟動 Next.js 開發伺服器
npm run dev

pause
