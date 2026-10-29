"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Download, FileUp, MoreVertical, Mountain, Pencil, Plus, Route as RouteIcon, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { PrivateRouteDetail } from "@/components/routes/private-route-detail";
import { routeCardClassName } from "@/components/routes/route-card-style";
import { SwipeActions } from "@/components/routes/swipe-actions";
import { RenameRouteSheet } from "@/components/routes/rename-route-sheet";
import { RoutesTabs } from "@/components/routes/routes-tabs";
import { RouteFilters } from "@/components/routes/route-filters";
import { ALL_TYPES, effectiveTypeFilter, matchesTypeFilter, routeTypesOf } from "@/lib/routes/route-types";
import { ROUTE_TYPE_ICONS } from "@/constants";
import { usePrivateRoutes } from "@/hooks/usePrivateRoutes";
import { cn } from "@/lib/utils";
import type { Route } from "@/lib/routes/route-data";
import {
  BackendError,
  GPX_MAX_BYTES,
  privateRouteDownloadUrl,
  quotaHint,
  uploadErrorMessage,
  uploadProgressLabel,
  validateGpxFile,
  type PrivateRoute,
  type UploadProgress,
} from "@/lib/routes/private-routes";
import type { PageTrip } from "@/lib/routes/trip";

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
  trip: PageTrip;
}) {
  const { routes, limit, loading, error, upload, rename, remove, refetch } = usePrivateRoutes();
  const inputRef = useRef<HTMLInputElement>(null);
  // 上傳中的步驟與百分比；null 為沒有在上傳
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  // 最近一次上傳失敗的訊息，桌機上傳面板上保留顯示（toast 會自己消失）
  const [uploadError, setUploadError] = useState<string | null>(null);
  const uploading = progress != null;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState(ALL_TYPES);
  const [selectedId, setSelectedId] = useState(initialRouteId ?? "");
  // 手機：目前左滑打開的路線（同時只開一張）與待確認刪除的路線
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const [confirmRoute, setConfirmRoute] = useState<PrivateRoute | null>(null);
  const [renameTarget, setRenameTarget] = useState<PrivateRoute | null>(null);
  const full = limit != null && routes.length >= limit;
  const canUpload = !uploading && !loading && !full && error == null;

  // 類型篩選的選項依路線資料產生；選的類型已不在資料裡（例如刪掉最後一條）就退回「全部」
  const routeTypes = routeTypesOf(routes);
  const activeTypeFilter = effectiveTypeFilter(typeFilter, routeTypes);
  const filtered = routes.filter(
    (r) => r.name.toLowerCase().includes(search.toLowerCase()) && matchesTypeFilter(r.type, activeTypeFilter)
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
      setUploadError(invalid);
      toast.error(invalid);
      return;
    }
    setUploadError(null);
    setProgress({ stage: "preparing", percent: null });
    try {
      const route = await upload(file, setProgress);
      toast.success(`已上傳「${route.name}」`);
      // 上傳完直接看新路線的判讀
      if (route.status === "ready") select(route.id);
    } catch (err) {
      const message = uploadErrorMessage(err);
      setUploadError(message);
      toast.error(message);
      // 額度已滿等情況代表前端列表過時（例如另一個分頁上傳過），重讀一次
      if (err instanceof BackendError && err.code === "route_limit_reached") refetch();
    } finally {
      setProgress(null);
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

  /** 改名成功才關面板；失敗丟回給面板顯示錯誤 */
  async function handleRename(route: PrivateRoute, name: string) {
    await rename(route.id, name);
    setRenameTarget(null);
    toast.success("已改名");
  }

  /** 桌機用瀏覽器確認框；手機從底部滑出確認面板，按鈕比較好點 */
  function requestDelete(route: PrivateRoute) {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      setConfirmRoute(route);
      return;
    }
    if (window.confirm(`刪除「${route.name}」？檔案會一併刪除，無法復原。`)) handleDelete(route);
  }

  async function handleDelete(route: PrivateRoute) {
    setConfirmRoute(null);
    setSwipedId(null);
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

      {/* 標題與切換：手機在清單上方；桌機的切換在清單頂端，不另放標題 */}
      <PageTitle used={routes.length} limit={limit} className="lg:hidden" />

      {/* 路線清單：桌機和公開路線頁一樣固定在左側 */}
      <aside
        aria-label="我的路線清單"
        className="mt-5 overflow-hidden rounded-2xl border border-border bg-card lg:sticky lg:top-24 lg:mt-0 lg:flex lg:max-h-[calc(100dvh-8rem)] lg:flex-col"
      >
        {/* 桌機：探索／我的路線切換放在清單頂端（切換的是這份清單）；手機在頁面標題下方 */}
        <div className="hidden border-b border-border p-3 lg:block">
          <h1 className="sr-only">路線</h1>
          <RoutesTabs current="mine" className="sm:w-full" />
        </div>
        <div className="border-b border-border p-4">
          <RouteFilters search={search} onSearch={setSearch} types={routeTypes} typeFilter={activeTypeFilter} onFilter={setTypeFilter} />
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
            <ul
              className="space-y-2 p-3"
              // 有卡片左滑打開時，點清單其他地方只收合，不開路線（同 iOS 郵件）
              onClickCapture={(e) => {
                if (swipedId == null || (e.target as Element).closest("[data-swipe-actions]")) return;
                e.preventDefault();
                e.stopPropagation();
                setSwipedId(null);
              }}
            >
              {/* 第一格「上傳新路線」：桌機選取後右側顯示上傳面板，手機直接選檔 */}
              <li>
                <button
                  type="button"
                  disabled={full || uploading}
                  onClick={() => (window.matchMedia(DESKTOP_QUERY).matches ? select(UPLOAD_ITEM) : openPicker())}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-xl border border-dashed border-border p-3.5 text-left text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60",
                    showUploadPanel && "lg:border-solid lg:border-primary lg:bg-accent lg:text-accent-foreground",
                    // 上傳中雖然停用，進度文字仍要清楚
                    uploading && "disabled:cursor-progress disabled:opacity-100"
                  )}
                >
                  {/* 桌機右側面板已有進度條，清單這格只留文字；手機沒有面板，保留 spinner */}
                  {uploading && <Spinner size="sm" dotClassName="bg-primary" className="lg:hidden" />}
                  <Plus className={cn("size-4", uploading && "hidden lg:block")} aria-hidden />
                  <span className="mr-auto" aria-live="polite">
                    {progress ? uploadProgressLabel(progress) : full ? "已達路線上限" : "上傳新路線"}
                  </span>
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
                    swipeOpen={swipedId === route.id}
                    onSwipeOpenChange={(open) => setSwipedId(open ? route.id : null)}
                    onSelect={() => select(route.id)}
                    onDownload={() => handleDownload(route)}
                    onRename={() => {
                      setSwipedId(null);
                      setRenameTarget(route);
                    }}
                    onDelete={() => requestDelete(route)}
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

      {/* 右欄（只在桌機顯示）：選取路線的判讀；沒有路線或選了「上傳新路線」時顯示上傳面板 */}
      <div className="hidden min-w-0 space-y-5 lg:block">
        {loading ? null : showUploadPanel ? (
          <UploadPanel
            canUpload={canUpload}
            progress={progress}
            error={uploadError}
            full={full}
            used={routes.length}
            limit={limit}
            onPick={openPicker}
            onFile={handleFile}
          />
        ) : (
          // key 含名稱：改名後重新載入詳情，標題跟著更新（GPX 解析有伺服器端快取）
          <PrivateRouteDetail key={`${selectedRoute.id}:${selectedRoute.name}`} routeId={selectedRoute.id} trip={trip} embedded />
        )}
      </div>

      <RenameRouteSheet route={renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)} onRename={handleRename} />

      {/* 手機刪除確認 */}
      <Drawer open={confirmRoute != null} onOpenChange={(open) => !open && setConfirmRoute(null)}>
        <DrawerContent className="bg-card pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-foreground">刪除「{confirmRoute?.name}」？</DrawerTitle>
            <DrawerDescription>GPX 檔案會一併刪除，無法復原。</DrawerDescription>
          </DrawerHeader>
          <div className="grid gap-2 px-4">
            <Button variant="destructive" size="lg" onClick={() => confirmRoute && handleDelete(confirmRoute)}>
              刪除
            </Button>
            <Button variant="outline" size="lg" onClick={() => setConfirmRoute(null)}>
              取消
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

