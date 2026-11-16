"use client";

import { useEffect } from "react";
import { captureClientError } from "@/lib/observability/sentry-client";

// 根 layout 也壞掉時才會用到，所以不能依賴 global.css 或 Providers，樣式寫在 inline。
// 這頁不顯示任何判定結果：出錯就是不知道，不能讓使用者誤以為安全。
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Sentry 還沒載入時先暫存並觸發載入，初始化後補送
    captureClientError(error);
  }, [error]);

  return (
    <html lang="zh-TW">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f4f3ee",
          color: "#1e3a29",
          fontFamily: "system-ui, -apple-system, 'Noto Sans TC', sans-serif",
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 24, margin: "0 0 12px" }}>頁面出了點問題</h1>
          <p style={{ margin: "0 0 24px", lineHeight: 1.7 }}>
            這次沒有辦法顯示判讀結果。請重新載入；如果還是失敗，出發前請以官方預報為準。
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 24px",
              borderRadius: 12,
              border: "1px solid #1e3a29",
              background: "#1e3a29",
              color: "#fff",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            重新載入
          </button>
        </main>
      </body>
    </html>
  );
}
