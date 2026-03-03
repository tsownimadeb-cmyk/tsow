import { NextRequest, NextResponse } from "next/server"
import JSZip from "jszip"
import Papa from "papaparse"
import { createClient } from "@/lib/supabase/server"
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/site-auth"

export const runtime = "nodejs"

type ImportPayload = {
  tables?: {
    categories?: Record<string, unknown>[]
    suppliers?: Record<string, unknown>[]
    sales_orders?: Record<string, unknown>[]
    sales_order_items?: Record<string, unknown>[]
    purchase_orders?: Record<string, unknown>[]
    purchase_order_items?: Record<string, unknown>[]
    accounts_receivable?: Record<string, unknown>[]
    accounts_payable?: Record<string, unknown>[]
    customers?: Record<string, unknown>[]
    products?: Record<string, unknown>[]
  }
}

type SourceTables = {
  categories: Record<string, unknown>[]
  suppliers: Record<string, unknown>[]
  sales_orders: Record<string, unknown>[]
  sales_order_items: Record<string, unknown>[]
  purchase_orders: Record<string, unknown>[]
  purchase_order_items: Record<string, unknown>[]
  accounts_receivable: Record<string, unknown>[]
  accounts_payable: Record<string, unknown>[]
  customers: Record<string, unknown>[]
  products: Record<string, unknown>[]
}

const getUnknownColumnFromError = (message: string) => {
  const patterns = [
    /Could not find the '([^']+)' column/i,
    /column\s+([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\s+does not exist/i,
    /column\s+"([^"]+)"\s+does not exist/i,
    /column\s+([a-zA-Z0-9_]+)\s+does not exist/i,
  ]

  for (const pattern of patterns) {
    const matched = message.match(pattern)
    if (!matched) continue

    if (matched[2]) {
      return matched[2]
    }

    if (matched[1]) {
      const token = matched[1]
      const pieces = token.split(".")
      return pieces[pieces.length - 1] || token
    }
  }

  return null
}

const omitColumn = <T extends Record<string, unknown>>(rows: T[], column: string): T[] =>
  rows.map((row) => {
    const next = { ...row }
    delete next[column]
    return next
  })

async function resilientUpsert(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  initialRows: Record<string, unknown>[],
  onConflict: string,
) {
  let rows = [...initialRows]

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (rows.length === 0) {
      return { success: true as const, rows }
    }

    const { error } = await supabase.from(table).upsert(rows, { onConflict })
    if (!error) {
      return { success: true as const, rows }
    }

    const unknownColumn = getUnknownColumnFromError(error.message || "")
    if (!unknownColumn) {
      return { success: false as const, error: error.message || `${table} upsert 失敗` }
    }

    rows = omitColumn(rows, unknownColumn)
  }

  return { success: false as const, error: `${table} upsert 失敗：欄位相容重試次數超過上限` }
}

async function resilientInsert(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  initialRows: Record<string, unknown>[],
) {
  let rows = [...initialRows]

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (rows.length === 0) {
      return { success: true as const, rows }
    }

    const { error } = await supabase.from(table).insert(rows)
    if (!error) {
      return { success: true as const, rows }
    }

    const unknownColumn = getUnknownColumnFromError(error.message || "")
    if (!unknownColumn) {
      return { success: false as const, error: error.message || `${table} insert 失敗` }
    }

    rows = omitColumn(rows, unknownColumn)
  }

  return { success: false as const, error: `${table} insert 失敗：欄位相容重試次數超過上限` }
}

const asNumber = (value: unknown, defaultValue: number = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : defaultValue
}

const asNullableString = (value: unknown) => {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text.length ? text : null
}

const parseCsv = (text: string) => {
  const parsed = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message || "CSV 解析失敗")
  }

  return (parsed.data || []) as Record<string, unknown>[]
}

const pickZipEntry = (zip: JSZip, targetName: string) => {
  const normalizedTarget = targetName.toLowerCase()
  const matchedKey = Object.keys(zip.files).find((name) => {
    const normalized = name.replace(/\\/g, "/").toLowerCase()
    return normalized === normalizedTarget || normalized.endsWith(`/${normalizedTarget}`)
  })
  return matchedKey ? zip.files[matchedKey] : null
}

