/**
 * 管理員新增／下架公開路線後，清掉 load-routes.server.ts 的公開路線快取（tag gpx-routes），清單馬上更新。
 * 用呼叫者自己的 cookie 問後端 /api/v1/me，isAdmin 才清；其他人一律 403。
 */

import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const base = process.env.BACKEND_API_URL?.replace(/\/+$/, "");
  const cookie = req.headers.get("cookie") ?? "";
  if (!base || !cookie) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const res = await fetch(`${base}/api/v1/me`, { headers: { cookie }, cache: "no-store" }).catch(() => null);
  const me = res?.ok ? ((await res.json().catch(() => null)) as { isAdmin?: boolean } | null) : null;
  if (me?.isAdmin !== true) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // expire: 0 = drop now; the next /api/routes/gpx reads the backend again
  revalidateTag("gpx-routes", { expire: 0 });
  return NextResponse.json({ ok: true });
}
