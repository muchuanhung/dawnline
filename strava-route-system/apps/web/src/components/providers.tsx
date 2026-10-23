"use client";

import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { PwaProvider } from "@/components/pwa/pwa-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * 全站 Provider
 * - 主題：淺色為主，深色跟隨系統設定
 * - ThemeProvider 必須一直在樹上：若 mount 前後切換有無 ThemeProvider，
 *   React 會把整個 app 卸載重掛，所有 effect 與請求都跑兩次。
 *   hydration 差異由 <html suppressHydrationWarning> 處理。
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="dawnline-theme">
      <TooltipProvider>
        <AuthProvider>
          <PwaProvider>{children}</PwaProvider>
        </AuthProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
