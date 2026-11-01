"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { avatarInitials, resolveAvatarUrl, validateAvatarFile } from "@/lib/avatar";
import { avatarErrorMessage, avatarProgressLabel, deleteAvatar, uploadAvatar } from "@/lib/avatar-upload";
import { uploadProgressValue, type UploadProgress } from "@/lib/routes/private-routes";

/**
 * 個人資料頁的頭像：顯示自己上傳的頭像（沒有就用 Google 頭像或姓名縮寫），
 * 右下角常駐相機鈕（觸控裝置沒有 hover，不能藏起來）點了選照片，瀏覽器裁成正方形後上傳。
 */
export function AvatarEditor({ name }: { name: string }) {
  const { user, avatarUrl, setAvatarUrl } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mounted, setMounted] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setMounted(true), []);

  const busy = progress != null || removing;
  const src = resolveAvatarUrl(avatarUrl, user?.photoURL);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const invalid = validateAvatarFile(file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setProgress({ stage: "preparing", percent: null });
    try {
      setAvatarUrl(await uploadAvatar(file, setProgress));
    } catch (err) {
      setError(avatarErrorMessage(err));
    } finally {
      setProgress(null);
    }
  }

  async function onRemove() {
    setError(null);
    setRemoving(true);
    try {
      await deleteAvatar();
      setAvatarUrl(null);
    } catch (err) {
      setError(avatarErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex w-24 flex-col items-center gap-2">
      <div className="relative">
        <Avatar className="h-24 w-24 border-2 border-border">
          {mounted && src && <AvatarImage src={src} alt={name} className="object-cover" />}
          <AvatarFallback className="bg-strava text-2xl font-semibold text-primary-foreground">
            {avatarInitials(name)}
          </AvatarFallback>
        </Avatar>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="更換頭像"
          className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        >
          <Camera className="size-4" aria-hidden />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            // 清掉才能再選同一張
            e.target.value = "";
          }}
        />
      </div>

      {progress ? (
        <div className="w-full space-y-1" role="status">
          <Progress value={uploadProgressValue(progress)} aria-label="頭像上傳進度" />
          <p className="text-center text-xs text-muted-foreground">{avatarProgressLabel(progress)}</p>
        </div>
      ) : avatarUrl ? (
        <button
          type="button"
          onClick={() => void onRemove()}
          disabled={removing}
          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
        >
          {removing ? "移除中…" : "移除頭像"}
        </button>
      ) : null}
      {error && (
        <p role="alert" className="w-40 text-center text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
