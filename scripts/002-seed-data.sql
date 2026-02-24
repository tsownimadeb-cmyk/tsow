-- 新增初始測試資料

-- 商品分類
INSERT INTO categories (name, description) VALUES
  ('電子產品', '各類電子設備與配件'),
  ('辦公用品', '文具、紙張等辦公耗材'),
  ('生活用品', '日常生活所需用品')
ON CONFLICT DO NOTHING;

-- 供應商
INSERT INTO suppliers (name, contact_person, phone, email, address) VALUES
  ('科技供應有限公司', '王經理', '02-1234-5678', 'wang@techsupply.com', '台北市信義區信義路100號'),
  ('文具批發商', '李小姐', '02-2345-6789', 'lee@stationery.com', '台北市中山區中山北路200號'),
  ('生活百貨批發', '張先生', '02-3456-7890', 'chang@lifestyle.com', '新北市板橋區文化路300號')
ON CONFLICT DO NOTHING;

-- 客戶
INSERT INTO customers (cno, compy, contact_person, tel1, tel11, tel12, addr) VALUES
  ('C001', 'ABC科技公司', '陳主任', '02-1111-2222', '0912-345-678', NULL, '台北市大安區敦化南路50號'),
  ('C002', '大學書城', '林店長', '02-2222-3333', '0912-345-679', NULL, '台北市中正區羅斯福路100號'),
  ('C003', '便利超商', '黃經理', '02-3333-4444', '0912-345-680', NULL, '新北市新店區北新路200號')
ON CONFLICT DO NOTHING;

-- 商品
INSERT INTO products (pno, pname, spec, unit, category, cost, price) VALUES
  ('P001', '電子滑鼠', 'USB', '支', '電子產品', 50.00, 150.00),
  ('P002', 'USB鍵盤', '機械', '支', '電子產品', 100.00, 350.00),
  ('P003', 'A4紙張', '500張', '令', '辦公用品', 25.00, 75.00),
  ('P004', '原子筆', '藍色', '支', '辦公用品', 2.00, 8.00),
  ('P005', '手提袋', '黑色', '個', '生活用品', 10.00, 35.00),
  ('P006', '防塵布', '棉質', '個', '生活用品', 15.00, 45.00)
ON CONFLICT DO NOTHING;