async function parseSourceTablesFromFile(file: File): Promise<SourceTables> {
  const normalizedName = String(file.name || "").toLowerCase()

  if (normalizedName.endsWith(".zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const readCsvEntry = async (name: string) => {
      const entry = pickZipEntry(zip, name)
      if (!entry) return [] as Record<string, unknown>[]
      return parseCsv(await entry.async("text"))
    }

    return {
      categories: await readCsvEntry("categories.csv"),
      suppliers: await readCsvEntry("suppliers.csv"),
      customers: await readCsvEntry("customers.csv"),
      products: await readCsvEntry("products.csv"),
      purchase_orders: await readCsvEntry("purchase_orders.csv"),
      purchase_order_items: await readCsvEntry("purchase_order_items.csv"),
      sales_orders: await readCsvEntry("sales_orders.csv"),
      sales_order_items: await readCsvEntry("sales_order_items.csv"),
      accounts_receivable: await readCsvEntry("accounts_receivable.csv"),
      accounts_payable: await readCsvEntry("accounts_payable.csv"),
    }
  }

  if (!normalizedName.endsWith(".json")) {
    throw new Error("僅支援 JSON 或 ZIP 檔案")
  }

  const text = await file.text()
  let payload: ImportPayload
  try {
    payload = JSON.parse(text) as ImportPayload
  } catch {
    throw new Error("JSON 格式錯誤")
  }

  const tables = payload.tables || {}
  return {
    categories: Array.isArray(tables.categories) ? tables.categories : [],
    suppliers: Array.isArray(tables.suppliers) ? tables.suppliers : [],
    sales_orders: Array.isArray(tables.sales_orders) ? tables.sales_orders : [],
    sales_order_items: Array.isArray(tables.sales_order_items) ? tables.sales_order_items : [],
    purchase_orders: Array.isArray(tables.purchase_orders) ? tables.purchase_orders : [],
    purchase_order_items: Array.isArray(tables.purchase_order_items) ? tables.purchase_order_items : [],
    accounts_receivable: Array.isArray(tables.accounts_receivable) ? tables.accounts_receivable : [],
    accounts_payable: Array.isArray(tables.accounts_payable) ? tables.accounts_payable : [],
    customers: Array.isArray(tables.customers) ? tables.customers : [],
    products: Array.isArray(tables.products) ? tables.products : [],
  }
}

const toSummary = (summary: Record<string, number>) => summary

async function deleteByKnownColumns(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  candidates: Array<{ column: string; values: string[] }>,
) {
  for (const candidate of candidates) {
    const values = candidate.values.filter(Boolean)
    if (values.length === 0) continue

    const result = await supabase.from(table).delete().in(candidate.column, values)
    if (!result.error) {
      return { success: true as const }
    }

    const unknownColumn = getUnknownColumnFromError(result.error.message || "")
    if (unknownColumn && unknownColumn.toLowerCase() === candidate.column.toLowerCase()) {
      continue
    }

    return { success: false as const, error: result.error.message || `刪除 ${table} 失敗` }
  }

  return { success: true as const }
}

