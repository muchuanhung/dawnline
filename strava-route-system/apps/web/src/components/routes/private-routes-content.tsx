"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileUp, MoreVertical, Mountain, Plus, Route as RouteIcon, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PrivateRouteDetail } from "@/components/routes/private-route-detail";
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
import type { Activity } from "@/lib/routes/trip";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });
const MAX_MB = Math.round(GPX_MAX_BYTES / 1024 / 1024);
/** 與 Tailwind lg 斷點一致：桌機點清單只切換右側，手機進詳情頁 */
const DESKTOP_QUERY = "(min-width: 1024px)";

/** 清單第一格「上傳新路線」的選取 id（不會和 ULID 衝突） */
const UPLOAD_ITEM = "upload";

/**
 * 私人路線：版型對齊公開路線頁。
 * 桌機左側為路線清單（搜尋＋類型篩選），右側為選取路線的今日判讀；點清單只切換右側，不換頁。
 * 清單第一格是「上傳新路線」：桌機點了右側換成上傳面板，手機點了直接選檔。
 * 手機依序為標題、清單，點路線進詳情頁。
 */
export function PrivateRoutesContent({
  initialRouteId,
  trip,
}: {
  initialRouteId?: string;
  /** 網址上的行程設定（出發時間 ISO、運動類型），未指定為 null */
  trip: { depart: string | null; activity: Activity | null };
}) {
  const { routes, limit, loading, error, upload, remove, refetch } = usePrivateRoutes();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("全部");
  const [selectedId, setSelectedId] = useState(initialRouteId ?? "");
  const full = limit != null && routes.length >= limit;
  const canUpload = !uploading && !loading && !full && error == null;

  const filtered = routes.filter(
    (r) => r.name.toLowerCase().includes(search.toLowerCase()) && matchesTypeFilter(r.type, typeFilter)
  );
  const readyRoutes = routes.filter((r) => r.status === "ready");
  // 沒指定或指定的路線不存在時，退回第一條可判讀的路線；選了「上傳新路線」時顯示上傳面板
  const selectedRoute =
    selectedId === UPLOAD_ITEM ? null : (readyRoutes.find((r) => r.id === selectedId) ?? readyRoutes[0] ?? null);
  const showUploadPanel = selectedRoute == null;

  function select(id: string) {
    setSelectedId(id);
    // 同步網址，重新整理後停在同一條路線（不觸發伺服器請求）
    window.history.replaceState(null, "", id === UPLOAD_ITEM ? window.location.pathname : `?route=${encodeURIComponent(id)}`);
  }

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
      // 上傳完直接看新路線的判讀
      if (route.status === "ready") select(route.id);
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

  return (
    <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-8">
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
          ) : (
            <ul className="space-y-2 p-3">
              {/* 第一格「上傳新路線」：桌機選取後右側顯示上傳面板，手機直接選檔 */}
              <li>
                <button
                  type="button"
                  disabled={full || uploading}
                  onClick={() => (window.matchMedia(DESKTOP_QUERY).matches ? select(UPLOAD_ITEM) : openPicker())}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl border border-dashed border-border p-3.5 text-left text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60",
                    showUploadPanel && "lg:border-solid lg:border-primary lg:bg-accent lg:text-accent-foreground"
                  )}
                >
                  {uploading ? <Spinner size="sm" dotClassName="bg-primary" /> : <Plus className="size-4" aria-hidden />}
                  <span className="mr-auto">{uploading ? "上傳中…" : full ? "已達路線上限" : "上傳新路線"}</span>
                  {limit != null && (
                    <span className="text-xs font-normal tabular-nums text-muted-foreground">
                      {routes.length} / {limit}
                    </span>
                  )}
                </button>
              </li>
              {routes.length === 0 ? (
                <li className="px-4 py-12 text-center">
                  <FileUp className="mx-auto mb-3 size-8 text-muted-foreground/30" aria-hidden />
                  <p className="text-sm text-muted-foreground">還沒有上傳任何路線</p>
                </li>
              ) : filtered.length === 0 ? (
                <li className="px-4 py-12 text-center">
                  <Search className="mx-auto mb-3 size-8 text-muted-foreground/30" aria-hidden />
                  <p className="text-sm text-muted-foreground">找不到路線</p>
                  <p className="mt-1 text-xs text-muted-foreground">請調整搜尋或過濾條件</p>
                </li>
              ) : (
                filtered.map((route) => (
                  <PrivateRouteItem
                    key={route.id}
                    route={route}
                    selected={route.id === selectedRoute?.id}
                    busy={busyId === route.id}
                    onSelect={() => select(route.id)}
                    onDownload={() => handleDownload(route)}
                    onDelete={() => handleDelete(route)}
                  />
                ))
              )}
            </ul>
          )}
        </div>
        {!loading && !error && routes.length > 0 && (
          <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
            {filtered.length} / {routes.length} 條路線
          </p>
        )}
      </aside>

      {/* 右欄（只在桌機顯示）：標題＋選取路線的判讀；沒有路線或選了「上傳新路線」時顯示上傳面板 */}
      <div className="hidden min-w-0 space-y-5 lg:block">
        <PageTitle used={routes.length} limit={limit} />
        {loading ? null : showUploadPanel ? (
          <UploadPanel
            canUpload={canUpload}
            uploading={uploading}
            full={full}
            used={routes.length}
            limit={limit}
            onPick={openPicker}
            onFile={handleFile}
          />
        ) : (
          <PrivateRouteDetail key={selectedRoute.id} routeId={selectedRoute.id} trip={trip} embedded />
        )}
      </div>
    </div>
  );
}

