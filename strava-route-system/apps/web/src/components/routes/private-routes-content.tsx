"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileUp, MoreVertical, Mountain, Route as RouteIcon, Search, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RoutesTabs } from "@/components/routes/routes-tabs";
import { RouteFilters, matchesTypeFilter, type FilterType } from "@/components/routes/route-filters";
import { ROUTE_TYPE_ICONS } from "@/constants";
import { usePrivateRoutes } from "@/hooks/usePrivateRoutes";
import { cn } from "@/lib/utils";
import type { Route } from "@/lib/routes/route-data";
import {
  GPX_MAX_BYTES,
  privateRouteDownloadUrl,
  validateGpxFile,
  type PrivateRoute,
} from "@/lib/routes/private-routes";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });
const MAX_MB = Math.round(GPX_MAX_BYTES / 1024 / 1024);

/**
 * 私人路線：版型對齊公開路線頁。桌機左側為路線清單（搜尋＋類型篩選），右側為上傳面板；
 * 手機依序為標題、清單，上傳鈕浮在底部分頁列上方。
 */
export function PrivateRoutesContent() {
  const { routes, limit, loading, error, upload, remove, refetch } = usePrivateRoutes();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("全部");
  const full = limit != null && routes.length >= limit;
  const canUpload = !uploading && !loading && !full && error == null;

  const filtered = routes.filter(
    (r) => r.name.toLowerCase().includes(search.toLowerCase()) && matchesTypeFilter(r.type, typeFilter)
  );

  async function handleFile(file: File | undefined) {
    if (!file || !canUpload) return;
    const invalid = validateGpxFile(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }
    setUploading(true);
    try {
      const route = await upload(file);
      toast.success(`已上傳「${route.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "上傳失敗");
    } finally {
      setUploading(false);
      // 清掉選取，同一個檔案才能再選一次
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDownload(route: PrivateRoute) {
    setBusyId(route.id);
    try {
      window.location.assign(await privateRouteDownloadUrl(route.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "下載失敗");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(route: PrivateRoute) {
    if (!window.confirm(`刪除「${route.name}」？檔案會一併刪除，無法復原。`)) return;
    setBusyId(route.id);
    try {
      await remove(route.id);
      toast.success("已刪除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "刪除失敗");
    } finally {
      setBusyId(null);
    }
  }

  const openPicker = () => inputRef.current?.click();
  const uploadLabel = uploading ? "上傳中…" : full ? "已達路線上限" : "上傳 GPX";

  return (
    // pb-16：手機留出浮動上傳鈕的高度，清單最後一項不被蓋住
    <div className="pb-16 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8 lg:pb-0">
      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {/* 標題：手機在清單上方；桌機放在右欄（見下方） */}
      <PageTitle used={routes.length} limit={limit} className="lg:hidden" />

      {/* 路線清單：桌機和公開路線頁一樣固定在左側 */}
      <aside
        aria-label="我的路線清單"
        className="mt-5 overflow-hidden rounded-2xl border border-border bg-card lg:sticky lg:top-24 lg:mt-0 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:flex-col"
      >
        <div className="border-b border-border p-4">
          <RouteFilters search={search} onSearch={setSearch} typeFilter={typeFilter} onFilter={setTypeFilter} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <Spinner size="lg" dotClassName="bg-primary" />
            </div>
          ) : error ? (
            <div className="px-4 py-12 text-center">
              <p className="text-sm text-destructive">{error}</p>
              <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
                重新載入
              </Button>
            </div>
          ) : routes.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <FileUp className="mx-auto mb-3 size-8 text-muted-foreground/30" aria-hidden />
              <p className="text-sm text-muted-foreground">還沒有上傳任何路線</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Search className="mx-auto mb-3 size-8 text-muted-foreground/30" aria-hidden />
              <p className="text-sm text-muted-foreground">找不到路線</p>
              <p className="mt-1 text-xs text-muted-foreground">請調整搜尋或過濾條件</p>
            </div>
          ) : (
            <ul className="space-y-2 p-3">
              {filtered.map((route) => (
                <PrivateRouteItem
                  key={route.id}
                  route={route}
                  busy={busyId === route.id}
                  onDownload={() => handleDownload(route)}
                  onDelete={() => handleDelete(route)}
                />
              ))}
            </ul>
          )}
        </div>
        {!loading && !error && routes.length > 0 && (
          <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
            {filtered.length} / {routes.length} 條路線
          </p>
        )}
      </aside>

      {/* 右欄：標題＋上傳面板（只在桌機顯示） */}
      <div className="hidden min-w-0 lg:block">
        <PageTitle used={routes.length} limit={limit} />
        <section aria-label="上傳路線" className="mt-5 rounded-2xl border border-border bg-card p-5">
          <button
            type="button"
            disabled={!canUpload}
            onClick={openPicker}
            onDragOver={(e) => {
              if (canUpload) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              handleFile(e.dataTransfer.files?.[0]);
            }}
            className="flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/60 p-10 text-center transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60"
          >
            {uploading ? (
              <Spinner size="lg" dotClassName="bg-primary" />
            ) : (
              <FileUp className="size-10 text-muted-foreground/60" aria-hidden />
            )}
            <span className="mt-3 text-sm font-semibold text-foreground">
              {uploading ? "上傳中…" : full ? "已達路線上限，請先刪除舊路線" : "拖曳 GPX 到這裡，或點一下選擇檔案"}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">單檔 {MAX_MB} MB 以內</span>
          </button>
          {limit != null && <Quota used={routes.length} limit={limit} className="mt-5" />}
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            <li>・只有你看得到</li>
            <li>・刪除路線時檔案一併刪除，無法復原</li>
          </ul>
        </section>
      </div>

      {/* 手機：上傳鈕浮在底部分頁列上方 */}
      <Button
        size="lg"
        disabled={!canUpload}
        onClick={openPicker}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-4 z-20 gap-1.5 rounded-full shadow-lg lg:hidden"
      >
        {uploading ? <Spinner size="sm" dotClassName="bg-primary-foreground" /> : <Upload aria-hidden />}
        {uploadLabel}
      </Button>
    </div>
  );
}

/** 標題「路線」＋分段切換＋說明；手機在清單上方，桌機在右欄 */
function PageTitle({ used, limit, className }: { used: number; limit: number | null; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3">
        <h1 className="mr-auto text-2xl font-black tracking-tight text-foreground sm:text-3xl">路線</h1>
        {limit != null && (
          <span className="text-sm tabular-nums text-muted-foreground lg:hidden">
            {used} / {limit} 條
          </span>
        )}
      </div>
      <RoutesTabs current="mine" />
      <p className="text-sm text-muted-foreground">上傳你的 GPX 路線，只有你自己看得到。</p>
    </div>
  );
}

function Quota({ used, limit, className }: { used: number; limit: number; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">已使用</span>
        <span className="font-semibold tabular-nums text-foreground">
          {used} / {limit} 條
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="路線額度"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary"
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, (used / limit) * 100)}%` }} />
      </div>
    </div>
  );
}

