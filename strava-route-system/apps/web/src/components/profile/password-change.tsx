"use client";

import React, { useState } from "react";
import { Shield, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import Spinner from "@/components/ui/Spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/AuthContext";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

/** 是否為僅用 OAuth（如 Google）登入，無法在應用內變更密碼 */
function isOAuthOnly(providerData: { providerId: string }[]): boolean {
  const hasEmail = providerData.some((p) => p.providerId === "password");
  return !hasEmail && providerData.length > 0;
}

export function PasswordChange() {
  const { user } = useAuth();
  const oauthOnly = user ? isOAuthOnly(user.providerData) : false;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const passwordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const isMinLength = newPassword.length >= 8;
  const canSubmit =
    currentPassword.length > 0 &&
    isMinLength &&
    passwordsMatch &&
    !isLoading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (!passwordsMatch) {
      setError("新密碼不相符。");
      return;
    }

    if (!isMinLength) {
      setError("密碼必須至少 8 個字元。");
      return;
    }

    if (!user?.email) {
      setError("無法取得目前帳號，請重新登入後再試。");
      return;
    }

    setIsLoading(true);

    try {
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? (err as { code: string }).code : "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setError("目前密碼錯誤，請重新輸入。");
      } else if (code === "auth/requires-recent-login") {
        setError("為確保安全，請重新登入後再變更密碼。");
      } else {
        setError("更新密碼失敗，請稍後再試。");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
            <Shield className="h-4 w-4 text-strava" />
          </div>
          <div>
            <CardTitle className="text-base text-foreground">密碼更改</CardTitle>
            <CardDescription>更新您的密碼以保持帳號安全。</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {oauthOnly ? (
          <Alert className="border-border bg-secondary/30">
            <AlertDescription>
              您目前使用 Google 等第三方帳號登入，應用內無法變更密碼。若要修改登入密碼，請至
              <a
                href="https://myaccount.google.com/security"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-1 font-medium text-strava hover:underline"
              >
                Google 帳戶安全性設定
              </a>
              操作。
            </AlertDescription>
          </Alert>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Success Alert */}
          {success && (
            <Alert className="border-success/30 bg-success/10 text-success">
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>密碼更新成功。</AlertDescription>
            </Alert>
          )}

          {/* Error Alert */}
          {error && (
            <Alert variant="destructive" className="border-destructive/30 bg-destructive/10">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Current Password */}
          <div className="space-y-2">
            <Label htmlFor="current-password" className="text-sm text-foreground">
              目前密碼
            </Label>
            <div className="relative">
              <Input
                id="current-password"
                type={showCurrent ? "text" : "password"}
                placeholder="輸入目前密碼"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-secondary pr-10 text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showCurrent ? "Hide password" : "Show password"}
              >
                {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* New Password */}
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-sm text-foreground">
              新密碼
            </Label>
            <div className="relative">
              <Input
                id="new-password"
                type={showNew ? "text" : "password"}
                placeholder="至少 8 個字元"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError(null);
                  setSuccess(false);
                }}
                className="bg-secondary pr-10 text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {/* Strength indicators */}
            {newPassword.length > 0 && (
              <div className="flex items-center gap-2 pt-1">
                <div className="flex flex-1 gap-1">
                  <div
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      newPassword.length >= 4 ? "bg-strava" : "bg-secondary"
                    }`}
                  />
                  <div
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      newPassword.length >= 8 ? "bg-strava" : "bg-secondary"
                    }`}
                  />
                  <div
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      newPassword.length >= 12 ? "bg-success" : "bg-secondary"
                    }`}
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {newPassword.length < 4
                    ? "弱"
                    : newPassword.length < 8
                      ? "普通"
                      : newPassword.length < 12
                        ? "良好"
                        : "強"}
                </span>
              </div>
            )}
          </div>

          {/* Confirm New Password */}
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-sm text-foreground">
              確認新密碼
            </Label>
            <div className="relative">
              <Input
                id="confirm-password"
                type={showConfirm ? "text" : "password"}
                placeholder="重複新密碼"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError(null);
                  setSuccess(false);
                }}
                className="bg-secondary pr-10 text-foreground placeholder:text-muted-foreground"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showConfirm ? "Hide password" : "Show password"}
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {confirmPassword.length > 0 && !passwordsMatch && (
              <p className="text-xs text-destructive">密碼不相符。</p>
            )}
            {passwordsMatch && (
              <p className="text-xs text-success flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" />
                密碼相符
              </p>
            )}
          </div>

          <Button
            type="submit"
            disabled={!canSubmit}
            className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Spinner size="sm" className="mr-2" dotClassName="bg-current" />
                更新中...
              </>
            ) : (
              "更新密碼"
            )}
          </Button>
        </form>
        )}
      </CardContent>
    </Card>
  );
}