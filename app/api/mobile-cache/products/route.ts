import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchAllProductsRows, normalizeProducts } from "@/lib/products"

export async function GET() {
  try {
    const supabase = await createClient()
    const { rows, warning } = await fetchAllProductsRows(supabase)

    if (warning) {
      console.warn("[mobile-cache/products]", warning)
    }

    return NextResponse.json({
      success: true,
      data: normalizeProducts(rows || []),
      updatedAt: Date.now(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "failed to load products cache" },
      { status: 500 }
    )
  }
}
