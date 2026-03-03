"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrencyOneDecimal } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CustomerPreferenceProduct {
  code: string
  name: string
  purchaseQty: number
  purchaseCount: number
  lastUnitPrice: number
  lastOrderDate: string
}

export interface CustomerPreferenceSummary {
  customerCode: string
  customerName: string
  products: CustomerPreferenceProduct[]
}

interface CustomerPreferencePanelProps {
  items: CustomerPreferenceSummary[]
}

export function CustomerPreferencePanel({ items }: CustomerPreferencePanelProps) {
  const [open, setOpen] = useState(false)
  const [selectedCustomerCode, setSelectedCustomerCode] = useState<string>(items[0]?.customerCode || "")

  const selectedCustomer = useMemo(
    () => items.find((item) => item.customerCode === selectedCustomerCode) || items[0],
    [items, selectedCustomerCode],
  )

  if (!items.length) {
    return <p className="text-sm text-muted-foreground">本年度尚無可分析的客戶偏好資料</p>
  }

  return (
    <div className="space-y-4">
      <div className="max-w-sm">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              className="w-full justify-between"
            >
              {selectedCustomer ? `${selectedCustomer.customerName} (${selectedCustomer.customerCode})` : "選擇客戶"}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[320px] p-0" align="start">
            <Command>
              <CommandInput placeholder="搜尋客戶名稱或代碼（例：莊 / B001）" />
              <CommandList>
                <CommandEmpty>找不到符合的客戶</CommandEmpty>
                <CommandGroup>
                  {items.map((item) => (
                    <CommandItem
                      key={item.customerCode}
                      value={`${item.customerCode} ${item.customerName}`}
                      onSelect={() => {
                        setSelectedCustomerCode(item.customerCode)
                        setOpen(false)
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          selectedCustomer?.customerCode === item.customerCode ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span>{item.customerName}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{item.customerCode}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      <div>
        <p className="mb-2 text-sm text-muted-foreground">
          {selectedCustomer?.customerName} 的熱銷組合（依購買數量排序）
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">排名</TableHead>
              <TableHead>商品</TableHead>
              <TableHead className="text-right">購買數量</TableHead>
              <TableHead className="text-right">購買次數</TableHead>
              <TableHead className="text-right">最近單價</TableHead>
              <TableHead className="text-right">最近購買日</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(selectedCustomer?.products || []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">此客戶本年度尚無商品購買資料</TableCell>
              </TableRow>
            ) : (
              selectedCustomer!.products.map((product, index) => (
                <TableRow key={`${selectedCustomer!.customerCode}-${product.code}`}>
                  <TableCell>#{index + 1}</TableCell>
                  <TableCell>
                    <div className="font-medium">{product.name}</div>
                    <div className="text-xs text-muted-foreground">{product.code}</div>
                  </TableCell>
                  <TableCell className="text-right">{product.purchaseQty.toLocaleString("zh-TW")}</TableCell>
                  <TableCell className="text-right">{product.purchaseCount.toLocaleString("zh-TW")}</TableCell>
                  <TableCell className="text-right">{formatCurrencyOneDecimal(product.lastUnitPrice)}</TableCell>
                  <TableCell className="text-right">{product.lastOrderDate || "-"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
