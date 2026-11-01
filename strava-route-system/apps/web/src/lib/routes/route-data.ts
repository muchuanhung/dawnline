// Route Intelligence data models

export interface RouteSegment {
  district: string;
  districtZh: string;
  county?: string;
  rainProbability: number;
  windSpeed: number;
  temperature: number;
  condition: "clear" | "cloudy" | "rainy" | "stormy";
  /** 路段標籤，如「文山區 → 深坑區」 */
  segmentLabel?: string;
  /** 該路段 GPX 軌跡的 bbox，供 CCTV 查詢使用 */
  segmentBbox?: [number, number, number, number];
  /** 此行政區在路線上被取樣到的里程（km），供依里程對應天氣 */
  sampleKms?: number[];
  /** 是否已取得 CWB 天氣；false 時 rain/wind/temp 為預設 0，不可當作實際數值顯示 */
  hasWeather?: boolean;
  /**
   * 路線 3 km 內雨量站的即時時雨量（mm/hr）；null 代表附近沒有測站，
   * undefined 代表沒有查詢即時雨量（不列入判定也不加註）
   */
  observedRainMmPerHr?: number | null;
  /** 行經時段的天氣現象（多個時段以「、」連接），例：「短暫陣雨、午後短暫雷陣雨」；判讀只用來擋降級 */
  weatherText?: string;
  /**
   * 未來 1 小時降雨預報（F-B0046）在此路段沿線的最大雨量（mm）；
   * undefined 代表沒有可用的預報（取不到、過期、超過 1 小時才會到），判讀維持只看降雨機率
   */
  nowcastRainMm?: number;
  /** nowcastRainMm 的預報涵蓋到何時（ISO）；路段離開 ETA 晚於此時不採用 */
  nowcastValidUntil?: string;
  /** 此路段用的是過期預報（重抓後仍過期） */
  weatherStale?: boolean;
  /** 此路段預估抵達時間超出預報涵蓋時段 */
  outOfCoverage?: boolean;
}

export interface CCTVFeed {
    id: string;
    label: string;
    location: string;
    lastUpdated: string;
    lat?: number;
    lon?: number;
    imageSeed: number;
    videoUrl?: string;
    township?: string;
  }
  
  export interface Route {
    id: string;
    name: string;
    nameZh: string;
    bbox?: [number, number, number, number];
    distance: number; // km
    elevationGain: number; // m
    type: "自行車" | "跑步" | "健行" | "雪巴運動" | "混合";
    difficulty: "簡單" | "中等" | "困難" | "極難";
    status: "safe" | "caution" | "risky";
    verdictMessage: string;
    segments: RouteSegment[];
    cctvFeeds: CCTVFeed[];
    gpxPreviewPath: string;
    elevationProfile: [number, number][];
    estimatedTime: string;
  }

export function getStatusColor(status: Route["status"]): string {
    switch (status) {
      case "safe":
        return "#22c55e";
      case "caution":
        return "#f59e0b";
      case "risky":
        return "#ef4444";
    }
  }
  
  export function getStatusLabel(status: Route["status"]): string {
    switch (status) {
      case "safe":
        return "安全";
      case "caution":
        return "注意";
      case "risky":
        return "危險";
    }
  }

  export function getDifficultyColor(d: Route["difficulty"]): string {
    switch (d) {
      case "簡單":
        return "#22c55e";
      case "中等":
        return "#f59e0b";
      case "困難":
        return "#0ea5e9";
      case "極難":
        return "#ef4444";
    }
  }
  
  export function getConditionIcon(c: RouteSegment["condition"]): string {
    switch (c) {
      case "clear":
        return "sun";
      case "cloudy":
        return "cloud";
      case "rainy":
        return "cloud-rain";
      case "stormy":
        return "cloud-lightning";
    }
  }
