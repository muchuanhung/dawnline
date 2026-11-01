"use client";

import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "../ui/separator";
import { ProfileHeader } from "@/components/profile/profile-header";
import { AccountInfo } from "@/components/profile/account-info";
import { PasswordChange } from "@/components/profile/password-change";
import { useAuth } from "@/contexts/AuthContext";
import { useSignOut } from "@/components/auth/sign-out-button";
function formatJoinedDate(creationTime: string | undefined): string {
  if (!creationTime) return "—";
  return new Date(creationTime).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function ProfileContent() {
  const { user } = useAuth();
  const handleSignOut = useSignOut();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* 導覽由 AppShell 提供，這裡不再放返回鈕；登出在手機也要看得到（舊側欄已移除） */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">個人資料</h1>
          <p className="text-sm text-muted-foreground">管理您的密碼及帳號資訊</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 border-border bg-transparent text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          登出
        </Button>
      </div>

      <Separator className="bg-border" />

      {/* Profile Header */}
      <ProfileHeader
        name={user?.displayName ?? "使用者"}
        email={user?.email ?? ""}
        joinedDate={formatJoinedDate(user?.metadata?.creationTime)}
      />

      {/* Account Info */}
      <AccountInfo
        email={user?.email ?? ""}
        displayName={user?.displayName ?? ""}
      />

      {/* Password */}
      <PasswordChange />

      {/* Bottom padding for scroll */}
      <div className="h-8" />
    </div>
  );
}