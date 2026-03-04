"use client"

import { useEffect, useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useRef } from "react"

type CustomerOption = {
  code: string
  name: string
}

type CustomerKeywordAutocompleteProps = {
  name: string
  selectedCodeName: string
  defaultValue?: string
  defaultSelectedCode?: string
  placeholder?: string
  ariaLabel?: string
  customers: CustomerOption[]
}

const normalizeText = (value: unknown) => String(value ?? "").trim()

export function CustomerKeywordAutocomplete({
  name,
  selectedCodeName,
  defaultValue,
  defaultSelectedCode,
  placeholder,
  ariaLabel,
  customers,
}: CustomerKeywordAutocompleteProps) {
  const [keyword, setKeyword] = useState(normalizeText(defaultValue))
  const [selectedCode, setSelectedCode] = useState(normalizeText(defaultSelectedCode))
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const selectedCodeRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setKeyword(normalizeText(defaultValue))
    setSelectedCode(normalizeText(defaultSelectedCode))
  }, [defaultValue, defaultSelectedCode])

  const filteredCustomers = useMemo(() => {
    const normalizedKeyword = normalizeText(keyword).toLowerCase()
    if (!normalizedKeyword) return customers.slice(0, 12)

    return customers
      .filter((customer) => {
        const code = normalizeText(customer.code).toLowerCase()
        const customerName = normalizeText(customer.name).toLowerCase()
        return code.includes(normalizedKeyword) || customerName.includes(normalizedKeyword)
      })
      .slice(0, 12)
  }, [customers, keyword])

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        type="text"
        name={name}
        value={keyword}
        onChange={(event) => {
          setKeyword(event.target.value)
          setSelectedCode("")
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 100)
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete="off"
      />
      <input ref={selectedCodeRef} type="hidden" name={selectedCodeName} value={selectedCode} />

      {open && filteredCustomers.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {filteredCustomers.map((customer) => {
            const code = normalizeText(customer.code)
            const customerName = normalizeText(customer.name) || code
            return (
              <button
                key={code}
                type="button"
                className={cn(
                  "w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                  selectedCode === code && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => {
                  event.preventDefault()
                  setKeyword(customerName)
                  setSelectedCode(code)
                  setOpen(false)

                  if (inputRef.current) {
                    inputRef.current.value = customerName
                  }
                  if (selectedCodeRef.current) {
                    selectedCodeRef.current.value = code
                  }

                  const formElement = event.currentTarget.form
                  setTimeout(() => {
                    formElement?.requestSubmit()
                  }, 0)
                }}
              >
                <span className="font-medium">{customerName}</span>
                <span className="ml-2 text-xs text-muted-foreground">{code}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}