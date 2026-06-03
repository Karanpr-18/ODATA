"use client";

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import { BarChart3, TrendingUp, PieChart as PieChartIcon } from "lucide-react";

interface ChartWidgetProps {
  data: Record<string, unknown>;
}

const CHART_COLORS = [
  "#3b82f6",
  "#06b6d4",
  "#8b5cf6",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#ec4899",
  "#6366f1",
];

export function ChartWidget({ data }: ChartWidgetProps) {
  const chartConfig = useMemo(() => {
    const chartType =
      (data.chartType as string) ||
      (data.chart_type as string) ||
      (data.type as string) ||
      "bar";
    const title =
      (data.title as string) || (data.name as string) || "Chart";
    const chartData =
      (data.data as Record<string, unknown>[]) ||
      (data.rows as Record<string, unknown>[]) ||
      (data.values as Record<string, unknown>[]) ||
      [];

    // Auto-detect keys for axes
    let xKey = (data.xKey as string) || (data.x_key as string) || "";
    let yKeys: string[] =
      (data.yKeys as string[]) ||
      (data.y_keys as string[]) ||
      (data.dataKeys as string[]) ||
      [];

    if (chartData.length > 0 && !xKey) {
      const keys = Object.keys(chartData[0]);
      // First string-ish key is X, rest are Y
      xKey = keys[0];
      if (yKeys.length === 0) {
        yKeys = keys.slice(1).filter((k) => {
          const val = chartData[0][k];
          return typeof val === "number" || !isNaN(Number(val));
        });
      }
    }

    return { chartType, title, chartData, xKey, yKeys };
  }, [data]);

  const { chartType, title, chartData, xKey, yKeys } = chartConfig;

  if (!chartData || chartData.length === 0) {
    return (
      <div className="widget-card">
        <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "20px" }}>
          No chart data available
        </div>
      </div>
    );
  }

  const getChartIcon = () => {
    switch (chartType) {
      case "line":
      case "area":
        return <TrendingUp size={16} />;
      case "pie":
        return <PieChartIcon size={16} />;
      default:
        return <BarChart3 size={16} />;
    }
  };

  const tooltipStyle = {
    backgroundColor: "var(--bg-glass-heavy)",
    border: "1px solid var(--border-primary)",
    borderRadius: "var(--radius-sm)",
    padding: "8px 12px",
    fontSize: "12px",
    color: "var(--text-primary)",
    backdropFilter: "blur(10px)",
    boxShadow: "var(--shadow-md)",
  };

  const renderChart = () => {
    switch (chartType) {
      case "line":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-primary)"
                opacity={0.5}
              />
              <XAxis
                dataKey={xKey}
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                stroke="var(--border-primary)"
              />
              <YAxis
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                stroke="var(--border-primary)"
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {yKeys.map((key, i) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ fill: CHART_COLORS[i % CHART_COLORS.length], r: 4 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        );

      case "area":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                {yKeys.map((key, i) => (
                  <linearGradient key={key} id={`gradient-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-primary)"
                opacity={0.5}
              />
              <XAxis
                dataKey={xKey}
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                stroke="var(--border-primary)"
              />
              <YAxis
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                stroke="var(--border-primary)"
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {yKeys.map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={2}
                  fill={`url(#gradient-${key})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

      case "pie":
        return (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey={yKeys[0] || "value"}
                nameKey={xKey || "name"}
                cx="50%"
                cy="50%"
                outerRadius={100}
                innerRadius={50}
                paddingAngle={2}
                label={({ name, percent }) =>
                  `${name} ${(percent * 100).toFixed(0)}%`
                }
                labelLine={{ stroke: "var(--text-tertiary)" }}
              >
                {chartData.map((_entry, i) => (
                  <Cell
                    key={`cell-${i}`}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                    stroke="none"
                  />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        );

      default: // bar
        return (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} barCategoryGap="20%">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--border-primary)"
                opacity={0.5}
              />
              <XAxis
                dataKey={xKey}
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                stroke="var(--border-primary)"
              />
              <YAxis
                tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
                stroke="var(--border-primary)"
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--bg-hover)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {yKeys.map((key, i) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={50}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  return (
    <div className="widget-card">
      <div className="widget-card-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              color: "var(--accent-primary)",
              display: "flex",
              alignItems: "center",
            }}
          >
            {getChartIcon()}
          </div>
          <span className="widget-card-title">{title}</span>
        </div>
        <span
          style={{
            fontSize: "11px",
            color: "var(--text-tertiary)",
            padding: "3px 8px",
            background: "var(--bg-tertiary)",
            borderRadius: "var(--radius-full)",
          }}
        >
          {chartData.length} data points
        </span>
      </div>
      {renderChart()}
    </div>
  );
}
