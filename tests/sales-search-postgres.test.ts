import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

// Opt-in: requires pg and the project's existing SUPABASE_DB_URL.
// All fixtures, indexes and the test RPC live in a separate schema in one
// transaction that is rolled back. No public business rows are written.
describe.skipIf(process.env.RUN_POSTGRES_SEARCH_TESTS !== "true")("sales search on PostgreSQL", () => {
  const schema = `ims_sales_search_test_${randomUUID().replaceAll("-", "")}`
  let client: any
  const migration = readFileSync("scripts/061-optimize-sales-search.sql", "utf8")
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "")
    .replace(/\bpublic\./g, `${schema}.`)

  beforeAll(async () => {
    if (!process.env.SUPABASE_DB_URL) process.loadEnvFile(".env.local")
    const { Client } = createRequire(import.meta.url)("pg")
    const response = await fetch("https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt")
    if (!response.ok) throw new Error("Could not download the Supabase public CA")
    client = new Client({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { ca: await response.text(), rejectUnauthorized: true },
      connectionTimeoutMillis: 10000,
    })
    try { await client.connect() }
    catch (error: any) { throw new Error(`PostgreSQL connection failed (${error.code || "unknown"})`) }

    await client.query(`
      BEGIN;
      CREATE SCHEMA ${schema};
      CREATE TABLE ${schema}.products (code text PRIMARY KEY, name text);
      CREATE TABLE ${schema}.customers (code text PRIMARY KEY, name text);
      CREATE TABLE ${schema}.sales_orders (
        id uuid PRIMARY KEY, order_no text, customer_cno text, delivery_method text,
        order_date date, total_amount numeric, status text, is_paid boolean, notes text,
        created_at timestamptz, updated_at timestamptz
      );
      CREATE TABLE ${schema}.sales_order_items (
        id uuid PRIMARY KEY, sales_order_id uuid, code text, quantity integer,
        unit_price numeric, subtotal numeric, created_at timestamptz
      );
      INSERT INTO ${schema}.products VALUES ('P001', '原味麥片'), ('P002', '巧克力麥片'), ('P003', '牛奶');
      INSERT INTO ${schema}.products SELECT 'R' || g, '大份麥片' FROM generate_series(1,1200) g;
      INSERT INTO ${schema}.customers VALUES ('C001', '王先生'), ('C002', '麥片商店');
      INSERT INTO ${schema}.sales_orders
        SELECT md5('order-' || g)::uuid, 'SO-' || g,
          CASE WHEN g % 2 = 0 THEN 'C001' ELSE 'C002' END, 'customer_pickup',
          DATE '2026-10-07' - (g % 10), 100, 'completed', false,
          CASE WHEN g % 7 = 0 THEN 'special note' ELSE NULL END,
          TIMESTAMPTZ '2026-10-07 00:00:00+00' + g * INTERVAL '1 second', NOW()
        FROM generate_series(1,5000) g;
      INSERT INTO ${schema}.sales_order_items
        SELECT md5('item-' || g)::uuid, md5('order-' || g)::uuid,
          CASE WHEN g % 3 = 0 THEN 'P003' WHEN g % 3 = 1 THEN 'P001' ELSE 'P002' END,
          1, 100, 100, NOW() FROM generate_series(1,5000) g;
      INSERT INTO ${schema}.sales_order_items
        SELECT md5('extra-' || g)::uuid, md5('order-' || g)::uuid, 'R' || g, 1, 5, 5, NOW()
        FROM generate_series(1,1200) g;
      INSERT INTO ${schema}.sales_order_items VALUES
        (md5('orphan-item')::uuid, md5('order-5000')::uuid, 'OLD-SKU', 1, 1, 1, NOW());
      GRANT USAGE ON SCHEMA ${schema} TO authenticated;
      GRANT SELECT ON ALL TABLES IN SCHEMA ${schema} TO authenticated;
    `)
    await client.query(`INSERT INTO ${schema}.products VALUES ($1, $2)`, ["SPECIAL", '100% _ \\, ("麥片")'])
    await client.query(`INSERT INTO ${schema}.sales_order_items VALUES (md5('special')::uuid, md5('order-5000')::uuid, 'SPECIAL', 1, 1, 1, NOW())`)
    for (const table of ["products", "customers", "sales_orders", "sales_order_items"]) {
      await client.query(`ALTER TABLE ${schema}.${table} ENABLE ROW LEVEL SECURITY;
        CREATE POLICY test_authenticated ON ${schema}.${table} FOR SELECT TO authenticated USING (true);`)
    }
    await client.query(migration)
  }, 30000)

  afterAll(async () => {
    if (client) {
      await client.query("ROLLBACK").catch(() => {})
      await client.end()
    }
  })

  async function search(keyword: string | null, product: string | null, offset = 0, limit = 20) {
    await client.query("SET LOCAL ROLE authenticated")
    try {
      const result = await client.query(`SELECT ${schema}.search_sales_orders_page($1,$2,$3,$4) AS result`, [keyword, product, offset, limit])
      return result.rows[0].result as { total_count: number; rows: Record<string, any>[] }
    } finally { await client.query("RESET ROLE") }
  }

  // Independently join fixture tables to compute the expected set and order.
  async function expectedProductIds(keyword: string) {
    const pattern = `%${keyword.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
    return (await client.query(`
      SELECT DISTINCT s.id, s.order_date, s.created_at
      FROM ${schema}.sales_orders s JOIN ${schema}.sales_order_items i ON i.sales_order_id = s.id
      LEFT JOIN ${schema}.products p ON p.code = i.code
      WHERE p.name ILIKE $1 OR i.code ILIKE $1
      ORDER BY s.order_date DESC, s.created_at DESC, s.id DESC
    `, [pattern])).rows.map((row: { id: string }) => row.id)
  }

  it.each(["麥片", "麥", "p003", "R1200", "OLD-SKU", "%", "_", "\\", ', ("', "不存在"])(
    "matches product input %s, including literal punctuation and historical codes", async (keyword) => {
      const expected = await expectedProductIds(keyword)
      const actual = await search("", keyword)
      expect(actual.total_count).toBe(expected.length)
      expect(actual.rows.map((row) => row.id)).toEqual(expected.slice(0,20))
    },
  )

  it("returns a stable second page without duplicates and preserves every detail item", async () => {
    const expected = await expectedProductIds("麥片")
    const actual = await search("", " 麥片 ", 20)
    expect(actual.total_count).toBe(expected.length)
    expect(actual.rows.map((row) => row.id)).toEqual(expected.slice(20,40))
    expect((await search("", "麥片", 20)).rows.map((row) => row.id)).toEqual(actual.rows.map((row) => row.id))
    for (const row of actual.rows) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS count FROM ${schema}.sales_order_items WHERE sales_order_id=$1`, [row.id])
      expect(row.items).toHaveLength(rows[0].count)
    }
  })

  it("combines customer name with product name, and does not search customer names as products", async () => {
    const actual = await search("王先生", "麥片")
    const expected = await expectedProductIds("麥片")
    const { rows } = await client.query(`SELECT id FROM ${schema}.sales_orders WHERE customer_cno='C001'`)
    const ids = new Set(rows.map((row: { id: string }) => row.id))
    expect(actual.total_count).toBe(expected.filter((id: string) => ids.has(id)).length)
    expect(actual.rows.map((row) => row.id)).toEqual(expected.filter((id: string) => ids.has(id)).slice(0,20))
    expect((await search("", "商店")).total_count).toBe(0)
  })

  it.each(["SO-5000", "special note", "C001", "王先生"])("retains order search for %s", async (keyword) => {
    const pattern = `%${keyword}%`
    const { rows } = await client.query(`
      SELECT COUNT(*)::int AS count FROM ${schema}.sales_orders s
      LEFT JOIN ${schema}.customers c ON c.code = s.customer_cno
      WHERE s.order_no ILIKE $1 OR s.customer_cno ILIKE $1 OR s.notes ILIKE $1 OR c.name ILIKE $1
    `, [pattern])
    expect((await search(keyword, "")).total_count).toBe(rows[0].count)
  })

  it("retains totals for empty pages and bounds the requested page size", async () => {
    expect(await search("", "麥片", 10000)).toMatchObject({ rows: [], total_count: (await expectedProductIds("麥片")).length })
    expect((await search(null, null, -1, 1000)).rows).toHaveLength(100)
    expect((await search(null, null, 0, 0)).rows).toHaveLength(1)
  })

  it("obeys the caller's RLS and denies anonymous RPC execution", async () => {
    const initial = await search("", "")
    await client.query(`ALTER POLICY test_authenticated ON ${schema}.sales_orders USING (customer_cno='C001')`)
    try {
      const limited = await search("", "")
      expect(limited.total_count).toBe(initial.total_count / 2)
      expect(limited.rows.every((row) => row.customer_cno === "C001")).toBe(true)
      const { rows } = await client.query(`SELECT has_function_privilege('anon', '${schema}.search_sales_orders_page(text,text,integer,integer)', 'EXECUTE') AS allowed`)
      expect(rows[0].allowed).toBe(false)
    } finally {
      await client.query(`ALTER POLICY test_authenticated ON ${schema}.sales_orders USING (true)`)
    }
  })

  it("can apply the migration again without changing the search result", async () => {
    const before = await search("", "麥片")
    await client.query(migration)
    expect(await search("", "麥片")).toEqual(before)
  })
})
