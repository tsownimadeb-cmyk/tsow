import { Skeleton } from "@/components/ui/skeleton"

export default function AccountsReceivableLoading() {
  return (
    <div className="p-6 space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>

      <div className="rounded-lg border p-4 space-y-4">
        <Skeleton className="h-10 w-72" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-md" />
        ))}
      </div>

      <div className="flex items-center justify-center gap-4">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  )
}
