import type { Customer, Product, SalesOrder } from "./types"

// Apply both search fields before paginating cached orders, just as the online query does.
export function filterSalesOrders<T extends SalesOrder>(
  sales: T[],
  customers: Pick<Customer, "code" | "name">[],
  products: Pick<Product, "code" | "name">[],
  searchText = "",
  productSearchText = "",
): T[] {
  const keyword = searchText.trim().toLowerCase()
  const productKeyword = productSearchText.trim().toLowerCase()
  const customerNames = new Map(customers.map((customer) => [customer.code, customer.name]))
  const productNames = new Map(products.map((product) => [String(product.code).trim(), product.name]))
  const includes = (value: unknown, term: string) => String(value ?? "").toLowerCase().includes(term)

  return sales.filter((sale) => {
    if (keyword && ![
      sale.order_no,
      sale.customer_cno,
      sale.notes,
      customerNames.get(sale.customer_cno || ""),
    ].some((value) => includes(value, keyword))) return false

    if (!productKeyword) return true
    return (sale.items ?? sale.sales_order_items ?? []).some((item) => {
      const code = String(item.code ?? item.product_pno ?? "").trim()
      return includes(code, productKeyword) || includes(productNames.get(code) ?? item.product?.name, productKeyword)
    })
  })
}
