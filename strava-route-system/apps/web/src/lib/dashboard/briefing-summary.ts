/**
 * AI 一句話摘要的純函式：挑出給模型的事實、驗證模型寫的句子。
 * 判定只由規則（summarizeVerdict）決定；這裡只決定「模型看得到什麼」與「什麼句子可以上畫面」。
 * 驗證不過一律回 null，畫面退回 verdict.headline。
 */

import type { RouteBriefing } from "@/lib/dashboard/briefing";
import type { VerdictLevel } from "@/lib/routes/recon-geo";

/** 與 route-verdict-bar 的判定用詞一致 */
const LEVEL_WORD: Record<VerdictLevel, string> = {
  risky: "危險",
  caution: "注意",
  clear: "安全",
  unknown: "未判定",
};

/**
 * 畫面上已另外顯示判定詞（危險／注意…）與 note（示警數、資料缺口），
 * 行動建議（替代路線、出發時段）也由規則另外顯示（advice.ts），
 * 所以事實裡不放這些，句子只描述路況，避免重複。
 */
export interface SummaryFacts {
  route: string;
  level: VerdictLevel;
  /** 規則產生的短句，例：「12.4 km 起降雨 70%」 */
  headline: string;
  distanceKm: number;
  /** 影響判定的示警，依里程排序，最多 3 項 */
  hazards: { label: string; startKm: number; endKm: number; level: string }[];
  /** 天氣統計寫成中文，模型引用的用詞與數字都能在這裡找到 */
  weather: string | null;
  period: string | null;
}

/** 摘要結果；level／headline 記錄依據的判定，前端只在跟畫面上的判定相同時才替換 */
export interface BriefingSummary {
  text: string;
  level: VerdictLevel;
  headline: string;
}

const MAX_HAZARDS = 3;
/** 句子長度上限（字元數，非位元組） */
export const SUMMARY_MAX_CHARS = 60;

/** 從判讀結果挑出要講的事實；只放規則已算好的結果，不給原始資料 */
export function briefingFacts(b: RouteBriefing): SummaryFacts {
  const { verdict } = b;
  const weatherParts: string[] = [];
  if (b.maxRain != null) weatherParts.push(`降雨機率最高 ${b.maxRain}%`);
  if (b.maxWindKmh != null) weatherParts.push(`風速最高 ${Math.round(b.maxWindKmh)} km/h`);
  if (b.temperature) weatherParts.push(`氣溫 ${Math.round(b.temperature.min)}–${Math.round(b.temperature.max)}°C`);

  return {
    route: b.name,
    level: verdict.level,
    headline: verdict.headline,
    distanceKm: Math.round(b.distanceKm * 10) / 10,
    hazards: b.hazards.slice(0, MAX_HAZARDS).map((h) => ({
      label: h.label,
      startKm: Math.round(h.startKm * 10) / 10,
      endKm: Math.round(h.endKm * 10) / 10,
      level: LEVEL_WORD[h.level],
    })),
    weather: weatherParts.length ? weatherParts.join("、") : null,
    period: b.periodLabel,
  };
}

/** 有示警或未判定時不能出現的放心用語 */
const SAFE_WORDS = ["安全", "放心", "沒問題", "無虞", "可以出發", "適合出發", "適合騎", "適合走"];
/** 否定語境裡的「安全」不算放心用語（規則句本身就會這樣寫） */
const NEGATED_SAFE = ["不代表安全", "無法確認安全", "不能確認安全", "不保證安全"];
const UNKNOWN_WORDS = ["未判定", "無法判定", "無法確認"];
/**
 * 天氣與路況用詞：句子裡出現的，事實裡也必須出現，防止模型自己加「路面濕滑」這類沒有根據的描述。
 * 以單字比對（例：「雨」涵蓋降雨、下雨、陣雨）。
 */
const CONDITION_TERMS = ["雨", "風", "雷", "溫", "熱", "冷", "寒", "霧", "濕", "滑", "積水", "施工", "事故", "封閉", "坍方", "落石", "壅塞", "塞車", "管制", "颱"];

/** 畫面上已顯示的資訊，句子再講一次就是重複 */
const REPEATED_PHRASES = ["項示警", "等級"];

const numbersIn = (s: string) => (s.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/**
 * 驗證模型寫的句子；通過回傳整理後的句子，不通過回 null。
 * 規則：一句、長度上限、不重複畫面已有的資訊、用詞與數字都要出自事實、未判定要說未判定、有示警不能說安全。
 */
export function checkSummary(raw: string, facts: SummaryFacts): string | null {
  const text = raw
    .trim()
    .replace(/^[「『"']+|[」』"']+$/g, "")
    .trim()
    // 半形逗號統一成全形，與畫面其他中文標點一致
    .replace(/\s*,\s*/g, "，");
  if (!text || /[\r\n]/.test(text)) return null;
  if (REPEATED_PHRASES.some((p) => text.includes(p))) return null;
  if (Array.from(text).length > SUMMARY_MAX_CHARS) return null;
  // 只能有一句：句末標點只能出現在最後
  if (/[。！？!?]/.test(text.slice(0, -1))) return null;

  const factsText = JSON.stringify(facts);
  const allowed = new Set(numbersIn(factsText));
  if (numbersIn(text).some((n) => !allowed.has(n))) return null;
  if (CONDITION_TERMS.some((t) => text.includes(t) && !factsText.includes(t))) return null;

  const withoutNegated = NEGATED_SAFE.reduce((s, phrase) => s.replaceAll(phrase, ""), text);
  const soundsSafe = SAFE_WORDS.some((w) => withoutNegated.includes(w));
  switch (facts.level) {
    case "unknown":
      if (!UNKNOWN_WORDS.some((w) => text.includes(w)) || soundsSafe) return null;
      break;
    case "caution":
    case "risky":
      if (soundsSafe) return null;
      break;
    case "clear":
      if (text.includes("危險") || UNKNOWN_WORDS.some((w) => text.includes(w))) return null;
      break;
  }
  return text;
}

/** 摘要只在依據的判定與畫面上顯示的判定相同時使用（判讀重抓、快照過期後就不適用） */
export function summaryApplies(
  summary: BriefingSummary | null,
  verdict: { level: VerdictLevel; headline: string }
): summary is BriefingSummary {
  return summary != null && summary.level === verdict.level && summary.headline === verdict.headline;
}
