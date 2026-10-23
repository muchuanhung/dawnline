"use client";

import { cn } from "@/lib/utils";
import type { Hazard } from "@/lib/routes/recon-geo";
import { groupRouteEvents, type RouteEvent } from "@/lib/routes/road-events";
import type { RouteEventsState } from "@/hooks/useRouteBriefing";
import type { TrackZone } from "@/lib/routes/route-track";
import { HAZARD_ROW_GRID, HazardRowContent, NoticeRowContent } from "@/components/verdict/hazard-row";

const ROW = cn(
  HAZARD_ROW_GRID,
  "cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
);

/** 里程 → 預估到達時間；沒有行程設定（例如沙盤頁）時不顯示 */
type EtaOf = ((km: number) => string) | undefined;

function HazardRows({
  hazards,
  positionKm,
  activeZone,
  onSelect,
  etaOf,
}: {
  hazards: Hazard[];
  positionKm: number;
  activeZone: TrackZone | null;
  onSelect: (hazard: Hazard) => void;
  etaOf: EtaOf;
}) {
  return (
    <ul className="divide-y divide-border/60 border-y border-border/60">
      {hazards.map((h) => {
        // 停在示警路段時，路段內的示警都算「目前位置」（合併後的路段起點不一定落在每個示警範圍內）
        const isHere = activeZone
          ? activeZone.hazards.some((z) => z.id === h.id)
          : positionKm >= h.startKm && positionKm <= h.endKm;
        return (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => onSelect(h)}
              aria-current={isHere ? "location" : undefined}
              className={cn(ROW, isHere && "bg-muted/60")}
            >
              <HazardRowContent hazard={h} eta={etaOf?.(h.startKm)} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 不影響判定的路況（施工、壅塞、活動）：中性色，點擊一樣跳到該處 */
function NoticeRows({ events, onJump, etaOf }: { events: RouteEvent[]; onJump: (km: number) => void; etaOf: EtaOf }) {
  return (
    <ul className="divide-y divide-border/60 border-y border-border/60">
      {events.map((e) => (
        <li key={e.id}>
          <button type="button" onClick={() => onJump(e.km)} className={ROW}>
            <NoticeRowContent event={e} eta={etaOf?.(e.km)} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function EventsStatus({ state }: { state: RouteEventsState }) {
  if (state.loading) return <p className="text-xs text-muted-foreground">路況事件載入中…</p>;
  if (state.error) return <p className="text-xs text-muted-foreground">路況事件暫時取不到，請稍後再試。</p>;
  return (
    <p className="text-xs text-muted-foreground">
      路況事件：TDX 即時道路事件，約每 10 分鐘更新
      {state.failedCounties.length > 0 && `（${state.failedCounties.join("、")}暫時取不到）`}
    </p>
  );
}

/**
 * 第 2 層：會影響判定的示警（天氣、災害、事故、管制、異常告警），依里程排序；點擊跳到該處。
 * 其下為不影響判定的沿線路況，「其他的施工」收合成一行。
 * 路線頁傳入 onSelectHazard／activeZone，點示警時與軌道一樣停到示警路段；沒傳時直接跳到示警起點。
 */
export function HazardList({
  hazards,
  roadEvents,
  positionKm,
  activeZone = null,
  onJump,
  onSelectHazard,
  etaOf,
}: {
  hazards: Hazard[];
  roadEvents?: RouteEventsState;
  positionKm: number;
  /** 展開說明中的示警路段 */
  activeZone?: TrackZone | null;
  /** 點沿線路況（以及沒有 onSelectHazard 時的示警）跳到該里程 */
  onJump: (km: number) => void;
  /** 點示警：交給上層決定停到哪個停點 */
  onSelectHazard?: (hazard: Hazard) => void;
  etaOf?: EtaOf;
}) {
  const { notices, routine } = groupRouteEvents(roadEvents?.events ?? []);

  return (
    <section aria-labelledby="hazard-list-title" className="space-y-2">
      <h3 id="hazard-list-title" className="scroll-mt-20 text-sm font-semibold text-foreground">
        沿途示警
        {hazards.length > 0 && (
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{hazards.length}</span>
        )}
      </h3>

      {hazards.length === 0 ? (
        <p className="text-sm text-muted-foreground">沿途沒有示警</p>
      ) : (
        <HazardRows
          hazards={hazards}
          positionKm={positionKm}
          activeZone={activeZone}
          onSelect={onSelectHazard ?? ((h) => onJump(h.startKm))}
          etaOf={etaOf}
        />
      )}

      {notices.length > 0 && (
        <div className="space-y-2 pt-3">
          <h4 className="text-sm font-semibold text-foreground">
            沿線路況
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{notices.length}</span>
          </h4>
          <NoticeRows events={notices} onJump={onJump} etaOf={etaOf} />
        </div>
      )}

      {routine.length > 0 && (
        <details className="group pt-1">
          <summary className="cursor-pointer py-1.5 text-sm text-muted-foreground">
            沿線 {routine.length} 處其他施工（多為道路維護）
            <span className="ml-1 text-primary group-open:hidden">展開</span>
          </summary>
          <NoticeRows events={routine} onJump={onJump} etaOf={etaOf} />
        </details>
      )}

      {roadEvents && <EventsStatus state={roadEvents} />}
    </section>
  );
}
