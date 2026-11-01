"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import type { Route } from "@/lib/routes/route-data";
import {
  GPX_MAX_BYTES,
  uploadProgressLabel,
  uploadProgressValue,
  validateGpxFile,
  type UploadProgress,
} from "@/lib/routes/private-routes";
import {
  SLUG_MAX,
  adminErrorMessage,
  publishPublicRoute,
  publishResultMessage,
  slugFromFile,
  unpublishPublicRoute,
  validateSlug,
} from "@/lib/routes/admin-public-routes";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * 管理員專用：新增／覆寫／下架公開路線（取代到 EC2 跑匯入腳本）。
 * 只有 isAdmin 時由 RoutesClient 顯示入口；權限由後端擋，這裡只是介面。
 * 手機為底部 Drawer、桌機為置中對話框（同 RenameRouteSheet）。
 */
export function AdminPublicRoutesSheet({
  routes,
  onChanged,
  className,
}: {
  /** 目前的公開路線（判斷同 id 是否覆寫、下架清單） */
  routes: Route[];
  /** 新增或下架成功後重新讀清單 */
  onChanged: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    setDesktop(mq.matches);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const trigger = (
    <Button variant="outline" size="sm" className={className} onClick={() => setOpen(true)}>
      <Settings2 className="size-3.5" aria-hidden />
      管理公開路線
    </Button>
  );
  const title = "管理公開路線";
  const description = "所有人都看得到；同一個網址 id 會覆寫原路線，收藏保留";
  const body = <AdminBody routes={routes} onChanged={onChanged} />;

  if (desktop) {
    return (
      <>
        {trigger}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-lg rounded-2xl">
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription>{description}</DialogDescription>
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <>
      {trigger}
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent className="max-h-[85vh] bg-card pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-foreground">{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4">{body}</div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function AdminBody({ routes, onChanged }: { routes: Route[]; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [slug, setSlug] = useState("");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const busy = progress != null || removing != null;
  // 同 id 已存在 → 送出會覆寫，按鈕文字跟著變
  const existing = routes.find((r) => r.id === slug.trim());

  function pick(f: File | undefined) {
    if (!f) return;
    setNotice(null);
    const invalid = validateGpxFile(f, GPX_MAX_BYTES);
    if (invalid) {
      setError(invalid);
      return;
    }
    setFile(f);
    setSlug(slugFromFile(f.name));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    const invalid = validateSlug(slug);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (existing && !window.confirm(`覆寫「${existing.name}」？網址與收藏會保留。`)) return;
    setError(null);
    try {
      const result = await publishPublicRoute(file, slug, setProgress);
      setNotice(publishResultMessage(result));
      setFile(null);
      setSlug("");
      if (fileRef.current) fileRef.current.value = "";
      onChanged();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setProgress(null);
    }
  }

  async function unpublish(route: Route) {
    if (!window.confirm(`下架「${route.name}」？所有人的收藏會一併移除，檔案會刪除。`)) return;
    setRemoving(route.id);
    setError(null);
    setNotice(null);
    try {
      await unpublishPublicRoute(route.id);
      setNotice(`已下架「${route.name}」`);
      onChanged();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="space-y-5 pb-2">
      <form onSubmit={submit} className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".gpx,application/gpx+xml"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <Button type="button" variant="outline" className="w-full gap-2" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="size-4" aria-hidden />
          {file ? file.name : "選擇 GPX 檔"}
        </Button>
        {file && (
          <div>
            <label htmlFor="admin-slug" className="mb-1 block text-xs text-muted-foreground">
              網址 id（之後不要改）
            </label>
            <Input
              id="admin-slug"
              value={slug}
              maxLength={SLUG_MAX}
              disabled={busy}
              onChange={(e) => {
                setSlug(e.target.value);
                setError(null);
              }}
              className="h-11 text-base"
            />
            {existing && <p className="mt-1 text-xs text-amber-600">已有「{existing.name}」，送出會覆寫</p>}
          </div>
        )}
        {progress && (
          <div className="space-y-1" aria-live="polite">
            <Progress aria-label="上傳進度" value={uploadProgressValue(progress)} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{uploadProgressLabel(progress)}</p>
          </div>
        )}
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        {notice && !error && <p className="text-xs text-emerald-600">{notice}</p>}
        {file && (
          <Button type="submit" className="w-full" disabled={busy}>
            {existing ? "覆寫公開路線" : "新增公開路線"}
          </Button>
        )}
      </form>

      <div>
        <p className="mb-2 text-xs font-semibold text-muted-foreground">目前 {routes.length} 條</p>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {routes.map((route) => (
            <li key={route.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{route.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{route.id}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0 text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => unpublish(route)}
              >
                {removing === route.id ? "下架中…" : "下架"}
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
