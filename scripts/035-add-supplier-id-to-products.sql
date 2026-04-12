-- 035-add-supplier-id-to-products.sql
-- 為商品表新增 supplier_id 欄位，並建立外鍵

ALTER TABLE products
ADD COLUMN supplier_id UUID REFERENCES suppliers(id);

-- 如需強制每個商品都要有廠商，請加上 NOT NULL
-- ALTER TABLE products ALTER COLUMN supplier_id SET NOT NULL;

-- 如需補上現有商品的 supplier_id，請自行 UPDATE products SET supplier_id = ...;