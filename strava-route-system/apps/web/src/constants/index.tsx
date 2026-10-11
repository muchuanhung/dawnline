import { Bike, Footprints, Mountain, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Route } from "@/lib/routes/route-data";

/** Route 類型的 icon 對應 */
export const ROUTE_TYPE_ICONS: Record<Route["type"], LucideIcon> = {
  自行車: Bike,
  跑步: Footprints,
  健行: Mountain,
  雪巴運動: Trophy,
  混合: Mountain,
};
