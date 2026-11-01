"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { avatarInitials, resolveAvatarUrl, validateAvatarFile } from "@/lib/avatar";
import { avatarErrorMessage, avatarProgressLabel, deleteAvatar, uploadAvatar } from "@/lib/avatar-upload";
import { uploadProgressValue, type UploadProgress } from "@/lib/routes/private-routes";

/** Google 登入的帳號由 Google 帶入頭像，不提供上傳 */
function signedInWithGoogle(user: { providerData: { providerId: string }[] } | null): boolean {
  return !!user?.providerData.some((p) => p.providerId === "google.com");
}

/**
 * 個人資料頁的頭像：顯示自己上傳的頭像（沒有就用 Google 頭像或姓名縮寫）。
 * 只有 Email 註冊的帳號能上傳：滑鼠移到頭像上才浮出相機（主流做法）；觸控裝置沒有 hover，點頭像本身就會開選照片。
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
  const canUpload = mounted && !signedInWithGoogle(user);

  const avatar = (
    <Avatar className="h-24 w-24 border-2 border-border">
      {mounted && src && <AvatarImage src={src} alt={name} className="object-cover" />}
      <AvatarFallback className="bg-strava text-2xl font-semibold text-primary-foreground">
        {avatarInitials(name)}
      </AvatarFallback>
    </Avatar>
  );

  if (!canUpload) return avatar;

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
      {/* The whole avatar is the button: camera overlay shows on hover/keyboard focus; a tap on touch opens the picker */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="更換頭像"
        className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait"
      >
        {avatar}
        <span
          aria-hidden
          className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        >
          <Camera className="size-5 text-foreground" />
        </span>
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
