import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export interface RankMobileCardProps {
  rank: number;
  name: string;
  value: string;
  subInfo?: string;
  highlight?: "gold" | "silver" | "bronze";
  icon?: ReactNode;
}

const rankBg: Record<string, string> = {
  gold: "bg-yellow-100 border-yellow-300",
  silver: "bg-gray-200 border-gray-400",
  bronze: "bg-orange-100 border-orange-300",
};

export function RankMobileCard({
  rank,
  name,
  value,
  subInfo,
  highlight,
  icon,
}: RankMobileCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border p-4 shadow-sm bg-white",
        highlight && rankBg[highlight]
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn(
            "text-2xl font-extrabold tabular-nums",
            highlight === "gold" && "text-yellow-600",
            highlight === "silver" && "text-gray-500",
            highlight === "bronze" && "text-orange-600"
          )}>
            #{rank}
          </span>
          <span className="text-base font-semibold truncate max-w-[8em]">{name}</span>
          {icon && <span className="ml-1">{icon}</span>}
        </div>
        <span className="text-2xl font-bold text-emerald-700 tabular-nums">{value}</span>
      </div>
      {subInfo && (
        <div className="mt-1 text-xs text-gray-500 text-right">{subInfo}</div>
      )}
    </div>
  );
}
