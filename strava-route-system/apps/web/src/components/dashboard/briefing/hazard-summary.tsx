import { UNKNOWN_REASON_TEXT } from "@/lib/routes/recon-geo";
import type { RouteBriefing } from "@/lib/dashboard/briefing";
import { groupRouteEvents } from "@/lib/routes/road-events";
import { HAZARD_ROW_GRID, HazardGroupRowContent } from "@/components/verdict/hazard-row";
import { hazardGroups, type HazardGroup } from "@/lib/routes/route-track";
import { etaLabel, paceFor } from "@/lib/routes/trip";
import { ProfileStrip } from "./profile-strip";

/** 今日判讀只列最要緊的幾項，完整清單在路線頁 */
const SUMMARY_LIMIT = 3;

/** 同一處的示警併成一段後，危險優先、同等級依里程，取前幾段 */
function topGroups(groups: HazardGroup[]): HazardGroup[] {
  return [...groups]
    .sort((a, b) => (a.level === b.level ? a.startKm - b.startKm : a.level === "risky" ? -1 : 1))
    .slice(0, SUMMARY_LIMIT);
}

/**
 * 沿途示警摘要：今日判讀只回答「要不要出發」，這裡列出影響判定的前幾項與總數；
 * 逐段清單、點擊跳到該處、坡度與 CCTV 在路線頁。陡坡是路線固定特性，不列入。
 */
export function HazardSummary({ briefing }: { briefing: RouteBriefing }) {
  const { hazards } = briefing;
  const { notices, routine } = groupRouteEvents(briefing.roadEvents);
  const groups = hazardGroups(hazards);
  const shown = topGroups(groups);
  const roadNotices = notices.length + routine.length;
  const now = new Date();
  const pace = paceFor(briefing.activity, briefing.elevationProfile);

  return (
    <section aria-labelledby="hazard-title" className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="hazard-title" className="text-lg font-bold">
          沿途示警
          {groups.length > 0 && (
            <span className="ml-1.5 font-normal tabular-nums text-muted-foreground">{groups.length} 段</span>
          )}
        </h2>
        <p className="font-mono text-sm text-muted-foreground">
          {briefing.distanceKm.toFixed(1)} km・爬升 {briefing.elevationGainM} m
        </p>
      </div>

      <ProfileStrip profile={briefing.elevationProfile} distanceKm={briefing.distanceKm} hazards={hazards} />

      {shown.length > 0 ? (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {shown.map((g) => (
            <li key={`${g.startKm}-${g.hazards[0]!.id}`} className={HAZARD_ROW_GRID}>
              <HazardGroupRowContent group={g} eta={etaLabel(g.startKm, briefing.departure, pace, now)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {briefing.verdict.level === "unknown"
            ? [
                briefing.verdict.headline,
                briefing.verdict.note,
                `原因：${(briefing.verdict.reasons ?? ["no_data"]).map((r) => UNKNOWN_REASON_TEXT[r].title).join("、")}`,
              ]
                .filter(Boolean)
                .join("・") + "。"
            : "沿途沒有示警。"}
        </p>
      )}

      {(groups.length > shown.length || roadNotices > 0) && (
        <p className="text-sm text-muted-foreground">
          {groups.length > shown.length && `還有 ${groups.length - shown.length} 段示警`}
          {groups.length > shown.length && roadNotices > 0 && "，"}
          {roadNotices > 0 && `沿線另有 ${roadNotices} 則施工、壅塞等路況（不影響判定）`}
          {/* 完整清單由判定卡的「看逐段示警與 CCTV」進入，同頁不重複放同一個入口 */}
          ，完整清單在逐段示警頁。
        </p>
      )}
    </section>
  );
}