export async function POST(request: NextRequest) {
  try {
    const cookieValue = request.cookies.get(AUTH_COOKIE_NAME)?.value
    const isAuthenticated = await verifyAuthToken(cookieValue)

    if (!isAuthenticated) {
      return NextResponse.json({ success: false, message: "未授權" }, { status: 401 })
    }

    const formData = await request.formData()
    const previewOnly = String(formData.get("preview") || "") === "1"
    const file = formData.get("file")
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, message: "請上傳 JSON 或 ZIP 檔案" }, { status: 400 })
    }

    let sourceTables: SourceTables
    try {
      sourceTables = await parseSourceTablesFromFile(file)
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : "檔案解析失敗"
      return NextResponse.json({ success: false, message }, { status: 400 })
    }

    const sourceCategories = sourceTables.categories
    const sourceSuppliers = sourceTables.suppliers
    const sourceCustomers = sourceTables.customers
    const sourceProducts = sourceTables.products
    const sourcePurchaseOrders = sourceTables.purchase_orders
    const sourcePurchaseItems = sourceTables.purchase_order_items
    const sourceSalesOrders = sourceTables.sales_orders
    const sourceSalesItems = sourceTables.sales_order_items
    const sourceAccountsReceivable = sourceTables.accounts_receivable
    const sourceAccountsPayable = sourceTables.accounts_payable

    const categories = sourceCategories
      .map((row) => ({
        id: asNullableString(row.id),
        name: asNullableString(row.name),
        description: asNullableString(row.description),
      }))
      .filter((row) => row.id && row.name)
      .map((row) => ({
        id: row.id!,
        name: row.name!,
        description: row.description,
      }))

    const suppliers = sourceSuppliers
      .map((row) => ({
        id: asNullableString(row.id),
        name: asNullableString(row.name),
        contact_person: asNullableString(row.contact_person),
        phone: asNullableString(row.phone),
        email: asNullableString(row.email),
        address: asNullableString(row.address),
        notes: asNullableString(row.notes),
      }))
      .filter((row) => row.id && row.name)
      .map((row) => ({
        id: row.id!,
        name: row.name!,
        contact_person: row.contact_person,
        phone: row.phone,
        email: row.email,
        address: row.address,
        notes: row.notes,
      }))

    const customers = sourceCustomers
      .map((row) => ({
        code: asNullableString(row.code),
        cno: asNullableString(row.cno),
        name: asNullableString(row.name),
        contact_person: asNullableString(row.contact_person),
        tel1: asNullableString(row.tel1),
        tel11: asNullableString(row.tel11),
        tel12: asNullableString(row.tel12),
        addr: asNullableString(row.addr),
        notes: asNullableString(row.notes),
      }))
      .filter((row) => row.code)
      .map((row) => ({
        code: row.code!,
        cno: row.cno,
        name: row.name || "",
        contact_person: row.contact_person,
        tel1: row.tel1,
        tel11: row.tel11,
        tel12: row.tel12,
        addr: row.addr,
        notes: row.notes,
      }))

    const products = sourceProducts
      .map((row) => ({
        code: asNullableString(row.code),
        pno: asNullableString(row.pno),
        name: asNullableString(row.name),
        spec: asNullableString(row.spec),
        unit: asNullableString(row.unit),
        category: asNullableString(row.category),
        base_price: asNumber(row.base_price, 0),
        purchase_price: asNumber(row.purchase_price, 0),
        cost: asNumber(row.cost, 0),
        price: asNumber(row.price, 0),
        sale_price: row.sale_price === null || row.sale_price === undefined ? null : asNumber(row.sale_price, 0),
        stock_qty: asNumber(row.stock_qty, 0),
        purchase_qty_total: asNumber(row.purchase_qty_total, 0),
        safety_stock: asNumber(row.safety_stock, 0),
      }))
      .filter((row) => row.code)
      .map((row) => ({
        code: row.code!,
        pno: row.pno,
        name: row.name || "",
        spec: row.spec,
        unit: row.unit,
        category: row.category,
        base_price: row.base_price,
        purchase_price: row.purchase_price,
        cost: row.cost,
        price: row.price,
        sale_price: row.sale_price,
        stock_qty: row.stock_qty,
        purchase_qty_total: row.purchase_qty_total,
        safety_stock: row.safety_stock,
      }))

    const salesOrders = sourceSalesOrders
      .map((row) => ({
        id: asNullableString(row.id),
        order_no: asNullableString(row.order_no),
        customer_cno: asNullableString(row.customer_cno),
        delivery_method: asNullableString(row.delivery_method),
        order_date: asNullableString(row.order_date),
        total_amount: asNumber(row.total_amount, 0),
        status: asNullableString(row.status) || "pending",
        is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
        notes: asNullableString(row.notes),
      }))
      .filter((row) => row.order_no)

    const purchaseOrders = sourcePurchaseOrders
      .map((row) => ({
        id: asNullableString(row.id),
        order_no: asNullableString(row.order_no),
        supplier_id: asNullableString(row.supplier_id),
        order_date: asNullableString(row.order_date),
        total_amount: asNumber(row.total_amount, 0),
        shipping_fee: row.shipping_fee === null || row.shipping_fee === undefined ? null : asNumber(row.shipping_fee, 0),
        status: asNullableString(row.status) || "pending",
        is_paid: row.is_paid === null || row.is_paid === undefined ? null : Boolean(row.is_paid),
        notes: asNullableString(row.notes),
      }))
      .filter((row) => row.order_no)

    const purchaseOrderNoByOldId = new Map<string, string>()
    for (const order of purchaseOrders) {
      if (order.id && order.order_no) {
        purchaseOrderNoByOldId.set(order.id, order.order_no)
      }
    }

    const orderNoByOldId = new Map<string, string>()
    for (const order of salesOrders) {
      if (order.id && order.order_no) {
        orderNoByOldId.set(order.id, order.order_no)
      }
    }

    const salesItemsRaw = sourceSalesItems
      .map((row) => {
        const orderNoFromRow = asNullableString(row.order_no)
        const oldSalesOrderId = asNullableString(row.sales_order_id)
        const resolvedOrderNo = orderNoFromRow || (oldSalesOrderId ? orderNoByOldId.get(oldSalesOrderId) || null : null)

        return {
          order_no: resolvedOrderNo,
          code: asNullableString(row.code),
          quantity: asNumber(row.quantity, 0),
          unit_price: asNumber(row.unit_price, 0),
          subtotal: asNumber(row.subtotal, 0),
        }
      })
      .filter((row) => row.order_no && row.code)

    const purchaseItemsRaw = sourcePurchaseItems
      .map((row) => {
        const orderNoFromRow = asNullableString(row.order_no)
        const oldPurchaseOrderId = asNullableString(row.purchase_order_id)
        const resolvedOrderNo = orderNoFromRow || (oldPurchaseOrderId ? purchaseOrderNoByOldId.get(oldPurchaseOrderId) || null : null)

        return {
          order_no: resolvedOrderNo,
          code: asNullableString(row.code),
          quantity: asNumber(row.quantity, 0),
          unit_price: asNumber(row.unit_price, 0),
          subtotal: asNumber(row.subtotal, 0),
        }
      })
      .filter((row) => row.order_no && row.code)

    const salesOrderNoByOldId = new Map<string, string>()
    for (const order of salesOrders) {
      if (order.id && order.order_no) {
        salesOrderNoByOldId.set(order.id, order.order_no)
      }
    }

    const accountsReceivableRaw = sourceAccountsReceivable.map((row) => {
      const oldSalesOrderId = asNullableString(row.sales_order_id)
      const orderNo = asNullableString(row.order_no) || (oldSalesOrderId ? salesOrderNoByOldId.get(oldSalesOrderId) || null : null)
      const amountDue = asNumber(row.amount_due, 0)
      const paidAmount = asNumber(row.paid_amount, 0)
      const totalAmountRaw = row.total_amount === null || row.total_amount === undefined ? null : asNumber(row.total_amount, 0)
      const totalAmount = totalAmountRaw === null ? Math.max(amountDue, paidAmount) : Math.max(totalAmountRaw, amountDue, paidAmount)
      return {
        order_no: orderNo,
        customer_cno: asNullableString(row.customer_cno),
        amount_due: amountDue,
        total_amount: totalAmount,
        paid_amount: Math.min(Math.max(paidAmount, 0), totalAmount),
        overpaid_amount: row.overpaid_amount === null || row.overpaid_amount === undefined ? 0 : asNumber(row.overpaid_amount, 0),
        paid_at: asNullableString(row.paid_at),
        due_date: asNullableString(row.due_date),
        status: asNullableString(row.status) || "unpaid",
        notes: asNullableString(row.notes),
      }
    })

    const accountsPayableRaw = sourceAccountsPayable.map((row) => {
      const oldPurchaseOrderId = asNullableString(row.purchase_order_id)
      const orderNo = asNullableString(row.order_no) || (oldPurchaseOrderId ? purchaseOrderNoByOldId.get(oldPurchaseOrderId) || null : null)
      const amountDue = asNumber(row.amount_due, 0)
      const paidAmount = asNumber(row.paid_amount, 0)
      const totalAmountRaw = row.total_amount === null || row.total_amount === undefined ? null : asNumber(row.total_amount, 0)
      const totalAmount = totalAmountRaw === null ? Math.max(amountDue, paidAmount) : Math.max(totalAmountRaw, amountDue, paidAmount)
      return {
        order_no: orderNo,
        supplier_id: asNullableString(row.supplier_id),
        amount_due: amountDue,
        total_amount: totalAmount,
        paid_amount: Math.min(Math.max(paidAmount, 0), totalAmount),
        paid_at: asNullableString(row.paid_at),
        due_date: asNullableString(row.due_date),
        status: asNullableString(row.status) || "unpaid",
        notes: asNullableString(row.notes),
      }
    })

    if (previewOnly) {
      const summary = toSummary({
        categories: categories.length,
        suppliers: suppliers.length,
        customers: customers.length,
        products: products.length,
        purchase_orders: purchaseOrders.length,
        purchase_order_items: purchaseItemsRaw.length,
        sales_orders: salesOrders.length,
        sales_order_items: salesItemsRaw.length,
        accounts_receivable: accountsReceivableRaw.length,
        accounts_payable: accountsPayableRaw.length,
      })

      return NextResponse.json({
        success: true,
        preview: true,
        summary,
        message: "預檢完成",
      })
    }

    const supabase = await createClient()

    if (categories.length > 0) {
      const categoriesResult = await resilientUpsert(supabase, "categories", categories as Record<string, unknown>[], "id")
      if (!categoriesResult.success) {
        return NextResponse.json({ success: false, message: `匯入 categories 失敗: ${categoriesResult.error}` }, { status: 500 })
      }
    }

    if (suppliers.length > 0) {
      const suppliersResult = await resilientUpsert(supabase, "suppliers", suppliers as Record<string, unknown>[], "id")
      if (!suppliersResult.success) {
        return NextResponse.json({ success: false, message: `匯入 suppliers 失敗: ${suppliersResult.error}` }, { status: 500 })
      }
    }

    if (customers.length > 0) {
      const customerResult = await resilientUpsert(supabase, "customers", customers as Record<string, unknown>[], "code")
      if (!customerResult.success) {
        return NextResponse.json({ success: false, message: `匯入 customers 失敗: ${customerResult.error}` }, { status: 500 })
      }
    }

    if (products.length > 0) {
      const productResult = await resilientUpsert(supabase, "products", products as Record<string, unknown>[], "code")
      if (!productResult.success) {
        return NextResponse.json({ success: false, message: `匯入 products 失敗: ${productResult.error}` }, { status: 500 })
      }
    }

    if (salesOrders.length > 0) {
      const orderPayloads = salesOrders.map((row) => ({
        order_no: row.order_no!,
        customer_cno: row.customer_cno,
        delivery_method: row.delivery_method,
        order_date: row.order_date,
        total_amount: row.total_amount,
        status: row.status,
        is_paid: row.is_paid,
        notes: row.notes,
      }))

      const salesOrderResult = await resilientUpsert(
        supabase,
        "sales_orders",
        orderPayloads as Record<string, unknown>[],
        "order_no",
      )
      if (!salesOrderResult.success) {
        return NextResponse.json({ success: false, message: `匯入 sales_orders 失敗: ${salesOrderResult.error}` }, { status: 500 })
      }

      const orderNos = Array.from(new Set(salesOrders.map((row) => row.order_no!).filter(Boolean)))

      const { data: latestOrders, error: latestOrdersError } = await supabase
        .from("sales_orders")
        .select("id,order_no")
        .in("order_no", orderNos)

      if (latestOrdersError) {
        return NextResponse.json({ success: false, message: `查詢匯入後 sales_orders 失敗: ${latestOrdersError.message}` }, { status: 500 })
      }

      const orderIdByNo = new Map((latestOrders || []).map((row) => [String(row.order_no || ""), String(row.id || "")]))

      const targetItems = salesItemsRaw
        .filter((item) => item.order_no && orderIdByNo.has(item.order_no))
        .map((item) => ({
          sales_order_id: orderIdByNo.get(item.order_no!) || null,
          order_no: item.order_no,
          code: item.code,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
        }))

      const deleteByOrderNo = await supabase.from("sales_order_items").delete().in("order_no", orderNos)
      if (deleteByOrderNo.error) {
        const orderIds = Array.from(orderIdByNo.values()).filter(Boolean)
        const unknownColumn = getUnknownColumnFromError(deleteByOrderNo.error.message || "")

        if (orderIds.length > 0 && (unknownColumn?.toLowerCase() === "order_no" || /order_no/i.test(deleteByOrderNo.error.message || ""))) {
          const deleteBySalesOrderId = await supabase.from("sales_order_items").delete().in("sales_order_id", orderIds)
          if (!deleteBySalesOrderId.error) {
            // fallback success
          } else {
            return NextResponse.json({ success: false, message: `清除舊 sales_order_items 失敗: ${deleteBySalesOrderId.error.message}` }, { status: 500 })
          }
        } else {
          return NextResponse.json({ success: false, message: `清除舊 sales_order_items 失敗: ${deleteByOrderNo.error.message}` }, { status: 500 })
        }
      }

      if (targetItems.length > 0) {
        const salesItemResult = await resilientInsert(
          supabase,
          "sales_order_items",
          targetItems as Record<string, unknown>[],
        )
        if (!salesItemResult.success) {
          return NextResponse.json({ success: false, message: `匯入 sales_order_items 失敗: ${salesItemResult.error}` }, { status: 500 })
        }
      }
    }

    let purchaseIdByNo = new Map<string, string>()

    if (purchaseOrders.length > 0) {
      const purchaseOrderPayloads = purchaseOrders.map((row) => ({
        order_no: row.order_no!,
        supplier_id: row.supplier_id,
        order_date: row.order_date,
        total_amount: row.total_amount,
        shipping_fee: row.shipping_fee,
        status: row.status,
        is_paid: row.is_paid,
        notes: row.notes,
      }))

      const purchaseOrderResult = await resilientUpsert(
        supabase,
        "purchase_orders",
        purchaseOrderPayloads as Record<string, unknown>[],
        "order_no",
      )
      if (!purchaseOrderResult.success) {
        return NextResponse.json({ success: false, message: `匯入 purchase_orders 失敗: ${purchaseOrderResult.error}` }, { status: 500 })
      }

      const purchaseOrderNos = Array.from(new Set(purchaseOrders.map((row) => row.order_no!).filter(Boolean)))
      const { data: latestPurchaseOrders, error: latestPurchaseOrdersError } = await supabase
        .from("purchase_orders")
        .select("id,order_no")
        .in("order_no", purchaseOrderNos)

      if (latestPurchaseOrdersError) {
        return NextResponse.json({ success: false, message: `查詢匯入後 purchase_orders 失敗: ${latestPurchaseOrdersError.message}` }, { status: 500 })
      }

      purchaseIdByNo = new Map((latestPurchaseOrders || []).map((row) => [String(row.order_no || ""), String(row.id || "")]))

      const purchaseDeleteResult = await deleteByKnownColumns(supabase, "purchase_order_items", [
        { column: "order_no", values: purchaseOrderNos },
        { column: "purchase_order_id", values: Array.from(purchaseIdByNo.values()) },
      ])
      if (!purchaseDeleteResult.success) {
        return NextResponse.json({ success: false, message: `清除舊 purchase_order_items 失敗: ${purchaseDeleteResult.error}` }, { status: 500 })
      }

      const purchaseTargetItems = purchaseItemsRaw
        .filter((item) => item.order_no && purchaseIdByNo.has(item.order_no))
        .map((item) => ({
          purchase_order_id: purchaseIdByNo.get(item.order_no!) || null,
          order_no: item.order_no,
          code: item.code,
          quantity: item.quantity,
          unit_price: item.unit_price,
          subtotal: item.subtotal,
        }))

      if (purchaseTargetItems.length > 0) {
        const purchaseItemResult = await resilientInsert(
          supabase,
          "purchase_order_items",
          purchaseTargetItems as Record<string, unknown>[],
        )
        if (!purchaseItemResult.success) {
          return NextResponse.json({ success: false, message: `匯入 purchase_order_items 失敗: ${purchaseItemResult.error}` }, { status: 500 })
        }
      }
    }

    if (accountsReceivableRaw.length > 0 || accountsPayableRaw.length > 0) {
      const salesOrderNos = Array.from(new Set(salesOrders.map((row) => row.order_no!).filter(Boolean)))
      const purchaseOrderNos = Array.from(new Set(purchaseOrders.map((row) => row.order_no!).filter(Boolean)))

      const [latestSalesOrdersResult, latestPurchaseOrdersResult] = await Promise.all([
        salesOrderNos.length
          ? supabase.from("sales_orders").select("id,order_no,customer_cno,total_amount").in("order_no", salesOrderNos)
          : Promise.resolve({ data: [], error: null as any }),
        purchaseOrderNos.length
          ? supabase.from("purchase_orders").select("id,order_no,supplier_id,total_amount").in("order_no", purchaseOrderNos)
          : Promise.resolve({ data: [], error: null as any }),
      ])

      if (latestSalesOrdersResult.error) {
        return NextResponse.json({ success: false, message: `查詢匯入後 sales_orders 失敗: ${latestSalesOrdersResult.error.message}` }, { status: 500 })
      }
      if (latestPurchaseOrdersResult.error) {
        return NextResponse.json({ success: false, message: `查詢匯入後 purchase_orders 失敗: ${latestPurchaseOrdersResult.error.message}` }, { status: 500 })
      }

      const salesRowByNo = new Map((latestSalesOrdersResult.data || []).map((row) => [String(row.order_no || ""), row]))
      const purchaseRowByNo = new Map((latestPurchaseOrdersResult.data || []).map((row) => [String(row.order_no || ""), row]))

      const receivableRows = accountsReceivableRaw
        .filter((row) => row.order_no && salesRowByNo.has(row.order_no))
        .map((row) => {
          const order = salesRowByNo.get(row.order_no!)
          const orderTotal = asNumber(order?.total_amount, row.total_amount)
          const totalAmount = Math.max(asNumber(row.total_amount, orderTotal), orderTotal)
          const amountDue = Math.max(asNumber(row.amount_due, totalAmount), 0)
          const paidAmount = Math.min(Math.max(asNumber(row.paid_amount, 0), 0), totalAmount)
          return {
            sales_order_id: String(order?.id || ""),
            customer_cno: row.customer_cno || asNullableString(order?.customer_cno),
            amount_due: amountDue,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            overpaid_amount: row.overpaid_amount,
            paid_at: row.paid_at,
            due_date: row.due_date,
            status: row.status,
            notes: row.notes,
          }
        })
        .filter((row) => row.sales_order_id)

      const payableRows = accountsPayableRaw
        .filter((row) => row.order_no && purchaseRowByNo.has(row.order_no))
        .map((row) => {
          const order = purchaseRowByNo.get(row.order_no!)
          const orderTotal = asNumber(order?.total_amount, row.total_amount)
          const totalAmount = Math.max(asNumber(row.total_amount, orderTotal), orderTotal)
          const amountDue = Math.max(asNumber(row.amount_due, totalAmount), 0)
          const paidAmount = Math.min(Math.max(asNumber(row.paid_amount, 0), 0), totalAmount)
          return {
            purchase_order_id: String(order?.id || ""),
            supplier_id: row.supplier_id || asNullableString(order?.supplier_id),
            amount_due: amountDue,
            total_amount: totalAmount,
            paid_amount: paidAmount,
            paid_at: row.paid_at,
            due_date: row.due_date,
            status: row.status,
            notes: row.notes,
          }
        })
        .filter((row) => row.purchase_order_id)

      if (receivableRows.length > 0) {
        const receivableDelete = await deleteByKnownColumns(supabase, "accounts_receivable", [
          { column: "sales_order_id", values: receivableRows.map((row) => row.sales_order_id) },
        ])
        if (!receivableDelete.success) {
          return NextResponse.json({ success: false, message: `清除舊 accounts_receivable 失敗: ${receivableDelete.error}` }, { status: 500 })
        }

        const receivableInsert = await resilientInsert(supabase, "accounts_receivable", receivableRows as Record<string, unknown>[])
        if (!receivableInsert.success) {
          return NextResponse.json({ success: false, message: `匯入 accounts_receivable 失敗: ${receivableInsert.error}` }, { status: 500 })
        }
      }

      if (payableRows.length > 0) {
        const payableDelete = await deleteByKnownColumns(supabase, "accounts_payable", [
          { column: "purchase_order_id", values: payableRows.map((row) => row.purchase_order_id) },
        ])
        if (!payableDelete.success) {
          return NextResponse.json({ success: false, message: `清除舊 accounts_payable 失敗: ${payableDelete.error}` }, { status: 500 })
        }

        const payableInsert = await resilientInsert(supabase, "accounts_payable", payableRows as Record<string, unknown>[])
        if (!payableInsert.success) {
          return NextResponse.json({ success: false, message: `匯入 accounts_payable 失敗: ${payableInsert.error}` }, { status: 500 })
        }
      }
    }

    return NextResponse.json({
      success: true,
      summary: toSummary({
        categories: categories.length,
        suppliers: suppliers.length,
        customers: customers.length,
        products: products.length,
        purchase_orders: purchaseOrders.length,
        purchase_order_items: purchaseItemsRaw.length,
        sales_orders: salesOrders.length,
        sales_order_items: salesItemsRaw.length,
        accounts_receivable: accountsReceivableRaw.length,
        accounts_payable: accountsPayableRaw.length,
      }),
      message: "匯入完成",
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "匯入失敗"
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
