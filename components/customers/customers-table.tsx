"use client"

import { useEffect, useState } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, Phone, MapPin, User, Trash2 } from "lucide-react"
import { CustomerDialog } from "./customer-dialog"
import { DeleteCustomerDialog } from "./delete-customer-dialog"
import { createClient } from "@/lib/supabase/client"

export function CustomersTable({ customers }: { customers: any[] }) {
  const supabase = createClient()
  const [search, setSearch] = useState("")
  const [rows, setRows] = useState<any[]>(customers || [])
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<any>(null)

  useEffect(() => {
    setRows(customers || [])
  }, [customers])

  const fetchCustomers = async () => {
    const { data, error } = await supabase.from("customers").select("*").order("code", { ascending: true })
    if (!error) {
      setRows(data || [])
    }
  }

  const handleEditOpenChange = (open: boolean) => {
    setEditOpen(open)
    if (!open) {
      fetchCustomers()
    }
  }

  const filtered = (rows || []).filter(
    (c) =>
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.code?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-4 p-1">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="搜尋名稱或編號..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 focus-visible:ring-blue-500"
        />
      </div>
      <div className="rounded-lg border bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 font-bold">
              <TableHead className="w-[100px]">編號</TableHead>
              <TableHead className="w-[150px]">姓名</TableHead>
              <TableHead className="w-[200px]">電話資訊</TableHead>
              <TableHead>地址</TableHead>
              <TableHead className="w-[100px] text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-slate-400">
                  查無資料
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((c) => (
                <TableRow key={c.code} className="hover:bg-blue-50/30 transition-colors">
                  <TableCell className="font-mono text-sm text-blue-600 font-medium">{c.code}</TableCell>
                  <TableCell className="font-semibold text-slate-800">
                    <div className="flex items-center gap-2">
                      <User className="h-3 w-3 text-slate-400" />
                      {c.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1 text-sm">
                      {c.tel1 && (
                        <div className="flex items-center gap-1 font-medium text-slate-700">
                          <Phone className="h-3 w-3 text-green-500" />
                          {c.tel1}
                        </div>
                      )}
                      {(c.tel2 || c.tel11) && <div className="text-slate-500 text-xs pl-4">電話2: {c.tel2 || c.tel11}</div>}
                      {c.fax && <div className="text-slate-500 text-xs pl-4">電話3: {c.fax}</div>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">
                    <div className="flex items-start gap-1">
                      <MapPin className="h-3 w-3 text-red-400 mt-1 shrink-0" />
                      <span>{c.addr}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingCustomer(c)
                        setEditOpen(true)
                      }}
                    >
                      編輯
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => {
                        setSelectedCustomer(c)
                        setDeleteOpen(true)
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {selectedCustomer && (
        <DeleteCustomerDialog
          customer={selectedCustomer}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
        />
      )}

      {editingCustomer && (
        <CustomerDialog
          mode="edit"
          customer={editingCustomer}
          open={editOpen}
          onOpenChange={handleEditOpenChange}
        />
      )}
    </div>
  )
}