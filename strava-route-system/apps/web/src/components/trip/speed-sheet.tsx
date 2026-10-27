"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { saveSpeed } from "@/lib/routes/speed-storage";
import {
  ACTIVITY,
  SPEED_LEVELS,
  SPEED_RANGE,
  formatDuration,
  speedLevelLabel,
  tripDuration,
  type Activity,
} from "@/lib/routes/trip";

const DESKTOP_QUERY = "(min-width: 1024px)";

const TITLE: Record<Activity, string> = { cycling: "你的騎乘速度", running: "你的跑步速度", hiking: "你的健行速度" };

/**
 * 平地均速設定面板：手機為底部 Drawer、桌機為置中對話框，內容相同。
 * 拖滑桿時只在畫面上即時試算「平地＋爬升」，按「套用」才寫入 cookie 並重新整理伺服器資料（重新判讀）。
 */
export function SpeedSheet({
  open,
  onOpenChange,
  activity,
  speedKmh,
  profile,
  totalKm,
  elevationGainM,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activity: Activity;
  /** 目前生效的平地均速 */
  speedKmh: number;
  profile: readonly (readonly [number, number])[];
  totalKm: number;
  elevationGainM: number;
}) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    setDesktop(mq.matches);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const body = (
    <SpeedSheetBody
      key={`${activity}|${speedKmh}|${open}`}
      activity={activity}
      speedKmh={speedKmh}
      profile={profile}
      totalKm={totalKm}
      elevationGainM={elevationGainM}
      onDone={() => onOpenChange(false)}
    />
  );
  const description = "影響各段抵達時間；判讀會對照抵達時段的預報";

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{TITLE[activity]}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="bg-card pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-foreground">{TITLE[activity]}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4">{body}</div>
      </DrawerContent>
    </Drawer>
  );
}

function SpeedSheetBody({
  activity,
  speedKmh,
  profile,
  totalKm,
  elevationGainM,
  onDone,
}: {
  activity: Activity;
  speedKmh: number;
  profile: readonly (readonly [number, number])[];
  totalKm: number;
  elevationGainM: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // 草稿值：拖動時即時試算，不打 API
  const [draft, setDraft] = useState(speedKmh);
  const { min, max, step } = SPEED_RANGE[activity];
  const defaultSpeed = ACTIVITY[activity].speedKmh;
  const { flatHours, climbHours } = tripDuration(activity, profile, totalKm, draft);
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  const apply = (value: number | null) => {
    saveSpeed(activity, value);
    // 伺服器頁面重新讀 cookie → 新的行程設定 → 重新判讀
    startTransition(() => router.refresh());
    onDone();
  };

  return (
    <div className={cn("space-y-4", pending && "opacity-60")}>
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">
            {speedLevelLabel(activity, draft)}
          </span>
          <span className="font-mono text-lg font-semibold text-foreground">{draft} km/h</span>
        </div>
        {/* data-vaul-no-drag：拖滑桿時不要拖動整個底部面板 */}
        <input
          type="range"
          data-vaul-no-drag
          aria-label="平地均速"
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={(e) => setDraft(Number(e.target.value))}
          className="mt-3 w-full accent-primary"
        />
        <div className="relative mt-1 h-8 text-xs text-muted-foreground">
          {SPEED_LEVELS[activity].map((level) => (
            <button
              key={level.speedKmh}
              type="button"
              onClick={() => setDraft(level.speedKmh)}
              style={{ left: `${pct(level.speedKmh)}%` }}
              className={cn(
                "absolute -translate-x-1/2 whitespace-nowrap rounded px-1 py-0.5 hover:text-foreground",
                draft === level.speedKmh && "font-semibold text-primary"
              )}
            >
              {level.label} {level.speedKmh}
            </button>
          ))}
        </div>
      </div>

      {/* 時間拆解：讓爬升多花的時間看得到 */}
      <dl className="space-y-1.5 rounded-xl bg-secondary/60 p-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">平地 {totalKm.toFixed(1)} km</dt>
          <dd className="font-mono font-medium">{formatDuration(flatHours)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">爬升 {elevationGainM} m</dt>
          <dd className="font-mono font-medium">＋{formatDuration(climbHours)}</dd>
        </div>
        <div className="flex justify-between border-t border-border pt-1.5 font-semibold">
          <dt>預估</dt>
          <dd className="font-mono">{formatDuration(flatHours + climbHours)}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button variant="outline" size="lg" disabled={draft === defaultSpeed && speedKmh === defaultSpeed} onClick={() => apply(null)}>
          恢復預設
        </Button>
        <Button size="lg" onClick={() => apply(draft)}>
          套用
        </Button>
      </div>
    </div>
  );
}
