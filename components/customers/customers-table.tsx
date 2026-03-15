"use client"

import { useState, useMemo } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card"
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion"
import { Search, Phone, MapPin, User, Trash2, StickyNote } from "lucide-react"
import { CustomerDialog } from "./customer-dialog"
import { DeleteCustomerDialog } from "./delete-customer-dialog"
import { useIsMobile } from "@/hooks/use-mobile"
import { createClient } from "@/lib/supabase/client"

export function CustomersTable({ customers }: { customers: any[] }) {
  const [searchText, setSearchText] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const isMobile = useIsMobile();

  const filteredCustomers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return customers;
    return customers.filter((c: any) => {
      return (
        String(c.code || "").toLowerCase().includes(keyword) ||
        String(c.name || "").toLowerCase().includes(keyword) ||
        String(c.tel1 || "").toLowerCase().includes(keyword)
      );
    });
  }, [customers, searchText]);

  const handleEditOpenChange = (open: boolean) => {
    setEditOpen(open);
  };

  return (
    <div className="space-y-4 p-1">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="搜尋名稱、編號或電話..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="pl-10 focus-visible:ring-blue-500"
        />
      </div>
      {filteredCustomers.length === 0 ? (
        <div className="px-6 py-10 text-center text-sm text-gray-400">查無資料</div>
      ) : (
        <Accordion type="single" collapsible className="w-full space-y-3">
          {filteredCustomers.map((c: any) => (
            <AccordionItem key={c.code} value={String(c.code)}>
              <Card className="w-full">
                <CardHeader className="flex flex-row items-center justify-between gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full">
                    <span className="font-mono text-sm text-blue-600 min-w-[60px]">{c.code}</span>
                    <CardTitle className="flex items-center gap-2">
                      <User className="h-4 w-4 text-slate-400" />
                      {c.name}
                    </CardTitle>
                    <span className="flex items-center gap-1 font-medium text-slate-700">
                      <Phone className="h-4 w-4 text-green-500" />
                      {c.tel1 ? (
                        <a href={`tel:${c.tel1}`} className="underline text-blue-700 hover:text-blue-900">{c.tel1}</a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </span>
                    {!isMobile && (
                      <span className="flex items-center gap-1 text-sm text-slate-500">
                        <MapPin className="h-4 w-4 text-red-400" />
                        {c.addr || <span className="text-slate-400">—</span>}
                      </span>
                    )}
                  </div>
                  <CardAction>
                    <AccordionTrigger className="hover:no-underline" />
                  </CardAction>
                </CardHeader>
                <AccordionContent className="px-6 pb-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <p className="text-xs text-gray-500">電話1</p>
                      <p className="mt-1 text-base font-semibold text-gray-700">
                        {c.tel1 ? (
                          <a href={`tel:${c.tel1}`} className="underline text-blue-700 hover:text-blue-900">{c.tel1}</a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">電話2</p>
                      <p className="mt-1 text-base font-semibold text-gray-700">
                        {c.tel2 || c.tel11 ? (
                          <a href={`tel:${c.tel2 || c.tel11}`} className="underline text-blue-700 hover:text-blue-900">{c.tel2 || c.tel11}</a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">電話3</p>
                      <p className="mt-1 text-base font-semibold text-gray-700">
                        {c.fax ? (
                          <a href={`tel:${c.fax}`} className="underline text-blue-700 hover:text-blue-900">{c.fax}</a>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs text-gray-500">地址</p>
                      <p className="mt-1 text-base text-slate-700">
                        {c.addr || <span className="text-slate-400">—</span>}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 flex items-center gap-1"><StickyNote className="inline h-3 w-3 mr-1" />備註</p>
                      <p className="mt-1 text-base text-slate-700 whitespace-pre-line">
                        {c.note ? c.note : <span className="text-slate-400">—</span>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2 justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingCustomer(c);
                        setEditOpen(true);
                      }}
                    >
                      編輯
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setDeleteOpen(true);
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </AccordionContent>
              </Card>
            </AccordionItem>
          ))}
        </Accordion>
      )}
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
  );
}