interface UploadProps {
  canUpload: boolean;
  uploading: boolean;
  full: boolean;
  used: number;
  limit: number | null;
  onPick: () => void;
  onFile: (file: File | undefined) => void;
}

/** 完整上傳面板：拖放區＋額度＋規則 */
function UploadPanel({ canUpload, uploading, full, used, limit, onPick, onFile }: UploadProps) {
  return (
    <section aria-label="上傳路線" className="rounded-2xl border border-border bg-card p-5">
      <button
        type="button"
        disabled={!canUpload}
        onClick={onPick}
        onDragOver={(e) => {
          if (canUpload) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onFile(e.dataTransfer.files?.[0]);
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
      {limit != null && <Quota used={used} limit={limit} className="mt-5" />}
      <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
        <li>・只有你看得到</li>
        <li>・刪除路線時檔案一併刪除，無法復原</li>
      </ul>
    </section>
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

/**
 * 清單項目：樣式比照公開路線頁的 RouteCard；下載、刪除收在選單裡。
 * 整張卡可點：桌機切換右側判讀，手機進詳情頁（連結保留，新分頁開啟也能用）。
 */
function PrivateRouteItem({
  route,
  selected,
  busy,
  onSelect,
  onDownload,
  onDelete,
}: {
  route: PrivateRoute;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const TypeIcon = ROUTE_TYPE_ICONS[route.type as Route["type"]] ?? RouteIcon;
  function handleClick(e: React.MouseEvent) {
    // 修飾鍵（開新分頁）照連結行為
    if (e.metaKey || e.ctrlKey || e.shiftKey || !window.matchMedia(DESKTOP_QUERY).matches) return;
    e.preventDefault();
    onSelect();
  }
  return (
    <li
      className={cn(
        "relative rounded-xl border border-border/40 bg-card/40 p-3.5 transition-colors",
        // 清單底色就是 card，hover 改用 secondary 才看得出來；選取樣式同公開路線頁 RouteCard（手機點了會換頁，不需要）
        selected
          ? "hover:border-border hover:bg-secondary/60 lg:border-strava/30 lg:bg-strava/8 lg:ring-1 lg:ring-strava/20 lg:hover:border-strava/30 lg:hover:bg-strava/8"
          : "hover:border-border hover:bg-secondary/60",
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
              onClick={handleClick}
              aria-current={selected ? "true" : undefined}
              className="break-words text-sm font-semibold text-foreground after:absolute after:inset-0"
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
