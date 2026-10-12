"use client";

import { useState } from "react";
import { Camera, ExternalLink, Maximize2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import Spinner from "@/components/ui/Spinner";
import { cn } from "@/lib/utils";
import type { CctvMarker } from "@/lib/routes/recon-geo";
import { isBlockedByCSP, hasWhiteBorderInEmbed } from "@/lib/cctv/embed-policy";

export const CCTV_STATUS: Record<CctvMarker["status"], { text: string; dot: string }> = {
  online: { text: "直播", dot: "bg-success" },
  degraded: { text: "不穩", dot: "bg-warning" },
  offline: { text: "離線", dot: "bg-muted-foreground" },
  // 沒探測過連線狀態：空心灰點，不可看起來像直播
  unknown: { text: "未確認", dot: "border border-muted-foreground bg-transparent" },
};

/** 游標離最近鏡頭超過這個距離，就明講「此處附近沒有監視器」 */
const CCTV_FAR_KM = 3;

/** 鏡頭標題：「鏡頭名・行政區」；location 常與鏡頭名重複，不用它 */
function cctvTitle(marker: CctvMarker): string {
  return marker.township && !marker.name.includes(marker.township)
    ? `${marker.name}・${marker.township}`
    : marker.name;
}

/** 影像本體：可內嵌就用 iframe，被擋就給外連，離線或沒有網址就直說 */
function CctvFrame({ marker, large = false }: { marker: CctvMarker; large?: boolean }) {
  // iframe 無法偵測載入失敗（失敗也會觸發 onLoad），這裡只用來收掉載入指示；
  // 看不到畫面時靠框外固定的「開啟原始直播」連結。父層以 key={marker.id} 換鏡頭時重置
  const [loaded, setLoaded] = useState(false);
  const url = marker.videoUrl;

  if (marker.status === "offline") {
    return <p className="text-sm text-muted-foreground">訊號中斷</p>;
  }
  if (!url) {
    return <p className="text-sm text-muted-foreground">此鏡頭沒有影像網址</p>;
  }
  if (isBlockedByCSP(url)) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 text-center">
        <p className="text-sm text-muted-foreground">此影像無法內嵌</p>
        <Button asChild size={large ? "default" : "sm"} variant="secondary">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
            開啟直播
          </a>
        </Button>
      </div>
    );
  }
  return (
    <>
      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" role="status" aria-label="影像載入中">
          <Spinner size="sm" dotClassName="bg-muted-foreground" />
        </div>
      )}
      <iframe
        src={url}
        title={marker.name}
        allow="autoplay; fullscreen"
        onLoad={() => setLoaded(true)}
        className={cn(
          "absolute inset-0 h-full w-full origin-center border-0",
          hasWhiteBorderInEmbed(url) && "scale-[1.5]"
        )}
      />
    </>
  );
}

/** 影像框下方固定的外連：內嵌失敗時（http 來源、iOS 不支援的串流）使用者還有路可走 */
function OpenSourceLink({ marker }: { marker: CctvMarker }) {
  const url = marker.videoUrl;
  // 被擋的來源框內已有「開啟直播」按鈕；離線不給連結
  if (!url || marker.status === "offline" || isBlockedByCSP(url)) return null;
  return (
    <div className="flex justify-end">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 py-2 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        看不到畫面？開啟原始直播
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
  );
}

/** 鏡頭相對目前位置：沿路線前方或後方幾 km；幾乎重合時不顯示 */
function offsetLabel(offsetKm: number): string | null {
  if (Math.abs(offsetKm) < 0.1) return null;
  return `距目前位置${offsetKm > 0 ? "前方" : "後方"} ${Math.abs(offsetKm).toFixed(1)} km`;
}

/** 第 4 層：目前位置對應的監視器 */
export function CctvViewer({
  marker,
  positionKm,
  onJump,
}: {
  marker: CctvMarker | null;
  positionKm: number;
  /** 把游標移到鏡頭所在里程（附近沒有鏡頭時用） */
  onJump?: (km: number) => void;
}) {
  if (!marker) {
    return (
      <div className="flex h-44 items-center justify-center gap-2 bg-muted/40 text-sm text-muted-foreground sm:h-52">
        <Camera className="h-4 w-4" aria-hidden />
        此處無監視器
      </div>
    );
  }

  const status = CCTV_STATUS[marker.status];
  const title = cctvTitle(marker);
  const offsetKm = marker.km - positionKm;
  const offset = offsetLabel(offsetKm);
  const isFar = Math.abs(offsetKm) > CCTV_FAR_KM;

  return (
    <Dialog>
      <div className="space-y-2">
        {isFar && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            <span>
              目前位置 {CCTV_FAR_KM} km 內沒有監視器，以下是最近一台
            </span>
            {onJump && (
              <Button size="sm" variant="secondary" onClick={() => onJump(marker.km)}>
                跳到 {marker.km.toFixed(1)} km
              </Button>
            )}
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p className="flex min-w-0 items-center gap-2 text-sm">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", status.dot)} aria-hidden />
              <span className="shrink-0 whitespace-nowrap text-muted-foreground">{status.text}</span>
              <span className="truncate font-medium text-foreground">{title}</span>
            </p>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              {marker.km.toFixed(1)} km
              {offset && <span className="font-sans">・{offset}</span>}
            </p>
          </div>
          <DialogTrigger asChild>
            <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label="放大監視器畫面">
              <Maximize2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        </div>

        <div className="relative flex h-44 items-center justify-center overflow-hidden bg-black sm:h-52">
          <CctvFrame key={marker.id} marker={marker} />
        </div>
        <OpenSourceLink marker={marker} />
      </div>

      <DialogContent className="max-w-4xl gap-3 p-4 sm:p-6">
        <DialogHeader className="flex-row items-start justify-between gap-2 space-y-0 text-left">
          <DialogTitle className="min-w-0 text-base leading-snug">
            {title}・{marker.km.toFixed(1)} km
          </DialogTitle>
          <DialogClose asChild>
            <Button size="icon" variant="ghost" className="-mr-2 -mt-1 h-9 w-9 shrink-0" aria-label="關閉">
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </DialogHeader>
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-black">
          <CctvFrame key={marker.id} marker={marker} large />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          {marker.lastUpdated && (
            <p className="text-xs text-muted-foreground">{marker.lastUpdated}</p>
          )}
          <div className="ml-auto">
            <OpenSourceLink marker={marker} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
