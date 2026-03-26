-- 進銷貨系統資料庫結構

CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  customer_cno VARCHAR(50) REFERENCES customers(cno) ON DELETE SET NULL,
  order_date DATE DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  is_paid BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 商品分類表
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 商品表
CREATE TABLE IF NOT EXISTS products (
  pno VARCHAR(50) PRIMARY KEY,
  pname VARCHAR(200) NOT NULL,
  spec VARCHAR(100),
  unit VARCHAR(20) DEFAULT '個',
  category VARCHAR(100),
  cost DECIMAL(12, 2) DEFAULT 0,
  price DECIMAL(12, 2) DEFAULT 0,
  sale_price DECIMAL(12, 2) DEFAULT 0,
  stock_quantity INTEGER DEFAULT 0,
  min_stock_level INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 供應商表
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(100),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 進貨單表
CREATE TABLE IF NOT EXISTS purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  order_date DATE DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  is_paid BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 進貨單明細表
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_pno VARCHAR(50) REFERENCES products(pno) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 進貨退回主檔
CREATE TABLE IF NOT EXISTS purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  return_date DATE DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 進貨退回明細表
CREATE TABLE IF NOT EXISTS purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_return_id UUID REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_pno VARCHAR(50) REFERENCES products(pno) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 銷貨退回主檔
CREATE TABLE IF NOT EXISTS sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  customer_cno VARCHAR(50) REFERENCES customers(cno) ON DELETE SET NULL,
  return_date DATE DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 銷貨退回明細表
CREATE TABLE IF NOT EXISTS sales_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_return_id UUID REFERENCES sales_returns(id) ON DELETE CASCADE,
  product_pno VARCHAR(50) REFERENCES products(pno) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 銷貨單表
CREATE TABLE IF NOT EXISTS sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number VARCHAR(50) UNIQUE NOT NULL,
  customer_cno VARCHAR(50) REFERENCES customers(cno) ON DELETE SET NULL,
  order_date DATE DEFAULT CURRENT_DATE,
  total_amount DECIMAL(12, 2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  is_paid BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 銷貨單明細表
CREATE TABLE IF NOT EXISTS sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_pno VARCHAR(50) REFERENCES products(pno) ON DELETE SET NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(12, 2) NOT NULL,
  subtotal DECIMAL(12, 2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_date ON purchase_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_sales_orders_customer ON sales_orders(customer_cno);
CREATE INDEX IF NOT EXISTS idx_sales_orders_date ON sales_orders(order_date);

CREATE INDEX IF NOT EXISTS idx_sales_returns_customer ON sales_returns(customer_cno);
CREATE INDEX IF NOT EXISTS idx_sales_returns_date ON sales_returns(return_date);

-- 啟用 RLS (由於不需要登入，設定為公開存取)
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_return_items ENABLE ROW LEVEL SECURITY;

-- 公開存取政策 (因為不需要登入)
CREATE POLICY "Allow public access" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON purchase_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON sales_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON sales_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON sales_returns FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow public access" ON sales_return_items FOR ALL USING (true) WITH CHECK (true);
