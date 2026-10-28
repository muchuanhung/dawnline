"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ROUTE_NAME_MAX, validateRouteName, type PrivateRoute } from "@/lib/routes/private-routes";

const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * 私人路線改名：手機為底部 Drawer、桌機為置中對話框（同 SpeedSheet）。
 * 送出前先做前端檢查；失敗時錯誤顯示在輸入框下方，面板不關。
 */
export function RenameRouteSheet({
  route,
  onOpenChange,
  onRename,
}: {
  /** 要改名的路線；null 為關閉 */
  route: PrivateRoute | null;
  onOpenChange: (open: boolean) => void;
  onRename: (route: PrivateRoute, name: string) => Promise<void>;
}) {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_QUERY);
    setDesktop(mq.matches);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const open = route != null;
  const title = "重新命名路線";
  const description = "只改顯示名稱，GPX 檔案與判讀不受影響";
  // key：每次打開都以目前名稱重置草稿
  const body = route && <RenameForm key={route.id} route={route} onCancel={() => onOpenChange(false)} onRename={onRename} />;

  if (desktop) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="bg-card pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-foreground">{title}</DrawerTitle>
          <DrawerDescription>{description}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4">{body}</div>
      </DrawerContent>
    </Drawer>
  );
}

function RenameForm({
  route,
  onCancel,
  onRename,
}: {
  route: PrivateRoute;
  onCancel: () => void;
  onRename: (route: PrivateRoute, name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(route.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const unchanged = draft.trim() === route.name;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateRouteName(draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    if (unchanged) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onRename(route, draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : "改名失敗，請再試一次");
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <Input
          autoFocus
          aria-label="路線名稱"
          aria-invalid={error != null}
          value={draft}
          maxLength={ROUTE_NAME_MAX}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          className="h-11 text-base"
        />
        <div className="mt-1.5 flex justify-between gap-3 text-xs">
          <span className="text-destructive" role={error ? "alert" : undefined}>
            {error}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {draft.trim().length} / {ROUTE_NAME_MAX}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button type="submit" size="lg" disabled={saving}>
          {saving ? "儲存中…" : "儲存"}
        </Button>
      </div>
    </form>
  );
}
