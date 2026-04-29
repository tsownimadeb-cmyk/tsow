import { Skeleton } from "@/components/ui/skeleton"

export default function ProductProfitAnalysisLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-44" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-20" />
            <Skeleton className="h-10 w-20" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="rounded-md border border-gray-200 bg-white p-4">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-3 h-8 w-32" />
          </div>
        ))}
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4">
        <Skeleton className="h-10 w-full" />
      </div>

      <div className="rounded-md border border-gray-200 bg-white p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, idx) => (
          <Skeleton key={idx} className="h-6 w-full" />
        ))}
      </div>
    </div>
  )
}
