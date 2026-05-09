import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';

let db: Database.Database | null = null;

export function initLocalDb() {
  // 使用 OS 臨時目錄或應用資料目錄
  const dataDir = path.join(os.homedir(), '.inventory-system');
  const dbPath = path.join(dataDir, 'local.db');

  // 確保目錄存在
  const fs = require('fs');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  // 初始化表
  db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id TEXT PRIMARY KEY,
      purchase_order_id TEXT,
      supplier_id TEXT,
      return_date TEXT,
      total_amount REAL,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      synced BOOLEAN DEFAULT FALSE,
      sync_timestamp INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id TEXT PRIMARY KEY,
      purchase_return_id TEXT,
      product_pno TEXT,
      quantity INTEGER,
      unit_price REAL,
      amount REAL,
      reason TEXT,
      synced BOOLEAN DEFAULT FALSE,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id)
    );

    CREATE TABLE IF NOT EXISTS sales_returns (
      id TEXT PRIMARY KEY,
      sales_order_id TEXT,
      customer_id TEXT,
      return_date TEXT,
      total_amount REAL,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      synced BOOLEAN DEFAULT FALSE,
      sync_timestamp INTEGER,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sales_return_items (
      id TEXT PRIMARY KEY,
      sales_return_id TEXT,
      product_pno TEXT,
      quantity INTEGER,
      unit_price REAL,
      reason TEXT,
      synced BOOLEAN DEFAULT FALSE,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (sales_return_id) REFERENCES sales_returns(id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      pno TEXT UNIQUE,
      stock_qty INTEGER DEFAULT 0,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id TEXT,
      data TEXT NOT NULL,
      retry_count INTEGER DEFAULT 0,
      last_error TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_synced ON purchase_returns(synced);
    CREATE INDEX IF NOT EXISTS idx_sales_returns_synced ON sales_returns(synced);
  `);

  return db;
}

export function getLocalDb() {
  if (!db) initLocalDb();
  return db!;
}

export function closeLocalDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// 輔助函數：添加到同步隊列
export function addToSyncQueue(operation: string, entity: string, data: any, entityId?: string) {
  const db = getLocalDb();
  const id = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

  db.prepare(`
    INSERT INTO sync_queue (id, operation, entity, entity_id, data, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, operation, entity, entityId || null, JSON.stringify(data), Date.now(), Date.now());

  return id;
}

// 輔助函數：取得待同步隊列
export function getPendingSyncQueue() {
  const db = getLocalDb();
  return db.prepare(`
    SELECT * FROM sync_queue 
    WHERE retry_count < 3
    ORDER BY created_at ASC
    LIMIT 100
  `).all();
}

// 輔助函數：標記同步完成
export function markSyncComplete(queueId: string) {
  const db = getLocalDb();
  db.prepare('DELETE FROM sync_queue WHERE id = ?').run(queueId);
}

// 輔助函數：更新同步錯誤
export function updateSyncError(queueId: string, error: string) {
  const db = getLocalDb();
  db.prepare(`
    UPDATE sync_queue 
    SET retry_count = retry_count + 1, last_error = ?, updated_at = ?
    WHERE id = ?
  `).run(error, Date.now(), queueId);
}