interface UploadProps {
  canUpload: boolean;
  /** 上傳中的步驟與百分比；null 為沒有在上傳 */
  progress: UploadProgress | null;
  /** 最近一次上傳失敗的訊息 */
  error: string | null;
  full: boolean;
  used: number;
  limit: number | null;
  onPick: () => void;
  onFile: (file: File | undefined) => void;
}

/** 完整上傳面板：拖放區＋進度＋錯誤＋額度＋規則 */
function UploadPanel({ canUpload, progress, error, full, used, limit, onPick, onFile }: UploadProps) {
  const uploading = progress != null;
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
        className={cn(
          "flex w-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-background/60 p-10 text-center transition-colors hover:bg-background disabled:cursor-not-allowed disabled:opacity-60",
          // 上傳中雖然停用，進度條與文字仍要清楚
          uploading && "disabled:cursor-progress disabled:opacity-100"
        )}
      >
        {uploading ? (
          <Spinner size="lg" dotClassName="bg-primary" />
        ) : (
          <FileUp className="size-10 text-muted-foreground/60" aria-hidden />
        )}
        <span className="mt-3 text-sm font-semibold text-foreground" aria-live="polite">
          {progress ? uploadProgressLabel(progress) : full ? "已達路線上限，請先刪除舊路線" : "拖曳 GPX 到這裡，或點一下選擇檔案"}
        </span>
        {progress ? (
          // 準備與解析沒有百分比：準備顯示 0、解析顯示滿格，搭配文字說明目前步驟
          <Progress
            aria-label="上傳進度"
            value={progress.stage === "processing" ? 100 : (progress.percent ?? 0)}
            className="mt-3 max-w-xs"
          />
        ) : (
          <span className="mt-1 text-xs text-muted-foreground">單檔 {MAX_MB} MB 以內</span>
        )}
      </button>
      {error && !uploading && (
        <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {limit != null && <Quota used={used} limit={limit} className="mt-5" />}
      <p className="mt-4 text-xs text-muted-foreground">刪除路線時檔案一併刪除，無法復原</p>
    </section>
  );
}

/** 標題「路線」＋分段切換＋額度；只在手機顯示，在清單上方 */
function PageTitle({ used, limit, className }: { used: number; limit: number | null; className?: string }) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3">
        <h1 className="mr-auto text-2xl font-black tracking-tight text-foreground sm:text-3xl">路線</h1>
        {limit != null && (
          <span className="text-sm tabular-nums text-muted-foreground">
            {used} / {limit} 條
          </span>
        )}
      </div>
      {limit != null && quotaHint(used, limit) && <p className="text-xs text-muted-foreground">{quotaHint(used, limit)}</p>}
      <RoutesTabs current="mine" />
    </div>
  );
}

