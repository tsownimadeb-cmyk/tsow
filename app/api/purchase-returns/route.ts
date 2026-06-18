import { NextResponse } from "next/server";

export async function POST() {
return NextResponse.json(
{
success: false,
message:
"POST /api/purchase-returns 已停用。請改用 create_purchase_return RPC 或 /api/purchase-returns/update。",
deprecated: true,
},
{ status: 410 }
);
}
