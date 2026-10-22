"use client";

import { useEffect, useState } from "react";
import type { BriefingSummary } from "@/lib/dashboard/briefing-summary";
import { withTrip, type TripParams } from "@/lib/routes/trip";

/**
 * 規則句只是 AI 失敗時的備援，不因為等待而提早顯示：一直等到摘要 API 回應。
 * 這個上限只防網路卡住（伺服器端 Claude 逾時 10 秒），逾時才用規則句；晚到的 AI 句子不再替換，避免畫面換句。
 */
export const SUMMARY_WAIT_MS = 15000;

export interface BriefingSummaryState {
  /** 抓到且在等待時間內回來的摘要；沒有、失敗、逾時都是 null */
  summary: BriefingSummary | null;
  /** 還在等 AI 句子：句子位置顯示骨架，不先顯示規則句（判定詞照常顯示） */
  pending: boolean;
}

/**
 * AI 一句話摘要：判讀回來後另外抓。
 * enabled：非離線快照、非途中模式時抓（快照或途中模式一律用規則句）。
 * ready：判讀已回來（或已確定失敗），從這時起才抓摘要並開始計算 SUMMARY_WAIT_MS 上限。
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
    // 等判讀回來才抓：摘要 API 也要判讀同一條路線，判讀完 CWB、TDX 都已進快取，摘要只剩 Claude 的時間。
    // 兩支同時發出時會各自向 TDX 抓同一縣市，容易被限流（429 要等 5 秒重試）
    if (!routeId || !enabled || !ready) return;
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
  }, [key, routeId, depart, activity, endpoint, enabled, ready]);

  useEffect(() => {
    if (!routeId || !enabled || !ready) return;
    const timer = setTimeout(() => setState((s) => (s?.key === key ? s : { key, summary: null })), SUMMARY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [key, routeId, enabled, ready]);

  if (!routeId || !enabled) return { summary: null, pending: false };
  const current = state?.key === key ? state : null;
  return { summary: current?.summary ?? null, pending: current == null };
}
