"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Spinner from "@/components/ui/Spinner";

/** 這段時間內沒開始播放就視為失敗（CORS 被擋、串流沒資料、瀏覽器不支援） */
const PLAY_TIMEOUT_MS = 10_000;

/**
 * 新北 ATIS 鏡頭：伺服器查出 HTTP-FLV 串流網址，用 mpegts.js 播放到 video。
 * 任何一步失敗都改顯示 fallback（外連按鈕），不會停在黑框
 * iPhone 需 iOS 17.1 以上（ManagedMediaSource）；不支援時 isSupported() 為 false，直接走 fallback
 */
export function AtisFlvFrame({ cctvId, title, fallback }: { cctvId: string; title: string; fallback: ReactNode }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"loading" | "playing" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    let player: import("mpegts.js").default.Player | null = null;
    const fail = () => {
      if (!cancelled) setState("failed");
    };
    const timer = window.setTimeout(fail, PLAY_TIMEOUT_MS);

    (async () => {
      // mpegts.js 依賴 window／MediaSource，只能在瀏覽器端動態載入
      const { default: mpegts } = await import("mpegts.js");
      if (cancelled) return;
      if (!mpegts.isSupported()) return fail();

      const res = await fetch(`/api/cctv/stream-url?id=${encodeURIComponent(cctvId)}`);
      if (!res.ok) return fail();
      const { url } = (await res.json()) as { url?: string };
      const video = videoRef.current;
      if (cancelled) return;
      if (!url || !video) return fail();

      video.addEventListener(
        "playing",
        () => {
          window.clearTimeout(timer);
          if (!cancelled) setState("playing");
        },
        { once: true }
      );
      mpegts.LoggingControl.applyConfig({ enableAll: false });
      player = mpegts.createPlayer(
        { type: "flv", isLive: true, url },
        { enableWorker: false, liveBufferLatencyChasing: true }
      );
      player.on(mpegts.Events.ERROR, fail);
      player.attachMediaElement(video);
      player.load();
      // 靜音才能自動播放（iOS 與 Chrome 的自動播放政策）
      void video.play()?.catch(() => undefined);
    })().catch(fail);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (player) {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      }
    };
  }, [cctvId]);

  if (state === "failed") return <>{fallback}</>;

  return (
    <>
      {state === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label="影像載入中">
          <Spinner size="sm" dotClassName="bg-muted-foreground" />
        </div>
      )}
      <video
        ref={videoRef}
        title={title}
        muted
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full bg-black object-contain"
      />
    </>
  );
}
