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
  initialShowAllCustomers?: boolean
  allCustomers?: Array<{
    code: string
    name: string
  }>
}

export function ARTableClient({
  records,
  initialSearch = "",
  initialShowAllCustomers = false,
  allCustomers = [],
}: ARTableClientProps) {
  return (
    <ARTable
      records={records}
      initialSearch={initialSearch}
      initialShowAllCustomers={initialShowAllCustomers}
      allCustomers={allCustomers}
    />
  )
}
