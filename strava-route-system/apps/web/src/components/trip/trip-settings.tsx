"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import {
  ACTIVITIES,
  ACTIVITY,
  climbMinFor,
  DEPARTURE_OFFSETS_H,
  departureAfter,
  formatClock,
  type Activity,
} from "@/lib/routes/trip";
import { saveTrip } from "@/lib/routes/trip-storage";
import { SpeedSheet } from "@/components/trip/speed-sheet";

const SELECT =
  "h-9 rounded-lg border border-border bg-card px-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** 目前出發時間對應哪個選項；對不上（例如選了之後過了一段時間）時回 null，顯示為自訂時間 */
function offsetOf(departure: Date | null, now: Date): number | null {
  if (!departure) return 0;
  return (
    DEPARTURE_OFFSETS_H.find((h) => Math.abs(departureAfter(now, h).getTime() - departure.getTime()) < 15 * 60_000) ??
    null
  );
}

/**
 * 行程設定：出發時間與運動類型，存在網址（?depart=&activity=），可分享、可上一頁。
 * 今日判讀與路線頁共用；改變後伺服器依新設定重新判讀。
 * 目前生效的設定另記在 sessionStorage，從導覽列切頁回來時沿用（見 TripNavLink）。
 * 路線頁途中模式（fromKm）：出發時間由目前位置反推，改為唯讀顯示，避免與「現在」矛盾；運動類型照常可改。
 */
export function TripSettings({
  departure,
  activity,
  speedKmh,
  defaultActivity,
  explicitActivity,
  explicitDeparture,
  fromKm = null,
  onEditSpeed,
  speedRoute,
  className,
}: {
  /** 判讀實際用的出發時間（ISO） */
  departure: string;
  /** 判讀實際用的運動類型與均速 */
  activity: Activity;
  speedKmh: number;
  /** 路線類型對應的預設運動類型 */
  defaultActivity: Activity;
  /** 網址上有指定運動類型；沒有時為依路線類型 */
  explicitActivity: Activity | null;
  /** 網址上有指定出發時間；沒有時為現在 */
  explicitDeparture: string | null;
  /** 途中模式的目前里程；有值時出發時間唯讀 */
  fromKm?: number | null;
  /** 打開外層的均速設定面板（路線頁：與路線卡的速度按鈕共用同一個面板） */
  onEditSpeed?: () => void;
  /**
   * 沒有外層面板時（今日判讀），由這裡自己開均速設定面板，試算用這條路線的距離與爬升。
   * 兩者都沒提供時不顯示「調整速度」。
   */
  speedRoute?: { totalKm: number; ascentM: number; elevationGainM: number };
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const now = new Date();
  const offset = offsetOf(explicitDeparture ? new Date(explicitDeparture) : null, now);
  const [speedOpen, setSpeedOpen] = useState(false);
  const editSpeed = onEditSpeed ?? (speedRoute ? () => setSpeedOpen(true) : undefined);

  // Remember what the page currently shows so the nav links can restore it
  useEffect(() => {
    saveTrip({ depart: explicitDeparture, activity: explicitActivity });
  }, [explicitDeparture, explicitActivity]);

  const update = (key: "depart" | "activity", value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", pending && "opacity-60", className)}>
      {fromKm != null ? (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          出發
          <span className="font-mono font-medium text-foreground">{formatClock(new Date(departure), now)}</span>
        </span>
      ) : (
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          出發
          <select
            className={SELECT}
            value={offset ?? "custom"}
            onChange={(e) => {
              const h = Number(e.target.value);
              update("depart", h === 0 ? null : departureAfter(new Date(), h).toISOString());
            }}
          >
            {offset === null && <option value="custom">{formatClock(new Date(departure), now)}</option>}
            {DEPARTURE_OFFSETS_H.map((h) => (
              <option key={h} value={h}>
                {h === 0 ? "現在" : `${h} 小時後`}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
        運動
        <select
          className={SELECT}
          value={explicitActivity ?? ""}
          onChange={(e) => update("activity", e.target.value || null)}
        >
          <option value="">依路線類型（{ACTIVITY[defaultActivity].label}）</option>
          {ACTIVITIES.map((a) => (
            <option key={a} value={a}>
              {ACTIVITY[a].label}
            </option>
          ))}
        </select>
      </label>
      <p className="w-full text-xs text-muted-foreground">
        {fromKm != null ? (
          <>
            依你在 <span className="font-mono">{fromKm.toFixed(1)} km</span>、
          </>
        ) : (
          <>
            依 <span className="font-mono">{formatClock(new Date(departure), now)}</span> 出發、
          </>
        )}
        {ACTIVITY[activity].label}均速{" "}
        {speedKmh} km/h
        {climbMinFor(activity, speedKmh) > 0 && `、每爬升 100 m 加 ${formatClimbMin(climbMinFor(activity, speedKmh))} 分鐘`}{" "}
        估算{fromKm != null ? "前方" : ""}各段抵達時間，再對照該時段的預報。
        {editSpeed && (
          <button type="button" onClick={editSpeed} className="ml-1 font-medium text-primary underline-offset-2 hover:underline">
            調整速度
          </button>
        )}
      </p>
      {!onEditSpeed && speedRoute && (
        <SpeedSheet
          open={speedOpen}
          onOpenChange={setSpeedOpen}
          activity={activity}
          speedKmh={speedKmh}
          ascentM={speedRoute.ascentM}
          totalKm={speedRoute.totalKm}
          elevationGainM={speedRoute.elevationGainM}
        />
      )}
    </div>
  );
}

/** 爬升加時（分鐘）最多顯示一位小數 */
function formatClimbMin(min: number): string {
  return String(Math.round(min * 10) / 10);
}
