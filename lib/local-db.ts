import path from 'path';
import os from 'os';
import fs from 'fs';

type SqliteStatement = {
  run: (...args: any[]) => unknown;
  all: (...args: any[]) => unknown;
  get: (...args: any[]) => unknown;
};

type SqliteDb = {
  pragma: (source: string) => unknown;
  exec: (source: string) => unknown;
  prepare: (source: string) => SqliteStatement;
  close: () => void;
};

type SqliteCtor = new (filename: string) => SqliteDb;

let db: SqliteDb | null = null;
let sqliteCtor: SqliteCtor | null = null;

function getSqliteCtor() {
  if (sqliteCtor) return sqliteCtor;

  try {
    const dynamicRequire = eval('require') as NodeRequire;
    sqliteCtor = dynamicRequire('better-sqlite3') as SqliteCtor;
    return sqliteCtor;
  } catch (error: any) {
    const detail = error?.message || 'unknown error';
    throw new Error(`Local SQLite engine is unavailable in this runtime: ${detail}`);
  }
}

function getCandidateDataDirs() {
  const configuredDir = process.env.IMS_DATA_DIR?.trim();
  const homeDir = os.homedir();
  const appDataDir = process.env.LOCALAPPDATA || process.env.APPDATA;

  return [
    configuredDir,
    appDataDir ? path.join(appDataDir, 'InventorySystem') : undefined,
    homeDir ? path.join(homeDir, '.inventory-system') : undefined,
    path.join(os.tmpdir(), 'inventory-system'),
    path.join(process.cwd(), '.inventory-system'),
  ].filter((dir): dir is string => Boolean(dir));
}

function resolveWritableDataDir() {
  const errors: string[] = [];

  for (const candidate of getCandidateDataDirs()) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch (error: any) {
      errors.push(`${candidate}: ${error?.message || 'unknown error'}`);
    }
  }

  throw new Error(`Cannot create local data directory. Tried: ${errors.join(' | ')}`);
}

export function initLocalDb() {
  // 依序嘗試可寫入的資料目錄，避免特定環境 homedir 不可用。
  const dataDir = resolveWritableDataDir();
  const dbPath = path.join(dataDir, 'local.db');

  const Sqlite = getSqliteCtor();
  db = new Sqlite(dbPath);
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

    CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY,
      po_number TEXT UNIQUE,
      supplier_id TEXT,
      order_date TEXT,
      delivery_date TEXT,
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY,
      purchase_id TEXT,
      product_pno TEXT,
      quantity INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      so_number TEXT UNIQUE,
      customer_id TEXT,
      order_date TEXT,
      delivery_date TEXT,
      delivery_method TEXT,
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'draft',
      notes TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY,
      sale_id TEXT,
      product_pno TEXT,
      quantity INTEGER DEFAULT 0,
      unit_price REAL DEFAULT 0,
      amount REAL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY (sale_id) REFERENCES sales(id)
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

    CREATE TABLE IF NOT EXISTS offline_snapshots (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
    CREATE INDEX IF NOT EXISTS idx_purchase_returns_synced ON purchase_returns(synced);
    CREATE INDEX IF NOT EXISTS idx_sales_returns_synced ON sales_returns(synced);
    CREATE INDEX IF NOT EXISTS idx_offline_snapshots_updated_at ON offline_snapshots(updated_at);
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

export function setOfflineSnapshot(cacheKey: string, payload: unknown) {
  const db = getLocalDb();
  db.prepare(`
    INSERT INTO offline_snapshots (cache_key, payload, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `).run(cacheKey, JSON.stringify(payload), Date.now());
}

export function getOfflineSnapshot<T = unknown>(cacheKey: string): { data: T; updatedAt: number } | null {
  const db = getLocalDb();
  const row = db
    .prepare('SELECT payload, updated_at FROM offline_snapshots WHERE cache_key = ?')
    .get(cacheKey) as { payload: string; updated_at: number } | undefined;

  if (!row) return null;

  try {
    return {
      data: JSON.parse(row.payload) as T,
      updatedAt: Number(row.updated_at) || 0,
    };
  } catch {
    return null;
  }
}
