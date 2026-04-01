"use client"

import dynamic from "next/dynamic"
import type { AccountsReceivable } from "@/lib/types"

const ARTable = dynamic(
  () => import("@/components/accounts-receivable/ar-table").then((m) => m.ARTable),
  { ssr: false },
)

interface ARTableClientProps {
  records: AccountsReceivable[]
  allCustomers?: Array<{
    code: string
    name: string
  }>
}

export function ARTableClient({ records, allCustomers = [] }: ARTableClientProps) {
  return <ARTable records={records} allCustomers={allCustomers} />
}
