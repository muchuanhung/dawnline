"use client";

import { useRef, useState } from "react";
import { Download, FileUp, Mountain, Route as RouteIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import { usePrivateRoutes } from "@/hooks/usePrivateRoutes";
import { privateRouteDownloadUrl, validateGpxFile, type PrivateRoute } from "@/lib/routes/private-routes";

const dateFormat = new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium" });

/** 私人路線：上傳 GPX 到 S3（每人上限由後端決定）、列出、下載與刪除 */
export function PrivateRoutesContent() {
  const { routes, limit, loading, error, upload, remove, refetch } = usePrivateRoutes();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const full = limit != null && routes.length >= limit;

  async function handleFile(file: File | undefined) {
    if (!file) return;
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

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="mr-auto text-2xl font-black tracking-tight text-foreground sm:text-3xl">私人路線</h1>
        {limit != null && (
          <span className="text-sm text-muted-foreground">
            {routes.length} / {limit} 條
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">上傳你的 GPX 路線，只有你自己看得到。</p>

      <input
        ref={inputRef}
        type="file"
        accept=".gpx,application/gpx+xml"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={uploading || loading || full || error != null}
        onClick={() => inputRef.current?.click()}
        className="mt-6 flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card p-10 text-center transition-colors hover:bg-card/70 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {uploading ? (
          <Spinner size="lg" dotClassName="bg-primary" />
        ) : (
          <FileUp className="size-10 text-muted-foreground/60" aria-hidden />
        )}
        <span className="mt-4 text-sm font-semibold text-foreground">
          {uploading ? "上傳中…" : full ? "已達路線上限，請先刪除舊路線" : "選擇 GPX 檔案上傳"}
        </span>
        <span className="mt-1 text-xs text-muted-foreground">單檔 5 MB 以內</span>
      </button>

      <div className="mt-6">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" dotClassName="bg-primary" />
          </div>
        ) : error ? (
          <div className="py-12 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={refetch}>
              重新載入
            </Button>
          </div>
        ) : routes.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">還沒有上傳任何路線</p>
        ) : (
          <ul className="space-y-2">
            {routes.map((route) => (
              <li
                key={route.id}
                className="flex items-center gap-3 rounded-xl border border-border/40 bg-card/40 p-3.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold text-foreground">{route.name}</p>
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`下載 ${route.name}`}
                  disabled={busyId === route.id}
                  onClick={() => handleDownload(route)}
                >
                  <Download aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`刪除 ${route.name}`}
                  disabled={busyId === route.id}
                  onClick={() => handleDelete(route)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
