"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { CartesianGrid, Line, LineChart, XAxis } from "recharts"

interface RevenueTrendChartProps {
  data: Array<{
    date: string
    fullDate: string
    revenue: number
  }>
}

const chartConfig = {
  revenue: {
    label: "營收",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig

export function RevenueTrendChart({ data }: RevenueTrendChartProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>近七日營收趨勢圖</CardTitle>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[280px] w-full">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  className="bg-white rounded-md border border-border shadow-sm"
                  labelFormatter={(_, payload) => {
                    const fullDate = payload?.[0]?.payload?.fullDate
                    return typeof fullDate === "string" ? fullDate : "-"
                  }}
                  formatter={(value) => {
                    const amount = Number(value)
                    const safeAmount = Number.isFinite(amount) ? amount : 0
                    return (
                      <div className="flex min-w-[11rem] items-center justify-between gap-3">
                        <span className="text-muted-foreground">當日營收</span>
                        <span className="text-foreground font-mono font-medium tabular-nums">
                          ${safeAmount.toLocaleString()}
                        </span>
                      </div>
                    )
                  }}
                />
              }
            />
            <Line
              dataKey="revenue"
              type="monotone"
              stroke="var(--color-revenue)"
              strokeWidth={2}
              dot={{ fill: "var(--color-revenue)", r: 3 }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
