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

/** 游標離最近鏡頭超過這個距離，就明講「此處附近沒有監視器」 */
export const CCTV_FAR_KM = 3;

/** 鏡頭標題：「鏡頭名・行政區」；location 常與鏡頭名重複，不用它 */
export function cctvTitle(marker: CctvMarker): string {
  return marker.township && !marker.name.includes(marker.township)
    ? `${marker.name}・${marker.township}`
    : marker.name;
}

/**
 * 影像本體：可內嵌就用 iframe，被擋就給外連，沒有網址就直說
 * 不顯示連線狀態：多數來源從伺服器探測不到（播放頁或擋海外 IP），見 PR #49
 */
export function CctvFrame({ marker, large = false }: { marker: CctvMarker; large?: boolean }) {
  // iframe 無法偵測載入失敗（失敗也會觸發 onLoad），這裡只用來收掉載入指示；
  // 看不到畫面時靠標題列的外連按鈕。父層以 key={marker.id} 換鏡頭時重置
  const [loaded, setLoaded] = useState(false);
  const url = marker.videoUrl;

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

/** 鏡頭相對目前位置：沿路線前方或後方幾 km；幾乎重合時不顯示 */
function offsetLabel(offsetKm: number): string | null {
  if (Math.abs(offsetKm) < 0.1) return null;
  return `距目前位置${offsetKm > 0 ? "前方" : "後方"} ${Math.abs(offsetKm).toFixed(1)} km`;
}

/**
 * 放大畫面（放在 <Dialog> 內）
 * 手機與平板（< lg）改全螢幕黑底：置中小框放大後幾乎沒比原本大；橫放時影像撐滿高度
 */
export function CctvFullscreen({ marker, title }: { marker: CctvMarker; title: string }) {
  return (
    <DialogContent
      className={cn(
        "max-w-4xl gap-3 p-4 sm:p-6",
        "max-lg:inset-0 max-lg:left-0 max-lg:top-0 max-lg:h-[100dvh] max-lg:max-w-none max-lg:translate-x-0 max-lg:translate-y-0",
        "max-lg:grid-rows-[auto_minmax(0,1fr)_auto] max-lg:rounded-none! max-lg:border-0 max-lg:bg-black max-lg:p-3",
        "max-lg:data-[state=open]:slide-in-from-left-0 max-lg:data-[state=open]:slide-in-from-top-0",
        "max-lg:data-[state=closed]:slide-out-to-left-0 max-lg:data-[state=closed]:slide-out-to-top-0"
      )}
    >
      <DialogHeader className="flex-row items-start justify-between gap-2 space-y-0 text-left">
        <DialogTitle className="min-w-0 text-base leading-snug max-lg:text-white">
          {title}・{marker.km.toFixed(1)} km
        </DialogTitle>
        <DialogClose asChild>
          <Button
            size="icon"
            variant="ghost"
            className="-mr-2 -mt-1 h-10 w-10 shrink-0 max-lg:text-white max-lg:hover:bg-white/10 max-lg:hover:text-white"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </Button>
        </DialogClose>
      </DialogHeader>
      <div className="flex min-h-0 items-center justify-center">
        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-md bg-black max-lg:rounded-none max-lg:landscape:h-full max-lg:landscape:w-auto">
          <CctvFrame key={marker.id} marker={marker} large />
        </div>
      </div>
      <div className="space-y-1">
        <p className="hidden text-center text-xs text-white/60 max-lg:portrait:block">橫放手機可看大畫面</p>
        {marker.lastUpdated && (
          <p className="text-xs text-muted-foreground max-lg:text-white/60">{marker.lastUpdated}</p>
        )}
      </div>
    </DialogContent>
  );
}
