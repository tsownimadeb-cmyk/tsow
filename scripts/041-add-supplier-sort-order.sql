-- 供應商排序欄位：支援跨裝置同步顯示順序
ALTER TABLE suppliers
ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- 建立排序查詢索引
CREATE INDEX IF NOT EXISTS idx_suppliers_sort_order
ON suppliers (sort_order);