function Quota({ used, limit, className }: { used: number; limit: number; className?: string }) {
  const hint = quotaHint(used, limit);
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
      {hint && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * 清單項目：外框樣式與公開路線頁的 RouteCard 共用。
 * 整張卡可點：桌機切換右側判讀，手機進詳情頁（連結保留，新分頁開啟也能用）。
 * 改名、下載、刪除：桌機收在 ⋮ 選單；手機左滑露出（三顆按鈕共用 SWIPE_ACTIONS_WIDTH）。
 */
function PrivateRouteItem({
  route,
  selected,
  busy,
  swipeOpen,
  onSwipeOpenChange,
  onSelect,
  onDownload,
  onRename,
  onDelete,
}: {
  route: PrivateRoute;
  selected: boolean;
  busy: boolean;
  swipeOpen: boolean;
  onSwipeOpenChange: (open: boolean) => void;
  onSelect: () => void;
  onDownload: () => void;
  onRename: () => void;
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
    <li className={cn(busy && "opacity-60")}>
      <SwipeActions
        open={swipeOpen}
        onOpenChange={onSwipeOpenChange}
        disabled={busy}
        actions={
          <>
            <button
              type="button"
              onClick={onRename}
              className="flex flex-1 flex-col items-center justify-center gap-1 bg-secondary text-xs font-medium text-foreground"
            >
              <Pencil className="size-5" aria-hidden />
              改名
            </button>
            <button
              type="button"
              onClick={() => {
                onSwipeOpenChange(false);
                onDownload();
              }}
              className="flex flex-1 flex-col items-center justify-center gap-1 border-l border-border bg-secondary text-xs font-medium text-foreground"
            >
              <Download className="size-5" aria-hidden />
              下載
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-xs font-medium text-white"
            >
              <Trash2 className="size-5" aria-hidden />
              刪除
            </button>
          </>
        }
      >
        <div className={routeCardClassName({ selected, selectedOn: "desktop", className: "relative" })}>
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
            {/* 桌機的 ⋮ 選單；手機改用左滑 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="relative z-10 -mr-1.5 -mt-1.5 hidden lg:inline-flex"
                  disabled={busy}
                  aria-label={`${route.name} 的選項`}
                >
                  <MoreVertical aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil aria-hidden />
                  改名
                </DropdownMenuItem>
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
        </div>
      </SwipeActions>
    </li>
  );
}
