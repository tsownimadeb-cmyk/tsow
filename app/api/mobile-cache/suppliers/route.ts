import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()

    const sortedResult = await supabase
      .from("suppliers")
      .select("*")
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })

    if (!sortedResult.error) {
      return NextResponse.json({
        success: true,
        data: sortedResult.data || [],
        updatedAt: Date.now(),
      })
    }

    const fallbackResult = await supabase.from("suppliers").select("*").order("created_at", { ascending: false })

    if (fallbackResult.error) throw fallbackResult.error

    return NextResponse.json({
      success: true,
      data: fallbackResult.data || [],
      updatedAt: Date.now(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "failed to load suppliers cache" },
      { status: 500 }
    )
  }
}
