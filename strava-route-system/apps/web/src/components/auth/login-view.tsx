"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AuthForm } from "@/components/auth/auth-form";
import { LoginHero, loginCopy } from "@/components/auth/login-hero";
import { FeatureList } from "@/components/auth/feature-list";
import { DawnSceneBackground } from "@/components/auth/dawn-scene-background";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { motion } from "framer-motion";
import Link from "next/link";
import { ProductLogo } from "@/components/ui/product-logo";

/** 入口頁（/ 與 /login）：左側品牌＋精選路線即時判定，右側登入表單；手機版不顯示精選路線 */
export function LoginView({ featured }: { featured: ReactNode }) {
  const router = useRouter();
  const auth = useAuth();
  const { user, loading: authLoading, refreshSession, signIn, signInWithEmail, signUpWithEmail, sendPasswordReset } =
    auth;

  // 已登入則先更新 session cookie（避免 idToken 過期導致 dashboard ↔ login 導向迴圈），再導向 dashboard。
  // 只等 Next 的 cookie：/dashboard 只認這份；FastAPI 的 rc_session 在背景換完，私人路線靠 sessionReady 等它
  useEffect(() => {
    if (authLoading) return;
    if (user) {
      refreshSession({ waitForBackend: false })
        .then(() => router.replace("/dashboard"))
        .catch(() => router.replace("/dashboard")); // 仍導向，後續 API 會處理 401
    }
  }, [user, authLoading, refreshSession, router]);

  const handleGoogleAuth = async () => {
    await signIn();
    toast.success("登入成功", { duration: 1000 });
  };

  /** Email 登入：有 name 為註冊，否則為登入 */
  const handleEmailAuth = async (
    email: string,
    password: string,
    name?: string
  ) => {
    if (name !== undefined && name.trim() !== "") {
      await signUpWithEmail(email, password, name);
    } else {
      await signInWithEmail(email, password);
    }
    toast.success(name ? "註冊成功" : "登入成功", { duration: 2000 });
  };

  /** 忘記密碼：Firebase 寄出重設信；成功訊息由 AuthForm 的 setSuccess 顯示 */
  const handleForgotPassword = async (email: string) => {
    if (typeof sendPasswordReset !== "function") {
      toast.error("功能尚未載入，請重新整理頁面");
      return;
    }
    await sendPasswordReset(email);
  };

  // 只在確定已登入時才換成轉圈；auth 載入中照常顯示，SSR 才有內容（精選路線、表單）可給爬蟲與首屏
  if (user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen overflow-x-clip bg-background">
      {/* 桌機滿版背景動畫；手機改用頂部靜態圖 */}
      <DawnSceneBackground />

      {/* Left Side - 功能預告 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 hidden lg:block lg:w-1/2"
      >
        <LoginHero featured={featured} />
      </motion.div>

      {/* Right Side - 登入表單 */}
      <div className="relative flex w-full flex-col items-center justify-start p-8 lg:w-1/2 lg:justify-center">
        {/* Background gradient for mobile */}
        <div className="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-transparent lg:hidden" />

        {/* Mobile Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 mb-8 w-full max-w-md lg:hidden"
        >
          <div className="flex items-center gap-2">
            <ProductLogo size={40} />
            <span className="text-xl font-bold text-foreground">{loginCopy.brand}</span>
          </div>
          <h1 className="mt-4 text-[1.375rem] font-black leading-tight text-foreground sm:text-2xl">{loginCopy.title}</h1>
          <FeatureList variant="compact" className="mt-4" />
        </motion.div>

        {/* Auth Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          data-auth-card
          className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-card/80 p-8 shadow-2xl shadow-black/20 backdrop-blur-xl"
        >
          <AuthForm
            onGoogleAuth={handleGoogleAuth}
            onEmailAuth={handleEmailAuth}
            onForgotPassword={handleForgotPassword}
          />
          {/* 同意聲明放在登入、註冊動作旁，使用者按下前看得到 */}
          <p className="mt-6 border-t border-border pt-4 text-center text-xs text-muted-foreground">
            繼續使用即表示同意
            <Link href="/terms" className="text-primary hover:underline">
              服務條款
            </Link>
            與
            <Link href="/privacy" className="text-primary hover:underline">
              隱私政策
            </Link>
          </p>
          {/* 資料來源接在同意聲明下方（桌機、手機一致） */}
          <p className="mt-1 text-center text-xs text-muted-foreground">資料來源：氣象署、TDX</p>
        </motion.div>

        {/* 手機靜態圖：和桌機背景同一個畫面，放在頁面最下方當結尾；上緣漸層淡入頁面底色，往上疊到登入卡下方，避免中間空一大段 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/landing/dawn-mobile.webp"
          alt="山路逐段判定示意：9.6K 施工、14K 大雨、17.8K 落石"
          width={780}
          height={700}
          loading="lazy"
          className="relative -mx-8 -mb-8 -mt-2 aspect-[390/350] w-[calc(100%+4rem)] max-w-none object-cover [mask-image:linear-gradient(to_bottom,transparent,black_18%)] [-webkit-mask-image:linear-gradient(to_bottom,transparent,black_18%)] lg:hidden"
        />
      </div>
    </div>
  );
}
