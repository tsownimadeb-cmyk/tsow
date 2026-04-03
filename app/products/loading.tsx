import { Skeleton } from "@/components/ui/skeleton"

export default function ProductsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <div className="rounded-md border border-gray-200 bg-white">
        <Skeleton className="h-12 border-b mx-4 my-2 max-w-sm" />
        <div className="grid grid-cols-12 gap-2 border-b bg-gray-50 px-6 py-3">
          {[2, 3, 3, 2, 2].map((cols, i) => (
            <Skeleton key={i} className={`col-span-${cols} h-4`} />
          ))}
        </div>
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 border-b px-6 py-4">
            {[2, 3, 3, 2, 2].map((cols, j) => (
              <Skeleton key={j} className={`col-span-${cols} h-4`} />
            ))}
          </div>
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
