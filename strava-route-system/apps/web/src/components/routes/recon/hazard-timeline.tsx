"use client";

import { useState } from "react";
import { ChevronRight, Construction, LocateFixed } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Hazard } from "@/lib/routes/recon-geo";
import { CATEGORY_LABEL, groupRouteEvents, type RouteEvent } from "@/lib/routes/road-events";
import { hazardGroups, type HazardGroup, type TrackZone } from "@/lib/routes/route-track";
import type { RouteEventsState } from "@/hooks/useRouteBriefing";
import { KIND_ICON } from "@/components/verdict/hazard-row";

/** 里程 → 預估到達時間；沒有行程設定時不顯示 */
type EtaOf = ((km: number) => string) | undefined;

/** 時間軸上的一列：一段示警（同一處的多個指標併成一列）或一筆不影響判定的路況 */
type TimelineItem = { kind: "group"; km: number; group: HazardGroup } | { kind: "notice"; km: number; event: RouteEvent };

const LEVEL_WORD = { risky: "危險", caution: "注意" } as const;

/** 左欄｜軸線與節點｜內容 */
const ROW = "grid w-full grid-cols-[4.25rem_1.25rem_minmax(0,1fr)] gap-x-2 text-left";

const km1 = (km: number) => km.toFixed(1);

function itemsOf(hazards: Hazard[], notices: RouteEvent[]): TimelineItem[] {
  return [
    ...hazardGroups(hazards).map((group) => ({ kind: "group" as const, km: group.startKm, group })),
    ...notices.map((event) => ({ kind: "notice" as const, km: event.km, event })),
  ].sort((a, b) => a.km - b.km);
}

/** 左欄：里程（路段寫起訖）與預估到達時間 */
function KmCell({ startKm, endKm, eta }: { startKm: number; endKm?: number; eta?: string }) {
  const range = endKm != null && endKm - startKm >= 0.05 ? `${km1(startKm)}–${km1(endKm)}` : `${km1(startKm)} km`;
  return (
    <span className="flex flex-col items-end py-2.5 font-mono text-[13px] leading-tight tabular-nums text-muted-foreground">
      <span>{range}</span>
      {eta && (
        <span className="text-xs">
          <span className="sr-only">預計抵達 </span>
          {eta}
        </span>
      )}
    </span>
  );
}

/** 軸線＋節點：危險實心紅點、注意琥珀圓圈、一般路況灰色小點；等級另有文字，不只靠顏色 */
function Axis({ node }: { node: "risky" | "caution" | "notice" | "end" | null }) {
  return (
    <span className="relative flex justify-center" aria-hidden>
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-border" />
      {node === "risky" && (
        <span className="relative mt-3 flex size-4 items-center justify-center rounded-full bg-destructive text-[11px] font-bold leading-none text-card">
          !
        </span>
      )}
      {node === "caution" && <span className="relative mt-3 size-4 rounded-full border-[3px] border-warning bg-card" />}
      {node === "notice" && <span className="relative mt-[15px] size-2.5 rounded-full bg-muted-foreground/60" />}
      {node === "end" && <span className="relative mt-3.5 size-3 rounded-full border-2 border-muted-foreground bg-card" />}
    </span>
  );
}

/** 一個指標：危險實心、注意外框；色條、圖示、文字同一色系 */
function HazardChip({ hazard }: { hazard: Hazard }) {
  const Icon = KIND_ICON[hazard.kind];
  const risky = hazard.level === "risky";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-1 text-[13px] leading-snug",
        risky ? "border-destructive bg-destructive font-semibold text-card" : "border-warning font-medium text-warning-strong"
      )}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0">{hazard.label}</span>
      <span className="sr-only">（{LEVEL_WORD[hazard.level]}）</span>
    </span>
  );
}

