// Server-side experimental Node.js global localStorage patch
if (
  typeof global !== "undefined" &&
  (global as any).localStorage &&
  typeof (global as any).localStorage.getItem !== "function"
) {
  try {
    delete (global as any).localStorage;
  } catch {
    // Ignore if non-configurable
  }
}

import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/contexts/theme-context";

export const metadata: Metadata = {
  title: "SAP OData Assistant",
  description: "Enterprise AI-powered assistant for SAP OData queries, analytics, and data exploration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
