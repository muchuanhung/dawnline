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
import { atisCctvId, isBlockedByCSP, hasWhiteBorderInEmbed } from "@/lib/cctv/embed-policy";
import { AtisFlvFrame } from "./atis-flv-frame";

export const CCTV_STATUS: Record<CctvMarker["status"], { text: string; dot: string }> = {
  online: { text: "直播", dot: "bg-success" },
  degraded: { text: "不穩", dot: "bg-warning" },
  offline: { text: "離線", dot: "bg-muted-foreground" },
  // 沒探測過連線狀態：中性灰「影像」，不可看起來像直播
  unknown: { text: "影像", dot: "bg-muted-foreground" },
};

/** 游標離最近鏡頭超過這個距離，就明講「此處附近沒有監視器」 */
const CCTV_FAR_KM = 3;

/** 鏡頭標題：「鏡頭名・行政區」；location 常與鏡頭名重複，不用它 */
function cctvTitle(marker: CctvMarker): string {
  return marker.township && !marker.name.includes(marker.township)
    ? `${marker.name}・${marker.township}`
    : marker.name;
}

/** 影像本體：新北 ATIS 用 FLV 播放、可內嵌就用 iframe、被擋就給外連，離線或沒有網址就直說 */
function CctvFrame({ marker, large = false }: { marker: CctvMarker; large?: boolean }) {
  // iframe 無法偵測載入失敗（失敗也會觸發 onLoad），這裡只用來收掉載入指示；
  // 看不到畫面時靠標題列的外連按鈕。父層以 key={marker.id} 換鏡頭時重置
  const [loaded, setLoaded] = useState(false);
  const url = marker.videoUrl;

  if (marker.status === "offline") {
    return <p className="text-sm text-muted-foreground">訊號中斷</p>;
  }
  if (!url) {
    return <p className="text-sm text-muted-foreground">此鏡頭沒有影像網址</p>;
  }
  // 被擋的來源只能外連；新北 ATIS 鏡頭先試 FLV 播放，失敗再退回外連
  const externalOnly = (
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
  const atisId = atisCctvId(url);
  if (atisId) {
    return <AtisFlvFrame cctvId={atisId} title={marker.name} fallback={externalOnly} />;
  }
  if (isBlockedByCSP(url)) return externalOnly;
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
          <div className="flex shrink-0 items-center gap-1">
            {marker.videoUrl && marker.status !== "offline" && (
              <Button asChild size="icon" variant="ghost" className="h-8 w-8">
                <a href={marker.videoUrl} target="_blank" rel="noopener noreferrer" aria-label="在新分頁開啟直播">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
            <DialogTrigger asChild>
              <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="放大監視器畫面">
                <Maximize2 className="h-4 w-4" />
              </Button>
            </DialogTrigger>
          </div>
        </div>

        <div className="relative flex h-44 items-center justify-center overflow-hidden bg-black sm:h-52">
          <CctvFrame key={marker.id} marker={marker} />
        </div>
      </div>

      {/* 手機與平板（< lg）改全螢幕黑底：置中小框放大後幾乎沒比原本大；橫放時影像撐滿高度 */}
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
    </Dialog>
  );
}
