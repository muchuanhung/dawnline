"use client";

import Link from "next/link";
import { ChevronDown, LogIn, LogOut, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { useSignOut } from "@/components/auth/sign-out-button";
import { getProxiedAvatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";

/** 名牌上的短名：顯示名稱的第一個字詞，沒有時用 Email @ 前段 */
function shortName(displayName: string | null | undefined, email: string | null | undefined): string {
  const name = displayName?.trim().split(/\s+/)[0];
  return name || email?.split("@")[0] || "使用者";
}

/** 桌機頂部導覽右側：頭像＋名字的名牌，點開為帳號選單（個人資料、登出） */
export function UserMenu({ active }: { active: boolean }) {
  const { user, loading, cachedProfile } = useAuth();
  const handleSignOut = useSignOut();

  if (loading) {
    // 重新整理後 Firebase 還原登入狀態前：有上次登入者的資料就直接畫名牌，不閃載入動畫
    if (cachedProfile) {
      return (
        <UserMenuView
          active={active}
          displayName={cachedProfile.displayName}
          email={cachedProfile.email}
          avatarUrl={getProxiedAvatarUrl(cachedProfile.photoURL)}
          onSignOut={handleSignOut}
        />
      );
    }
    // 沒有快取（第一次來、或伺服器渲染）：靜態佔位，和名牌同尺寸，避免載入完把版面推開
    return <div aria-hidden className="h-10 w-32 rounded-full border border-border bg-card" />;
  }
  // Auth resolved with no user (e.g. guest browsing public routes): offer sign-in instead of a spinner that never ends
  if (!user) {
    return (
      <Button asChild variant="outline" className="h-10 rounded-full px-4">
        <Link href="/login">
          <LogIn aria-hidden />
          登入
        </Link>
      </Button>
    );
  }
  return (
    <UserMenuView
      active={active}
      displayName={user.displayName}
      email={user.email}
      avatarUrl={getProxiedAvatarUrl(user.photoURL)}
      onSignOut={handleSignOut}
    />
  );
}

export interface UserMenuViewProps {
  /** 目前在個人資料頁 */
  active: boolean;
  displayName: string | null;
  email: string | null;
  avatarUrl: string | undefined;
  onSignOut: () => void;
}

/** 帳號選單的畫面（不讀登入狀態，資料由 UserMenu 傳入） */
export function UserMenuView({ active, displayName, email, avatarUrl, onSignOut }: UserMenuViewProps) {
  const name = shortName(displayName, email);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`帳號選單：${name}`}
        className={cn(
          "flex h-10 items-center gap-2.5 rounded-full border bg-card py-1 pl-1 pr-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-secondary",
          active ? "border-primary/40" : "border-border"
        )}
      >
        <Avatar className="size-8">
          <AvatarImage src={avatarUrl} alt="" />
          <AvatarFallback className="bg-gradient-to-br from-[#f6d38f] to-[#e9a35a] font-bold text-[#3b2a10]">
            {name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="max-w-[8rem] truncate">{name}</span>
        <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-xl p-1.5">
        <DropdownMenuLabel className="px-3 py-2 font-normal">
          <span className="block truncate font-bold text-foreground">{displayName || name}</span>
          {email && <span className="block truncate text-xs text-muted-foreground">{email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="rounded-lg px-3 py-2">
          <Link href="/profile" aria-current={active ? "page" : undefined}>
            <User aria-hidden />
            個人資料
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" className="rounded-lg px-3 py-2" onSelect={onSignOut}>
          <LogOut aria-hidden />
          登出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
