import { Skeleton } from "@/components/ui/skeleton"

export default function SalesLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className="rounded-md border border-gray-200 bg-white">
        <div className="grid grid-cols-6 gap-4 border-b bg-gray-50 px-6 py-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="grid grid-cols-6 gap-4 border-b px-6 py-4">
            {Array.from({ length: 6 }).map((_, j) => (
              <Skeleton key={j} className="h-4 w-full" />
            ))}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-4">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-9 w-20" />
      </div>
    </div>
  )
}