/** 清單項目：樣式比照公開路線頁的 RouteCard；整張卡可點開詳情，下載、刪除收在選單裡 */
function PrivateRouteItem({
  route,
  busy,
  onDownload,
  onDelete,
}: {
  route: PrivateRoute;
  busy: boolean;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const TypeIcon = ROUTE_TYPE_ICONS[route.type as Route["type"]] ?? RouteIcon;
  return (
    <li
      className={cn(
        "relative rounded-xl border border-border/40 bg-card/40 p-3.5 transition-colors hover:bg-card",
        busy && "opacity-60"
      )}
    >
      <div className="flex items-start gap-2">
        <TypeIcon className="mt-0.5 size-3.5 shrink-0 text-strava" aria-hidden />
        <div className="min-w-0 flex-1">
          {/* 點名稱打開詳情與今日判讀；處理中或失敗的路線沒有可讀的 GPX */}
          {route.status === "ready" ? (
            <Link
              href={`/routes/private/${encodeURIComponent(route.id)}`}
              className="break-words text-sm font-semibold text-foreground after:absolute after:inset-0 hover:underline"
            >
              {route.name}
            </Link>
          ) : (
            <p className="break-words text-sm font-semibold text-foreground">{route.name}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {route.distanceKm != null && (
              <span className="inline-flex items-center gap-1">
                <RouteIcon className="size-3" aria-hidden />
                {route.distanceKm.toFixed(1)} km
              </span>
            )}
            {route.elevationGainM != null && (
              <span className="inline-flex items-center gap-1">
                <Mountain className="size-3" aria-hidden />
                {route.elevationGainM} m
              </span>
            )}
            <span>{dateFormat.format(new Date(route.createdAt))}</span>
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="relative z-10 -mr-1.5 -mt-1.5" disabled={busy} aria-label={`${route.name} 的選項`}>
              <MoreVertical aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onDownload}>
              <Download aria-hidden />
              下載 GPX
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 aria-hidden />
              刪除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
