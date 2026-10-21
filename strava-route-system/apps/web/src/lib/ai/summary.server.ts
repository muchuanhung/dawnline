/**
 * AI 一句話摘要（伺服器端專用）：把規則算好的判讀事實交給 Claude 寫成一句繁中。
 * Claude 不參與判定；句子要通過 checkSummary 才回傳，否則回 null，畫面維持 verdict.headline。
 * 沒有 ANTHROPIC_API_KEY、逾時、API 錯誤、拒答一律回 null，不影響判讀本身。
 */

import Anthropic from "@anthropic-ai/sdk";
import { unstable_cache } from "next/cache";
import type { RouteBriefing } from "@/lib/dashboard/briefing";
import { briefingFacts, checkSummary, type BriefingSummary } from "@/lib/dashboard/briefing-summary";
import { getRouteBriefing } from "@/lib/dashboard/get-briefing.server";
import { parseActivity, parseDeparture } from "@/lib/routes/trip";

const MODEL = "claude-sonnet-5-5";
const REQUEST_TIMEOUT_MS = 8000;
/** 同一份事實 30 分鐘內不重複呼叫 */
const CACHE_SECONDS = 1800;
/** 公開路線的整份摘要（含判讀）快取；與 CWB 即時雨量、TDX 事件的快取時間相同 */
const ROUTE_SUMMARY_SECONDS = 600;

const SYSTEM_PROMPT = `You write one sentence in Traditional Chinese (Taiwan) for a cyclist or hiker, summarising a route check that a rules engine has already decided.

Rules:
- Use only the facts in the user message. Never change, soften or upgrade the verdict level.
- If level is "unknown", say the route is 未判定 because data is missing. Never say or imply it is safe.
- If level is "caution" or "risky", never use words like 安全, 放心, 沒問題.
- Every number you write must appear in the facts exactly as given, in Arabic digits. Write distances as "12.4 km", never 公里.
- Do not mention any weather or road condition that is not in the facts.
- The verdict word (危險/注意/安全/未判定) and the number of other hazards are already shown next to your sentence. Do not repeat them, and do not add generic advice such as 審慎評估.
- Describe the conditions only: the first hazard and where it starts, plus useful context from the facts. Do not give advice such as changing route or time; the app shows its own advice.
- At most 50 characters, a single sentence, full-width Chinese punctuation, no quotes, emoji or markdown. Output only the sentence.`;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 }));

/** 呼叫 Claude 取得原始句子；不在這裡驗證，讓被擋下的結果也進快取，避免同一份事實重複花費 */
async function phrase(factsJson: string): Promise<string | null> {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    // 只是改寫一句話：關閉 thinking、低 effort，壓低延遲與費用
    thinking: { type: "between_tools" },
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: factsJson }],
  });
  // 拒答、被截斷都不採用
  if (response.stop_reason !== "end_turn") {
    console.warn("[AI 摘要] 未採用，stop_reason:", response.stop_reason);
    return null;
  }
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return text || null;
}

// 快取 key 為函式參數（事實 JSON）；事實不變就沿用同一句
const cachedPhrase = unstable_cache(phrase, ["briefing-summary-v4"], { revalidate: CACHE_SECONDS });

/** 產生並驗證摘要；API 錯誤會拋出（讓外層快取不收錄錯誤），驗證未通過回 null */
async function phraseBriefing(briefing: RouteBriefing): Promise<BriefingSummary | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const facts = briefingFacts(briefing);
  const raw = await cachedPhrase(JSON.stringify(facts));
  const text = raw ? checkSummary(raw, facts) : null;
  if (raw && !text) console.warn("[AI 摘要] 驗證未通過:", raw);
  return text ? { text, level: facts.level, headline: facts.headline } : null;
}

const logFailure = (err: unknown) =>
  console.warn("[AI 摘要] 呼叫失敗:", err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err);

export async function summarizeBriefing(briefing: RouteBriefing): Promise<BriefingSummary | null> {
  try {
    return await phraseBriefing(briefing);
  } catch (err) {
    // 錯誤不進快取，下次請求會重試
    logFailure(err);
    return null;
  }
}

/**
 * 公開路線摘要，連同判讀一起快取 10 分鐘：同一條路線、同樣的出發時間參數與運動類型直接回快取，
 * 不必每次重新判讀（摘要慢主要慢在這裡）。判讀在這 10 分鐘內變了的話，前端 summaryApplies 會擋下改用規則句。
 * depart／activity 用網址上的原始字串當快取 key（未指定即「現在出發」）。
 */
const cachedRouteSummary = unstable_cache(
  async (routeId: string, depart: string | null, activity: string | null) => {
    const briefing = await getRouteBriefing(routeId, {
      departure: parseDeparture(depart, new Date()) ?? undefined,
      activity: parseActivity(activity) ?? undefined,
    });
    return briefing ? { found: true, summary: await phraseBriefing(briefing) } : { found: false, summary: null };
  },
  ["route-summary-v1"],
  { revalidate: ROUTE_SUMMARY_SECONDS }
);

/** found=false 代表沒有這條公開路線；API 錯誤不進快取，回 summary null */
export async function getPublicRouteSummary(
  routeId: string,
  depart: string | null,
  activity: string | null
): Promise<{ found: boolean; summary: BriefingSummary | null }> {
  try {
    return await cachedRouteSummary(routeId, depart, activity);
  } catch (err) {
    logFailure(err);
    return { found: true, summary: null };
  }
}
