import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.from("customers").select("*").order("code", { ascending: true })

    if (error) throw error

    return NextResponse.json({
      success: true,
      data: data || [],
      updatedAt: Date.now(),
    })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: error?.message || "failed to load customers cache" },
      { status: 500 }
    )
  }
}
