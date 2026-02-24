import { createClient } from "@/lib/supabase/server"

export default async function DiagnosticsPage() {
  const supabase = await createClient()

  let categoriesTest = { success: false, count: 0, error: null as string | null }
  let suppliersTest = { success: false, count: 0, error: null as string | null }
  let customersTest = { success: false, count: 0, error: null as string | null }
  let productsTest = { success: false, count: 0, error: null as string | null }

  // 測試 categories 表
  try {
    const { data, error } = await supabase.from("categories").select("*").limit(1)
    if (error) {
      categoriesTest.error = error.message
    } else {
      categoriesTest.success = true
      categoriesTest.count = data?.length || 0
    }
  } catch (err) {
    categoriesTest.error = err instanceof Error ? err.message : "未知錯誤"
  }

  // 測試 suppliers 表
  try {
    const { data, error } = await supabase.from("suppliers").select("*").limit(1)
    if (error) {
      suppliersTest.error = error.message
    } else {
      suppliersTest.success = true
      suppliersTest.count = data?.length || 0
    }
  } catch (err) {
    suppliersTest.error = err instanceof Error ? err.message : "未知錯誤"
  }

  // 測試 customers 表
  try {
    const { data, error } = await supabase.from("customers").select("*").limit(1)
    if (error) {
      customersTest.error = error.message
    } else {
      customersTest.success = true
      customersTest.count = data?.length || 0
    }
  } catch (err) {
    customersTest.error = err instanceof Error ? err.message : "未知錯誤"
  }

  // 測試 products 表
  try {
    const { data, error } = await supabase.from("products").select("*").limit(1)
    if (error) {
      productsTest.error = error.message
    } else {
      productsTest.success = true
      productsTest.count = data?.length || 0
    }
  } catch (err) {
    productsTest.error = err instanceof Error ? err.message : "未知錯誤"
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">資料庫診斷</h1>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded border">
          <h2 className="font-semibold mb-2">Categories 表</h2>
          <p className={categoriesTest.success ? "text-green-600" : "text-red-600"}>
            {categoriesTest.success ? `✓ 成功 (${categoriesTest.count} 筆)` : `✗ 失敗`}
          </p>
          {categoriesTest.error && <p className="text-sm text-red-600 mt-1">{categoriesTest.error}</p>}
        </div>

        <div className="p-4 rounded border">
          <h2 className="font-semibold mb-2">Suppliers 表</h2>
          <p className={suppliersTest.success ? "text-green-600" : "text-red-600"}>
            {suppliersTest.success ? `✓ 成功 (${suppliersTest.count} 筆)` : `✗ 失敗`}
          </p>
          {suppliersTest.error && <p className="text-sm text-red-600 mt-1">{suppliersTest.error}</p>}
        </div>

        <div className="p-4 rounded border">
          <h2 className="font-semibold mb-2">Customers 表</h2>
          <p className={customersTest.success ? "text-green-600" : "text-red-600"}>
            {customersTest.success ? `✓ 成功 (${customersTest.count} 筆)` : `✗ 失敗`}
          </p>
          {customersTest.error && <p className="text-sm text-red-600 mt-1">{customersTest.error}</p>}
        </div>

        <div className="p-4 rounded border">
          <h2 className="font-semibold mb-2">Products 表</h2>
          <p className={productsTest.success ? "text-green-600" : "text-red-600"}>
            {productsTest.success ? `✓ 成功 (${productsTest.count} 筆)` : `✗ 失敗`}
          </p>
          {productsTest.error && <p className="text-sm text-red-600 mt-1">{productsTest.error}</p>}
        </div>
      </div>

      <div className="p-4 rounded border bg-yellow-50">
        <h3 className="font-semibold mb-2">如果表格不存在：</h3>
        <p className="text-sm">1. 開啟 Supabase 控制台</p>
        <p className="text-sm">2. 進入 SQL Editor</p>
        <p className="text-sm">3. 複製並執行 <code className="bg-white px-1">scripts/001-create-tables.sql</code> 的所有內容</p>
        <p className="text-sm">4. 然後執行 <code className="bg-white px-1">scripts/002-seed-data.sql</code></p>
        <p className="text-sm">5. 重新整理此頁面以查看結果</p>
      </div>
    </div>
  )
}
