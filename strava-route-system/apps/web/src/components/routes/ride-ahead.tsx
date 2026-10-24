"use client";

import type { ReactNode } from "react";
import { LocateFixed, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { usePositionOnRoute } from "@/hooks/usePositionOnRoute";
import { kmRangeOf } from "@/lib/routes/recon-geo";

type PositionOnRoute = ReturnType<typeof usePositionOnRoute>;
type PositionState = PositionOnRoute["state"];

/** 定位結果需要使用者自己放置位置（定位不準、不在路線上、沒有權限、取不到定位、沒有軌跡） */
export function needsPlacement(state: PositionState): boolean {
  return (
    state.status === "inaccurate" ||
    state.status === "off_route" ||
    state.status === "denied" ||
    state.status === "unavailable" ||
    state.status === "no_route"
  );
}

interface RideAheadProps {
  /** 定位狀態與動作（上層持有，軌道放置位置時也要用 choose） */
  position: PositionOnRoute;
  totalKm: number;
  /** 目前生效的里程；null 為整條路線判讀 */
  fromKm: number | null;
  onChange: (km: number | null) => void;
  /** 第二行的判讀條件（出發時間、運動類型） */
  children?: ReactNode;
}

const SEGMENT =
  "flex min-h-10 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default";

/**
 * 判讀範圍：一張卡片放齊所有判讀條件。
 * 第一行分段切換 [整條路線 | 從我的位置]；第二行出發時間與運動類型（children）。
 * 定位不準、拒絕定位時不猜，也不跳數字輸入框：提示使用者拖曳上方軌道到自己的位置（見 RouteTrack 的放置模式）。
 */
export function RideAhead({ position, totalKm, fromKm, onChange, children }: RideAheadProps) {
  const { state, locate, choose, dismiss } = position;
  const riding = fromKm != null;
  const locating = state.status === "locating";
  const placing = !riding && needsPlacement(state);

  const exit = () => {
    dismiss();
    onChange(null);
  };

  // 畫面顯示最新定位的里程；判讀里程移動滿 0.5 km 才更新，兩者最多差 0.5 km
  const shownKm = state.status === "on_route" && riding ? roundKm(state.km) : fromKm;
  // 由定位換算的里程才有誤差範圍；手動放置後 state 會被 reset，不顯示範圍
  const range = state.status === "on_route" && shownKm != null ? kmRangeOf(shownKm, state.accuracyM, totalKm) : null;
  const showRange = range != null && range[1] - range[0] >= 0.1;
  const offRoute = state.status === "off_route" && riding;

  return (
    <section aria-label="判讀範圍" className="space-y-3 rounded-lg border border-border bg-card px-4 py-3">
      <div role="group" aria-label="判讀範圍" className="grid grid-cols-[1fr_1.35fr] gap-1 rounded-xl bg-muted p-1">
        <button
          type="button"
          aria-pressed={!riding && !placing}
          onClick={exit}
          className={cn(
            SEGMENT,
            !riding && !placing ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground"
          )}
        >
          整條路線
        </button>
        <button
          type="button"
          aria-pressed={riding || placing}
          onClick={locate}
          disabled={locating}
          className={cn(
            SEGMENT,
            riding
              ? "bg-card font-semibold text-foreground shadow-sm"
              : placing
                ? "bg-card font-semibold text-warning-strong shadow-sm"
                : "text-muted-foreground"
          )}
        >
          <LocateFixed className="size-4 shrink-0" aria-hidden />
          {locating ? (
            "定位中…"
          ) : riding ? (
            <span className="truncate">
              從我的位置 <span className="font-mono">{(shownKm ?? fromKm).toFixed(1)} km</span>
            </span>
          ) : (
            "從我的位置"
          )}
        </button>
      </div>

      {riding && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground" role="status">
          <span>
            {offRoute
              ? `你不在這條路線上（離路約 ${distanceLabel(state.distKm)}），前方仍從 ${fromKm.toFixed(1)} km 起算`
              : showRange
                ? `定位誤差約 ${range[0].toFixed(1)}–${range[1].toFixed(1)} km，畫面開著時會自動更新`
                : state.status === "on_route"
                  ? "畫面開著時會自動更新"
                  : `依你放在軌道上的 ${fromKm.toFixed(1)} km 判讀前方`}
          </span>
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            className="cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
          >
            {locating ? "定位中…" : "重新定位"}
          </button>
        </p>
      )}

      {state.status === "ambiguous" && (
        <div className="space-y-1.5" role="status">
          <p className="text-sm text-foreground">這裡會經過不只一次，你在哪一段？</p>
          <div className="flex flex-wrap gap-2">
            {state.candidates.map((km, i) => (
              <Button key={km} size="sm" variant="outline" onClick={() => choose(km)}>
                第 {i + 1} 次經過・{km.toFixed(1)} km
              </Button>
            ))}
          </div>
        </div>
      )}

      {placing && (
        <div
          className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground"
          role="status"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
          <p>
            {placementMessage(state)}拖曳上方軌道到你的位置。
            <button
              type="button"
              onClick={locate}
              className="ml-1 cursor-pointer font-medium text-primary underline-offset-2 hover:underline"
            >
              重新定位
            </button>
          </p>
        </div>
      )}

      {children}
    </section>
  );
}

function placementMessage(state: PositionState): string {
  switch (state.status) {
    case "inaccurate":
      return `定位不準（誤差約 ${Math.round(state.accuracyM)} m），`;
    case "off_route":
      return `你不在這條路線上（離路約 ${distanceLabel(state.distKm)}），`;
    case "denied":
      return "沒有定位權限，";
    case "no_route":
      return "這條路線沒有軌跡資料，";
    default:
      return "取不到定位，";
  }
}

const roundKm = (km: number) => Math.round(km * 10) / 10;

const distanceLabel = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
