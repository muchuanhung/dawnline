// Server 端：從 Request 取得並驗證身分，回傳 uid
// cookie 存的是 Firebase session cookie（5 天有效）；Authorization header 仍是 idToken（1 小時）

import { getAuthAdmin } from "@/lib/firebase/admin";

const SESSION_COOKIE_NAME = "firebase-id-token";

/** Read the session cookie value from a raw Cookie header. */
function readSessionCookie(cookieHeader: string): string | null {
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1].trim()) : null;
}

/**
 * Verify a session cookie and return its uid.
 * Old cookies that still hold a raw idToken fail here and count as signed out;
 * the client then re-issues a session cookie via /api/auth/session.
 */
async function uidFromSessionCookie(sessionCookie: string): Promise<string | null> {
  try {
    const decoded = await getAuthAdmin().verifySessionCookie(sessionCookie);
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * 從 Request 的 cookie 或 Authorization header 取得 uid。
 * 用於 API Routes 與 Server Components（透過 headers()）。
 */
export async function getAuthFromRequest(request: Request): Promise<{
  uid: string;
} | null> {
  const sessionCookie = readSessionCookie(request.headers.get("cookie") ?? "");
  if (sessionCookie) {
    const uid = await uidFromSessionCookie(sessionCookie);
    if (uid) return { uid };
  }

  // Bearer header carries a Firebase idToken (not a session cookie)
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const decoded = await getAuthAdmin().verifyIdToken(authHeader.slice(7).trim());
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

/**
 * 供 Server Component 使用：從 Next.js headers() 取得當前使用者 uid。
 */
export async function getCurrentUserId(): Promise<string | null> {
  const { headers } = await import("next/headers");
  const h = await headers();
  const sessionCookie = readSessionCookie(h.get("cookie") ?? "");
  if (!sessionCookie) return null;
  return uidFromSessionCookie(sessionCookie);
}

export { SESSION_COOKIE_NAME };
