    -- 應收帳款表
    CREATE TABLE IF NOT EXISTS accounts_receivable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
    customer_cno VARCHAR(50) REFERENCES customers(cno) ON DELETE SET NULL,
    amount_due DECIMAL(12, 2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'unpaid',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- 應付帳款表
    CREATE TABLE IF NOT EXISTS accounts_payable (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    amount_due DECIMAL(12, 2) NOT NULL DEFAULT 0,
    paid_amount DECIMAL(12, 2) NOT NULL DEFAULT 0,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'unpaid',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- 建立索引
    CREATE INDEX IF NOT EXISTS idx_accounts_receivable_sales_order ON accounts_receivable(sales_order_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_receivable_customer ON accounts_receivable(customer_cno);
    CREATE INDEX IF NOT EXISTS idx_accounts_receivable_status ON accounts_receivable(status);
    CREATE INDEX IF NOT EXISTS idx_accounts_payable_purchase_order ON accounts_payable(purchase_order_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_payable_supplier ON accounts_payable(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_accounts_payable_status ON accounts_payable(status);

    -- 啟用 RLS
    ALTER TABLE accounts_receivable ENABLE ROW LEVEL SECURITY;
    ALTER TABLE accounts_payable ENABLE ROW LEVEL SECURITY;

    -- 公開存取政策
    CREATE POLICY "Allow public access" ON accounts_receivable FOR ALL USING (true) WITH CHECK (true);
    CREATE POLICY "Allow public access" ON accounts_payable FOR ALL USING (true) WITH CHECK (true);
