export function formatAmountNoDecimal(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return safeAmount.toLocaleString('zh-TW', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatAmountOneDecimal(value: number | string | null | undefined) {
  const amount = Number(value ?? 0)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return safeAmount.toLocaleString('zh-TW', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

export function formatCurrencyOneDecimal(value: number | string | null | undefined) {
  return `$${formatAmountOneDecimal(value)}`
}
