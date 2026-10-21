"use client";

import { useEffect, useState } from "react";
import type { BriefingSummary } from "@/lib/dashboard/briefing-summary";
import { withTrip, type TripParams } from "@/lib/routes/trip";

/** 判讀回來後最多再等 AI 句子這麼久；逾時就用規則句，晚到的 AI 句子不再替換，避免畫面換句 */
export const SUMMARY_WAIT_MS = 2000;

export interface BriefingSummaryState {
  /** 抓到且在等待時間內回來的摘要；沒有、失敗、逾時都是 null */
  summary: BriefingSummary | null;
  /** 還在等 AI 句子：句子位置顯示骨架，不先顯示規則句 */
  pending: boolean;
}

/**
 * AI 一句話摘要：與判讀同時另外抓。
 * enabled：非離線快照、非途中模式時抓（快照或途中模式一律用規則句）。
 * ready：判讀已回來（或已確定失敗），從這時起最多等 SUMMARY_WAIT_MS。
 * endpoint：判讀 API；摘要 API 是它底下的 /summary（公開、私人路線各一支）。
 */
export function useBriefingSummary(
  routeId: string | null | undefined,
  trip: TripParams,
  endpoint: string,
  enabled: boolean,
  ready = true
): BriefingSummaryState {
  const { depart, activity } = trip;
  const key = `${endpoint}|${routeId}|${depart}|${activity}`;
  // settled 後不再變動：先逾時就固定用規則句，先回來就固定用 AI 句子
  const [state, setState] = useState<{ key: string; summary: BriefingSummary | null } | null>(null);

  useEffect(() => {
    if (!routeId || !enabled) return;
    let cancelled = false;
    const settle = (summary: BriefingSummary | null) => {
      if (!cancelled) setState((s) => (s?.key === key ? s : { key, summary }));
    };
    fetch(withTrip(`${endpoint}/summary?route=${encodeURIComponent(routeId)}`, { depart, activity }))
      .then((res) => (res.ok ? (res.json() as Promise<{ summary: BriefingSummary | null }>) : { summary: null }))
      .then(({ summary }) => settle(summary))
      // 摘要只是加分項：網路失敗不顯示錯誤，直接用規則句
      .catch(() => settle(null));
    return () => {
      cancelled = true;
    };
  }, [key, routeId, depart, activity, endpoint, enabled]);

  useEffect(() => {
    if (!routeId || !enabled || !ready) return;
    const timer = setTimeout(() => setState((s) => (s?.key === key ? s : { key, summary: null })), SUMMARY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [key, routeId, enabled, ready]);

  if (!routeId || !enabled) return { summary: null, pending: false };
  const current = state?.key === key ? state : null;
  return { summary: current?.summary ?? null, pending: current == null };
}
