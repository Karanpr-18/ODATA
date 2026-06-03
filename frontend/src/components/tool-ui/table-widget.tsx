"use client";

import React, { useState, useMemo } from "react";
import { Table2, Search, ChevronUp, ChevronDown, Download } from "lucide-react";

interface TableWidgetProps {
  data: Record<string, unknown>;
}

export function TableWidget({ data }: TableWidgetProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const tableConfig = useMemo(() => {
    const title = (data.title as string) || (data.name as string) || "Data Table";
    let rows: Record<string, unknown>[] = [];

    if (Array.isArray(data.data)) {
      rows = data.data as Record<string, unknown>[];
    } else if (Array.isArray(data.rows)) {
      rows = data.rows as Record<string, unknown>[];
    } else if (Array.isArray(data)) {
      rows = data as unknown as Record<string, unknown>[];
    }

    const columns =
      (data.columns as string[]) ||
      (rows.length > 0 ? Object.keys(rows[0]) : []);

    return { title, rows, columns };
  }, [data]);

  const { title, rows, columns } = tableConfig;

  // Filter rows
  const filteredRows = useMemo(() => {
    let result = [...rows];

    if (search.trim()) {
      const searchLower = search.toLowerCase();
      result = result.filter((row) =>
        columns.some((col) =>
          String(row[col] ?? "")
            .toLowerCase()
            .includes(searchLower)
        )
      );
    }

    // Sort rows
    if (sortKey) {
      result.sort((a, b) => {
        const aVal = a[sortKey];
        const bVal = b[sortKey];

        if (typeof aVal === "number" && typeof bVal === "number") {
          return sortDir === "asc" ? aVal - bVal : bVal - aVal;
        }

        const aStr = String(aVal ?? "");
        const bStr = String(bVal ?? "");
        return sortDir === "asc"
          ? aStr.localeCompare(bStr)
          : bStr.localeCompare(aStr);
      });
    }

    return result;
  }, [rows, columns, search, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleExportCSV = () => {
    if (rows.length === 0) return;
    const header = columns.join(",");
    const csvRows = filteredRows.map((row) =>
      columns.map((col) => {
        const val = String(row[col] ?? "");
        return val.includes(",") || val.includes('"')
          ? `"${val.replace(/"/g, '""')}"`
          : val;
      }).join(",")
    );
    const csv = [header, ...csvRows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!rows.length || !columns.length) {
    return (
      <div className="widget-card">
        <div style={{ textAlign: "center", color: "var(--text-tertiary)", padding: "20px" }}>
          No table data available
        </div>
      </div>
    );
  }

  // Format column name for display
  const formatColName = (col: string) => {
    return col
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\b\w/g, (l) => l.toUpperCase());
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
            <Table2 size={16} />
          </div>
          <span className="widget-card-title">{title}</span>
          <span
            style={{
              fontSize: "11px",
              color: "var(--text-tertiary)",
              padding: "3px 8px",
              background: "var(--bg-tertiary)",
              borderRadius: "var(--radius-full)",
            }}
          >
            {filteredRows.length} of {rows.length} rows
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Search */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              background: "var(--bg-input)",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-sm)",
              fontSize: "12px",
            }}
          >
            <Search size={13} style={{ color: "var(--text-tertiary)" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              style={{
                border: "none",
                background: "transparent",
                outline: "none",
                color: "var(--text-primary)",
                fontSize: "12px",
                width: 100,
                fontFamily: "inherit",
              }}
            />
          </div>
          {/* Export */}
          <button
            onClick={handleExportCSV}
            style={{
              background: "none",
              border: "1px solid var(--border-primary)",
              borderRadius: "var(--radius-sm)",
              padding: "5px 8px",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "12px",
              transition: "all var(--transition-fast)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-accent)";
              e.currentTarget.style.color = "var(--text-accent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-primary)";
              e.currentTarget.style.color = "var(--text-tertiary)";
            }}
            title="Export as CSV"
          >
            <Download size={13} />
            CSV
          </button>
        </div>
      </div>

      <div className="data-table-container">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col} onClick={() => handleSort(col)}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span>{formatColName(col)}</span>
                    {sortKey === col &&
                      (sortDir === "asc" ? (
                        <ChevronUp size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      ))}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col}>
                    {row[col] !== null && row[col] !== undefined
                      ? String(row[col])
                      : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