function GroupRow({
  group,
  eta,
  faded,
  isHere,
  isCurrent,
  onSelect,
}: {
  group: HazardGroup;
  eta?: string;
  faded?: boolean;
  /** 你目前所在的路段 */
  isHere: boolean;
  /** 軌道游標停在這段 */
  isCurrent: boolean;
  onSelect: () => void;
}) {
  return (
    <li className={cn(faded && "opacity-50")}>
      <button
        type="button"
        onClick={onSelect}
        aria-current={isCurrent ? "location" : undefined}
        className={cn(
          ROW,
          "cursor-pointer rounded-lg transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isCurrent && "bg-muted/60"
        )}
      >
        <KmCell startKm={group.startKm} endKm={group.endKm} eta={eta} />
        <Axis node={group.level} />
        <span className="flex min-w-0 flex-col gap-1.5 py-2.5 pr-1">
          <span className="flex items-center gap-2 text-xs font-bold">
            <span className={group.level === "risky" ? "text-destructive" : "text-warning-strong"}>
              {LEVEL_WORD[group.level]}
            </span>
            {isHere && <span className="font-medium text-muted-foreground">目前路段</span>}
            {group.hazards.length > 1 && (
              <span className="font-normal tabular-nums text-muted-foreground">{group.hazards.length} 項</span>
            )}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {group.hazards.map((h) => (
              <HazardChip key={h.id} hazard={h} />
            ))}
          </span>
        </span>
      </button>
    </li>
  );
}

function NoticeRow({ event, eta, faded, onSelect }: { event: RouteEvent; eta?: string; faded?: boolean; onSelect: () => void }) {
  return (
    <li className={cn(faded && "opacity-50")}>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          ROW,
          "cursor-pointer rounded-lg transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <KmCell startKm={event.km} eta={eta} />
        <Axis node="notice" />
        <span className="flex min-w-0 items-start gap-1.5 py-2.5 pr-1 text-sm text-muted-foreground">
          <Construction className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            {CATEGORY_LABEL[event.category]}：{event.description || event.title}
          </span>
        </span>
      </button>
    </li>
  );
}

/** 起點、終點與「前方沒有示警」這類不可點的列 */
function PlainRow({ km, eta, node, children }: { km?: number; eta?: string; node: "end" | null; children: React.ReactNode }) {
  return (
    <li className={ROW}>
      {km != null ? <KmCell startKm={km} eta={eta} /> : <span />}
      <Axis node={node} />
      <span className="py-2.5 text-sm text-muted-foreground">{children}</span>
    </li>
  );
}

