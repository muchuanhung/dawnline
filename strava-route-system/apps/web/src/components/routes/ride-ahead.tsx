"use client";

import { useEffect, useState } from "react";
import { LocateFixed, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePositionOnRoute } from "@/hooks/usePositionOnRoute";
import { kmRangeOf, type RoutePolylineKm } from "@/lib/routes/recon-geo";
import { ACTIVITY, type Activity } from "@/lib/routes/trip";

interface RideAheadProps {
  routeId: string;
  polyline: RoutePolylineKm | null;
  totalKm: number;
  /** 目前生效的里程；null 為整條路線判讀 */
  fromKm: number | null;
  /** 判讀實際用的運動類型，用來說明前方 ETA 怎麼估 */
  activity: Activity | null;
  onChange: (km: number | null) => void;
}

/**
 * 途中模式「從我現在位置往前看」：定位換算里程後只判讀前方。
 * 定位不準、不在路線上、往返路線無法判斷、拒絕定位時都不猜，改讓使用者手動選里程。
 */
export function RideAhead({ routeId, polyline, totalKm, fromKm, activity, onChange }: RideAheadProps) {
  const { state, locate, remember, reset } = usePositionOnRoute(routeId, polyline);
  const [manualOpen, setManualOpen] = useState(false);

  // 定位成功且只對到一個里程：直接套用
  useEffect(() => {
    if (state.status === "on_route") {
      onChange(roundKm(state.km));
      setManualOpen(false);
    }
  }, [state, onChange]);

  const choose = (km: number) => {
    remember(km);
    onChange(km);
    setManualOpen(false);
    reset();
  };

  const exit = () => {
    onChange(null);
    setManualOpen(false);
    reset();
  };

  const locating = state.status === "locating";
  // 由定位換算的里程才有誤差範圍；手動輸入或選擇後 state 會被 reset，不顯示範圍
  const range = state.status === "on_route" && fromKm != null ? kmRangeOf(fromKm, state.accuracyM, totalKm) : null;
  const showRange = range != null && range[1] - range[0] >= 0.1;
  const needsManual =
    state.status === "inaccurate" ||
    state.status === "off_route" ||
    state.status === "denied" ||
    state.status === "unavailable" ||
    state.status === "no_route";

  return (
    <section aria-label="從我現在位置往前看" className="space-y-2 rounded-lg border border-border bg-card px-4 py-3">
      {fromKm == null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={locate} disabled={locating}>
            <LocateFixed aria-hidden />
            {locating ? "定位中…" : "從我現在位置往前看"}
          </Button>
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setManualOpen((v) => !v)}
          >
            手動選里程
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-foreground">
            目前在 <span className="font-mono font-semibold">{fromKm.toFixed(1)} km</span>
            {showRange && (
              <span className="text-muted-foreground">
                （定位誤差，約 {range[0].toFixed(1)}–{range[1].toFixed(1)} km）
              </span>
            )}
            ，以下只判讀前方路段
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={locate} disabled={locating}>
              <LocateFixed aria-hidden />
              {locating ? "定位中…" : "重新定位"}
            </Button>
            <Button size="sm" variant="ghost" onClick={exit} aria-label="回到整條路線判讀">
              <X aria-hidden />
              整條路線
            </Button>
          </div>
        </div>
      )}

      {fromKm != null && activity && (
        <p className="text-xs text-muted-foreground">
          以現在為抵達 {fromKm.toFixed(1)} km 的時間，依{ACTIVITY[activity].label}均速 {ACTIVITY[activity].speedKmh} km/h
          {ACTIVITY[activity].climbMinPer100m > 0 && `、每爬升 100 m 加 ${ACTIVITY[activity].climbMinPer100m} 分鐘`}{" "}
          估算前方抵達時間。位置只在手機上換算里程，不會上傳。
        </p>
      )}

      {state.status === "ambiguous" && (
        <div className="space-y-1.5" role="status">
          <p className="text-sm text-foreground">這條路線會經過這裡不只一次，你現在在哪一段？</p>
          <div className="flex flex-wrap gap-2">
            {state.candidates.map((km, i) => (
              <Button key={km} size="sm" variant="outline" onClick={() => choose(km)}>
                第 {i + 1} 次經過・{km.toFixed(1)} km
              </Button>
            ))}
          </div>
        </div>
      )}

      {needsManual && (
        <p className="text-sm text-muted-foreground" role="status">
          {positionMessage(state)}
        </p>
      )}

      {(manualOpen || needsManual) && <ManualKm totalKm={totalKm} initialKm={fromKm} onSubmit={choose} />}
    </section>
  );
}

function positionMessage(state: ReturnType<typeof usePositionOnRoute>["state"]): string {
  switch (state.status) {
    case "inaccurate":
      return `定位不準（誤差約 ${Math.round(state.accuracyM)} m），請手動選目前里程。`;
    case "off_route":
      return `你不在這條路線上（離路約 ${Math.round(state.distKm * 1000)} m），不提供前方判定；若確定在路線上，可手動選里程。`;
    case "denied":
      return "沒有定位權限，可以手動選目前里程。";
    case "no_route":
      return "這條路線沒有軌跡資料，無法定位，可以手動選目前里程。";
    default:
      return "暫時取不到定位，可以手動選目前里程。";
  }
}

const roundKm = (km: number) => Math.round(km * 10) / 10;

function ManualKm({
  totalKm,
  initialKm,
  onSubmit,
}: {
  totalKm: number;
  initialKm: number | null;
  onSubmit: (km: number) => void;
}) {
  const [value, setValue] = useState(initialKm != null ? String(initialKm) : "");
  const km = Number(value);
  const valid = value !== "" && Number.isFinite(km) && km >= 0 && km <= totalKm;

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSubmit(roundKm(km));
      }}
    >
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        目前里程
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={totalKm}
          step={0.1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-8 w-24"
        />
        <span>/ {totalKm.toFixed(1)} km</span>
      </label>
      <Button type="submit" size="sm" disabled={!valid}>
        確定
      </Button>
    </form>
  );
}
