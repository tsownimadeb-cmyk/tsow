"use client"

import dynamic from "next/dynamic"
import type { AccountsReceivable } from "@/lib/types"

const ARTable = dynamic(
  () => import("@/components/accounts-receivable/ar-table").then((m) => m.ARTable),
  { ssr: false },
)

interface ARTableClientProps {
  records: AccountsReceivable[]
  initialSearch?: string
  allCustomers?: Array<{
    code: string
    name: string
  }>
}

export function ARTableClient({ records, initialSearch = "", allCustomers = [] }: ARTableClientProps) {
  return <ARTable records={records} initialSearch={initialSearch} allCustomers={allCustomers} />
}
