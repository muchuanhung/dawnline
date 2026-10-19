"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { User } from "firebase/auth";
import {
  getAuthClient,
  googleProvider,
} from "@/lib/firebase/client";
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { PRIVATE_SNAPSHOT_CACHE } from "@/lib/routes/snapshot";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
  signIn: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string, displayName?: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** 回到登入頁後等這麼久還沒有結果，就當作使用者關掉了 Google 登入分頁 */
const POPUP_RETURN_GRACE_MS = 3000;

/**
 * iOS Safari 把登入 popup 開成新分頁；使用者按 X 關掉後，Firebase 偵測不到視窗已關（或計時器在背景被暫停），
 * signInWithPopup 永遠不會 settle，按鈕就一直轉圈。
 * 這裡在登入頁從背景回到前景（visibilitychange → visible）後等一小段時間，仍沒結果就以「登入已取消」結束。
 * 只看 visibilitychange：桌機 popup 是獨立視窗，原頁面一直可見，不會被誤判取消。
 * 若其實已登入成功、結果晚到，onAuthStateChanged 仍會設好 user，登入頁照常導向。
 */
function whenReturnedWithoutResult(): { promise: Promise<never>; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let onVisible: () => void = () => {};
  const promise = new Promise<never>((_, reject) => {
    onVisible = () => {
      if (document.visibilityState !== "visible" || timer != null) return;
      timer = setTimeout(() => reject(new Error("登入已取消")), POPUP_RETURN_GRACE_MS);
    };
    document.addEventListener("visibilitychange", onVisible);
  });
  const dispose = () => {
    document.removeEventListener("visibilitychange", onVisible);
    if (timer != null) clearTimeout(timer);
  };
  return { promise, dispose };
}

/**
 * 同一個 ID token 也換一份 FastAPI 後端的 session（rc_session，經 /api/v1 rewrite 成為同站 cookie）。
 * 只有私人路線用得到；後端未設定或暫時連不上時不擋登入，私人路線頁遇到 401 會再換一次。
 */
async function exchangeBackendSession(idToken: string): Promise<void> {
  try {
    const res = await fetch("/api/v1/auth/session", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) console.warn("後端 session 設定失敗", res.status);
  } catch (err) {
    console.warn("後端 session 設定失敗", err);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const authRef = useRef<ReturnType<typeof getAuthClient> | null>(null);

  const setSessionFromUser = useCallback(async (user: User) => {
    const idToken = await user.getIdToken();
    const [res] = await Promise.all([
      fetch("/api/auth/session", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: idToken }),
      }),
      exchangeBackendSession(idToken),
    ]);
    if (!res.ok) throw new Error("Session 設定失敗");
  }, []);

  useEffect(() => {
    authRef.current = getAuthClient();
    let cancelled = false;
    const unsub = onAuthStateChanged(authRef.current, async (u) => {
      setUser(u ?? null);
      if (u) {
        try {
          await setSessionFromUser(u);
        } catch {
          // 仍顯示使用者，後續 API 若 401 再處理
        }
      }
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [setSessionFromUser]);

  const signIn = useCallback(async () => {
    const auth = authRef.current ?? getAuthClient();
    const returned = whenReturnedWithoutResult();
    try {
      const result = await Promise.race([signInWithPopup(auth, googleProvider), returned.promise]);
      returned.dispose();
      await setSessionFromUser(result.user);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") {
        throw new Error("登入已取消");
      }
      throw err;
    } finally {
      returned.dispose();
    }
  }, [setSessionFromUser]);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      const auth = authRef.current ?? getAuthClient();
      const result = await signInWithEmailAndPassword(auth, email, password);
      await setSessionFromUser(result.user);
    },
    [setSessionFromUser]
  );

  const signUpWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const auth = authRef.current ?? getAuthClient();
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName?.trim()) {
        await updateProfile(result.user, { displayName: displayName.trim() });
      }
      await setSessionFromUser(result.user);
    },
    [setSessionFromUser]
  );

  const sendPasswordReset = useCallback(async (email: string) => {
    const auth = authRef.current ?? getAuthClient();
    await sendPasswordResetEmail(auth, email);
  }, []);

  const signOut = useCallback(async () => {
    const auth = authRef.current ?? getAuthClient();
    await firebaseSignOut(auth);
    await Promise.all([
      fetch("/api/auth/signout", { method: "POST" }),
      // 後端 session 一併登出；後端未設定時失敗不影響
      fetch("/api/v1/auth/session", { method: "DELETE", credentials: "include" }).catch(() => undefined),
      // 私人路線的離線快照一併刪除，同一台裝置換人登入不會讀到上一位的路線
      typeof caches !== "undefined" ? caches.delete(PRIVATE_SNAPSHOT_CACHE).catch(() => false) : undefined,
    ]);
  }, []);

  const refreshSession = useCallback(async () => {
    const auth = authRef.current ?? getAuthClient();
    const u = auth.currentUser;
    if (u) await setSessionFromUser(u);
  }, [setSessionFromUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      refreshSession,
      signIn,
      signInWithEmail,
      signUpWithEmail,
      sendPasswordReset,
      signOut,
    }),
    [user, loading, refreshSession, signIn, signInWithEmail, signUpWithEmail, sendPasswordReset, signOut]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必須在 AuthProvider 內使用");
  return ctx;
}
