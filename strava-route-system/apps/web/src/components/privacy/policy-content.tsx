"use client";

import React from "react"
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Target,
  Cookie,
  Shield,
  Scale,
  CreditCard,
  UserCheck,
  Mail,
  FileText,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Cpu,
} from "lucide-react";

function SectionHeading({
  id,
  icon: Icon,
  title,
  subtitle,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
}) {
  return (
    <div id={id} className="scroll-mt-24">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
          <Icon className="h-4.5 w-4.5 text-strava" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-foreground leading-tight">{title}</h2>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-border bg-secondary/50 p-4">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-strava/10 shrink-0">
        <Icon className="h-4 w-4 text-strava" />
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}

function HighlightBox({
  variant = "info",
  children,
}: {
  variant?: "info" | "warning" | "success";
  children: React.ReactNode;
}) {
  const styles = {
    info: "border-strava/30 bg-strava/5",
    warning: "border-warning/30 bg-warning/5",
    success: "border-success/30 bg-success/5",
  };
  const iconStyles = {
    info: "text-strava",
    warning: "text-warning",
    success: "text-success",
  };
  const icons = {
    info: AlertTriangle,
    warning: AlertTriangle,
    success: CheckCircle2,
  };
  const Icon = icons[variant];

  return (
    <div
      className={`flex gap-3 rounded-lg border p-4 ${styles[variant]}`}
    >
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${iconStyles[variant]}`} />
      <div className="text-sm text-foreground leading-relaxed">{children}</div>
    </div>
  );
}

export function PolicyContent() {
  return (
    <article className="space-y-10">
      {/* Introduction */}
      <section>
        <SectionHeading
          id="introduction"
          icon={FileText}
          title="隱私政策"
          subtitle="最後更新：2026 年 10 月 4 日"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            歡迎使用曉行 Dawnline。我們非常重視您的隱私，尤其是您的路線與位置資料。本隱私政策說明當您使用本服務時，我們如何蒐集、使用、揭露與保護您的資訊。
          </p>
          <p className="text-muted-foreground leading-relaxed">
            使用曉行 Dawnline 即表示您同意依本政策蒐集與使用資訊。若不同意本政策條款，請勿使用本服務。
          </p>
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="secondary" className="gap-1.5 text-foreground">
              <Shield className="h-3 w-3" />
              符合 GDPR
            </Badge>
            <Badge variant="secondary" className="gap-1.5 text-foreground">
              <UserCheck className="h-3 w-3" />
              使用者優先資料政策
            </Badge>
          </div>
        </div>
      </section>

      <Separator />

      {/* Data Collection */}
      <section>
        <SectionHeading
          id="data-collection"
          icon={Database}
          title="我們蒐集的資料"
          subtitle="您提供與自動蒐集的資訊"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            當您註冊或使用曉行 Dawnline 時，我們會蒐集以下類別的資料。
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard
              icon={UserCheck}
              title="帳號資料"
              description="透過 Google 或電子郵件註冊時提供的顯示名稱、電子郵件與大頭照。"
            />
            <InfoCard
              icon={MapPin}
              title="路線資料"
              description="您在私人路線中建立或上傳的 GPX 軌跡與路線名稱。"
            />
          </div>

          <h3 className="text-base font-medium text-foreground mt-6">
            自動蒐集的資訊
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-strava shrink-0" />
              <span className="leading-relaxed">
                <strong className="text-foreground">裝置資訊：</strong>
                瀏覽器類型、作業系統、螢幕解析度與裝置識別碼，用於分析與相容性。
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-strava shrink-0" />
              <span className="leading-relaxed">
                <strong className="text-foreground">使用資料：</strong>
                造訪頁面、使用功能、各區塊停留時間與互動模式，以改善使用體驗。
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-strava shrink-0" />
              <span className="leading-relaxed">
                <strong className="text-foreground">日誌資料：</strong>
                伺服器日誌蒐集之 IP 位址、存取時間與來源網址，用於安全監控。
              </span>
            </li>
          </ul>
        </div>
      </section>

      <Separator />

      {/* Purpose of Use */}
      <section>
        <SectionHeading
          id="purpose-of-use"
          icon={Target}
          title="使用目的"
          subtitle="我們如何運用您的資料"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            您的資料僅用於下列特定目的。未經您明確同意，我們不會將資料用於以下所列以外之用途。
          </p>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    目的
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    說明
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-foreground hidden sm:table-cell">
                    法律依據
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    路線判讀
                  </td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">
                    依路線沿途位置查詢天氣與路況，產生逐段判定。
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    <Badge variant="outline" className="text-foreground">同意</Badge>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    地圖視覺化
                  </td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">
                    在互動地圖上顯示路線軌跡與沿途天氣、路況。
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    <Badge variant="outline" className="text-foreground">同意</Badge>
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    服務改善
                  </td>
                  <td className="px-4 py-3 text-muted-foreground leading-relaxed">
                    經匿名與彙總之分析資料，用於改善功能、修復問題與優化效能。
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    <Badge variant="outline" className="text-foreground">正當利益</Badge>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Separator />

      {/* Data Storage */}
      <section>
        <SectionHeading
          id="data-storage"
          icon={Shield}
          title="資料儲存與安全"
          subtitle="我們如何及於何處保護您的資訊"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            我們採用業界標準安全措施，保護靜態與傳輸中的資料。所有敏感資訊均經加密並存放於具存取控管之安全環境。
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard
              icon={Shield}
              title="加密"
              description="靜態資料使用 AES-256 加密，傳輸使用 TLS 1.3。API 權杖以伺服器端加密儲存。"
            />
            <InfoCard
              icon={Cpu}
              title="基礎架構"
              description="託管於 Vercel 邊緣網路與無伺服器函式。資料庫服務由符合 SOC 2 之供應商提供。"
            />
          </div>

          <h3 className="text-base font-medium text-foreground mt-6">
            保留時程
          </h3>
          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    資料類型
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    保留期間
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-3 text-foreground">
                    路線資料
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    至帳號刪除後 30 天
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-foreground">
                    帳號憑證
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    至帳號刪除（由 Firebase Auth 管理）
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-foreground">
                    彙總分析
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    永久保留（已完全匿名化）
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-foreground">伺服器日誌</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    90 天滾動視窗
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Separator />

      {/* Cookies */}
      <section>
        <SectionHeading
          id="cookies"
          icon={Cookie}
          title="Cookie 與追蹤"
          subtitle="用於維持您的工作階段與偏好的技術"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            我們僅使用營運服務所必要之最少數量 Cookie 與類似技術。我們不使用廣告 Cookie 或跨站追蹤像素。
          </p>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    Cookie
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    用途
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-foreground hidden sm:table-cell">
                    效期
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-3 text-foreground">
                    <code className="font-mono text-xs">__session</code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    Firebase 驗證工作階段
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    14 天
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-foreground">
                    <code className="font-mono text-xs">theme</code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    介面主題偏好（深色／淺色）
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    1 年
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 text-foreground">
                    <code className="font-mono text-xs">_vercel_insights</code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    匿名使用分析（Vercel Analytics）
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    工作階段
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Separator />

      {/* User Rights */}
      <section>
        <SectionHeading
          id="user-rights"
          icon={UserCheck}
          title="您的權利"
          subtitle="對您個人資料的掌控"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            依您所在管轄區，您可能對個人資料享有下列權利。欲行使任一權利，請透過「聯絡我們」一節提供的聯絡方式與我們聯繫。
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                title: "存取權",
                description:
                  "要求取得我們所持有您個人資料之副本，並以機器可讀格式提供。",
              },
              {
                title: "更正權",
                description:
                  "要求更正不正確之個人資料或補足不完整之資料。",
              },
              {
                title: "刪除權",
                description:
                  "要求刪除您的個人資料（「被遺忘權」）。我們將於 30 天內完成。",
              },
              {
                title: "可攜權",
                description:
                  "隨時以結構化、常用格式（JSON 或 CSV）匯出您的資料。",
              },
              {
                title: "限制處理權",
                description:
                  "於特定情況下要求我們限制對您個人資料的處理。",
              },
              {
                title: "撤回同意權",
                description:
                  "隨時透過刪除曉行 Dawnline 帳號撤回同意。",
              },
            ].map((right) => (
              <div
                key={right.title}
                className="rounded-lg border border-border bg-card p-4"
              >
                <p className="text-sm font-medium text-foreground">
                  {right.title}
                </p>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  {right.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Separator />

      {/* Fees & Data */}
      <section>
        <SectionHeading
          id="fees-and-data"
          icon={CreditCard}
          title="費用與資料使用"
          subtitle="免費服務，不將資料變現"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            曉行 Dawnline 以免費服務形式提供，我們承諾透明說明平台如何運作。
          </p>

          <HighlightBox variant="info">
            <strong>免費使用：</strong>曉行 Dawnline 不收取使用費用，也不會要求、收集或儲存信用卡或其他付款資訊。
          </HighlightBox>

          <div className="space-y-3">
            <div className="flex gap-3 rounded-lg border border-border bg-card p-4">
              <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  不將資料變現
                </p>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  我們不會也永不出售個別使用者資料、位置或路線紀錄給廣告主、資料仲介或任何第三方。
                </p>
              </div>
            </div>
            <div className="flex gap-3 rounded-lg border border-border bg-card p-4">
              <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  無廣告
                </p>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
                  曉行 Dawnline 不顯示第三方廣告，亦不使用您的資料在本平台或任何外部服務投放定向廣告。
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* Third Parties */}
      <section>
        <SectionHeading
          id="third-parties"
          icon={Scale}
          title="第三方服務"
          subtitle="會處理您資料的外部服務"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            我們使用少量第三方服務以營運曉行 Dawnline。各服務受其自身隱私政策及我們的資料處理協議約束。
          </p>

          <div className="rounded-lg border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    服務
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-foreground">
                    用途
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-foreground hidden sm:table-cell">
                    共享資料
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    Firebase (Google)
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    驗證與使用者管理
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    電子郵件、驗證憑證
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    Vercel
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    託管與分析
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    匿名使用資料
                  </td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-medium text-foreground">
                    Sentry
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    錯誤追蹤
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    錯誤訊息、發生錯誤的頁面路徑、瀏覽器類型（不含帳號、IP、Cookie、路線內容與網址參數）
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <Separator />

      {/* Contact */}
      <section>
        <SectionHeading
          id="contact"
          icon={Mail}
          title="聯絡我們"
          subtitle="關於本政策或您資料的疑問"
        />
        <div className="mt-4 space-y-4">
          <p className="text-muted-foreground leading-relaxed">
            若您對本隱私政策、您的資料或欲行使任何權利有任何疑問，請透過以下資訊與我們聯繫。
          </p>

          <div className="rounded-lg border border-border bg-card p-6">
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <span className="font-medium text-foreground min-w-28">
                  電子郵件：
                </span>
                <span className="text-strava">mu.chuan.hung@gmail.com</span>
              </div>
              <div className="flex items-start gap-3">
                <span className="font-medium text-foreground min-w-28">
                  回覆時間：
                </span>
                <span className="text-muted-foreground">
                  5 個工作天內
                </span>
              </div>
              <div className="flex items-start gap-3">
                <span className="font-medium text-foreground min-w-28">
                  資料請求：
                </span>
                <span className="text-muted-foreground">
                  驗證後 30 天內處理
                </span>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            本隱私政策可能不時更新。若有重大變更，我們將於本頁張貼新版政策並更新「最後更新」日期。建議您定期檢視本頁以掌握變更。
          </p>
        </div>
      </section>
    </article>
  );
}