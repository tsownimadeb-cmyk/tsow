export interface Category {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface Supplier {
  id: string
  name: string
  contact_person: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Customer {
  code: string
  name: string
  cno?: string
  compy?: string
  contact_person: string | null
  tel1: string | null
  tel11: string | null
  tel12: string | null
  addr: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Product {
  code: string
  name: string
  spec: string | null
  unit: string | null
  category: string | null
  cost: number
  price: number
  sale_price: number | null
  stock_qty: number | null
  purchase_qty_total: number | null
  safety_stock: number | null
  stock_quantity?: number | null
  min_stock_level?: number | null
  created_at: string
  updated_at: string
}

export interface PurchaseOrder {
  id: string
  order_no?: string
  purno?: string
  supplier_id: string | null
  order_date: string
  total_amount: number
  status: "pending" | "completed" | "cancelled"
  is_paid: boolean | null
  notes: string | null
  created_at: string
  updated_at: string
  supplier?: Supplier
  items?: PurchaseOrderItem[]
}

export interface PurchaseOrderItem {
  id: string
  purchase_order_id?: string
  order_no?: string
  code: string | null
  quantity: number
  unit_price: number
  subtotal: number
  created_at: string
  product?: Product
}

export interface SalesOrder {
  id: string
  order_no: string
  salno?: string
  customer_cno: string | null
  customer_code?: string | null
  order_date: string
  total_amount: number
  status: "pending" | "completed" | "cancelled"
  is_paid: boolean | null
  notes: string | null
  created_at: string
  updated_at: string
  customer?: Customer
  sales_order_items?: SalesOrderItem[]
  items?: SalesOrderItem[]
}

export interface SalesOrderItem {
  id: string
  sales_order_id: string
  code: string | null
  quantity: number
  unit_price: number
  subtotal: number
  created_at: string
  product?: Product
}

export interface AccountsReceivable {
  id: string
  sales_order_id: string | null
  customer_cno?: string | null
  amount_due: number
  total_amount?: number | null
  paid_amount: number
  due_date: string | null
  status: "unpaid" | "partially_paid" | "paid"
  notes: string | null
  created_at: string
  updated_at: string
  sales_order?: SalesOrder
  customer?: Customer
}

export interface AccountsPayable {
  id: string
  purchase_order_id: string | null
  supplier_id: string | null
  amount_due: number
  total_amount?: number | null
  paid_amount: number
  due_date: string | null
  status: "unpaid" | "partially_paid" | "paid"
  notes: string | null
  created_at: string
  updated_at: string
  purchase_order?: PurchaseOrder
  supplier?: Supplier
}

export interface DashboardStats {
  totalProducts: number
  totalSuppliers: number
  totalCustomers: number
  lowStockProducts: number
  monthlyPurchases: number
  monthlySales: number
  recentPurchases: PurchaseOrder[]
  recentSales: SalesOrder[]
}