/** 展開／收合列：只用 chevron 表示狀態，不另加「展開」字樣 */
function ToggleRow({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex min-h-10 w-full cursor-pointer items-center gap-1.5 py-2 text-left text-sm text-muted-foreground"
    >
      <ChevronRight className={cn("size-4 shrink-0 transition-transform", open && "rotate-90")} aria-hidden />
      {children}
    </button>
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
 * 第 2 層：沿途示警與路況排在同一條里程時間軸上。左欄里程與預估到達時間，節點表示嚴重程度。
 * - 會影響判定的示警：範圍重疊的併成一列（hazardGroups），同一處的多個指標用 chip 並排。
 * - 不影響判定的沿線路況（施工、壅塞）：灰色小點；例行施工收合成一行。
 * - 途中模式（fromKm）：畫「你在這裡」橫線，前方完整顯示；已經過的淡化並預設收合，只供參考、不影響判定。
 *   篩選後沒有示警時寫「前方沒有示警」，不暗示整條路線都安全。
 * 點示警與軌道一樣停到示警路段；點路況跳到附近的鏡頭。
 */
export function HazardTimeline({
  hazards,
  passedHazards = [],
  roadEvents,
  passedRoadEvents = [],
  fromKm,
  totalKm,
  positionKm,
  activeZone = null,
  onJump,
  onSelectHazard,
  etaOf,
}: {
  /** 前方（整條路線判讀時為全部）會影響判定的示警 */
  hazards: Hazard[];
  /** 途中模式已經過的示警 */
  passedHazards?: Hazard[];
  roadEvents?: RouteEventsState;
  /** 途中模式已經過的路況事件 */
  passedRoadEvents?: RouteEvent[];
  /** 途中模式的目前里程；null 為整條路線 */
  fromKm: number | null;
  totalKm: number;
  /** 軌道游標，用來標出目前停在哪一段 */
  positionKm: number;
  activeZone?: TrackZone | null;
  /** 點沿線路況（以及沒有 onSelectHazard 時的示警）跳到該里程 */
  onJump: (km: number) => void;
  /** 點示警：交給上層決定停到哪個停點 */
  onSelectHazard?: (hazard: Hazard) => void;
  etaOf?: EtaOf;
}) {
  const [passedOpen, setPassedOpen] = useState(false);
  const [routineOpen, setRoutineOpen] = useState(false);
  const riding = fromKm != null;

  const { notices, routine } = groupRouteEvents(roadEvents?.events ?? []);
  const ahead = itemsOf(hazards, notices);
  const passed = riding ? itemsOf(passedHazards, groupRouteEvents(passedRoadEvents).notices) : [];
  const groupCount = ahead.filter((it) => it.kind === "group").length;
  const passedGroups = passed.filter((it) => it.kind === "group").length;

  const selectGroup = (group: HazardGroup) => {
    const first = group.hazards[0]!;
    if (onSelectHazard) onSelectHazard(first);
    else onJump(first.startKm);
  };
  const isCurrent = (group: HazardGroup) =>
    activeZone
      ? group.hazards.some((h) => activeZone.hazards.some((z) => z.id === h.id))
      : positionKm >= group.startKm && positionKm <= group.endKm;

  const renderItem = (it: TimelineItem, faded: boolean) =>
    it.kind === "group" ? (
      <GroupRow
        key={`g-${it.group.startKm}-${it.group.hazards[0]!.id}`}
        group={it.group}
        eta={faded ? undefined : etaOf?.(it.group.startKm)}
        faded={faded}
        isHere={!faded && riding && it.group.startKm <= fromKm + 0.05}
        isCurrent={!faded && isCurrent(it.group)}
        onSelect={() => selectGroup(it.group)}
      />
    ) : (
      <NoticeRow
        key={`n-${it.event.id}`}
        event={it.event}
        eta={faded ? undefined : etaOf?.(it.event.km)}
        faded={faded}
        onSelect={() => onJump(it.event.km)}
      />
    );

  return (
    <section aria-labelledby="hazard-list-title" className="space-y-2">
      <h3 id="hazard-list-title" className="scroll-mt-20 text-sm font-semibold text-foreground">
        {riding ? "前方示警與路況" : "沿途示警與路況"}
        {groupCount > 0 && (
          <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">示警 {groupCount} 段</span>
        )}
      </h3>

      {passed.length > 0 && (
        <ToggleRow open={passedOpen} onToggle={() => setPassedOpen((v) => !v)}>
          <span>
            已經過{" "}
            {[
              passedGroups > 0 && `${passedGroups} 段示警`,
              passed.length - passedGroups > 0 && `${passed.length - passedGroups} 項路況`,
            ]
              .filter(Boolean)
              .join("、")}
            ・<span className="font-medium text-primary">{passedOpen ? "收起" : "顯示"}</span>
          </span>
        </ToggleRow>
      )}

      <ol className="space-y-0">
        {riding && passedOpen && passed.map((it) => renderItem(it, true))}
        {riding ? (
          <li className="flex items-center gap-2 py-1" aria-label={`你在這裡 ${km1(fromKm)} km`}>
            <span className="h-0.5 w-3 bg-primary" aria-hidden />
            <span className="flex items-center gap-1 text-xs font-bold text-primary">
              <LocateFixed className="size-3.5" aria-hidden />
              你在這裡
              <span className="font-mono tabular-nums">
                {km1(fromKm)} km{etaOf && `・${etaOf(fromKm)}`}
              </span>
            </span>
            <span className="h-0.5 flex-1 bg-primary" aria-hidden />
          </li>
        ) : (
          <PlainRow km={0} eta={etaOf?.(0)} node="end">
            起點
          </PlainRow>
        )}
        {ahead.map((it) => renderItem(it, false))}
        {groupCount === 0 && (
          <PlainRow node={null}>
            <span className="font-medium text-foreground">{riding ? "前方沒有示警" : "沿途沒有示警"}</span>
          </PlainRow>
        )}
        <PlainRow km={totalKm} eta={etaOf?.(totalKm)} node="end">
          終點
        </PlainRow>
      </ol>

      {routine.length > 0 && (
        <div>
          <ToggleRow open={routineOpen} onToggle={() => setRoutineOpen((v) => !v)}>
            <span>
              另有 <span className="tabular-nums">{routine.length}</span> 處例行施工（多為道路維護）
            </span>
          </ToggleRow>
          {routineOpen && <ol>{routine.map((e) => renderItem({ kind: "notice", km: e.km, event: e }, false))}</ol>}
        </div>
      )}

      {roadEvents && <EventsStatus state={roadEvents} />}
    </section>
  );
}
