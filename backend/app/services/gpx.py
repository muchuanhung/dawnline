"""伺服器端 GPX 解析：只取 trkpt／rtept 的經緯度與海拔，算距離、爬升與 bbox。

規則對齊前端 lib/routes/parse-gpx.ts（haversine 距離、正向海拔差加總、第一個 <name>）。
用 defusedxml 解析，擋掉 XXE 與實體展開攻擊。
"""

import math
from dataclasses import dataclass
from xml.etree.ElementTree import Element

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException

EARTH_RADIUS_KM = 6371.0


class InvalidGpxError(Exception):
    pass


@dataclass(frozen=True)
class GpxSummary:
    name: str | None
    point_count: int
    distance_km: float
    elevation_gain_m: int
    # (min_lon, min_lat, max_lon, max_lat)
    bbox: tuple[float, float, float, float]

    def bbox_wkt(self) -> str:
        """bbox 轉成 POLYGON WKT（lon lat 軸序，逆時針閉合）。"""
        w, s, e, n = self.bbox
        return f"POLYGON(({w} {s},{e} {s},{e} {n},{w} {n},{w} {s}))"


def _local(tag: str) -> str:
    # GPX 1.0／1.1 namespace 不同，只比對 local name
    return tag.rsplit("}", 1)[-1]


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    )
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _parse_point(el: Element) -> tuple[float, float, float | None]:
    try:
        lat = float(el.attrib["lat"])
        lon = float(el.attrib["lon"])
    except (KeyError, ValueError) as e:
        raise InvalidGpxError("點位缺少有效的 lat／lon") from e
    if not (math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
        raise InvalidGpxError("點位經緯度超出範圍")
    ele = None
    for child in el:
        if _local(child.tag) == "ele" and child.text:
            try:
                value = float(child.text.strip())
            except ValueError:
                value = math.nan
            ele = value if math.isfinite(value) else None
            break
    return lat, lon, ele


def parse_gpx(data: bytes) -> GpxSummary:
    try:
        root = ElementTree.fromstring(data)
    except (ElementTree.ParseError, DefusedXmlException) as e:
        raise InvalidGpxError("不是有效的 XML") from e
    if _local(root.tag) != "gpx":
        raise InvalidGpxError("根元素不是 <gpx>")

    name: str | None = None
    points: list[tuple[float, float, float | None]] = []
    for el in root.iter():
        tag = _local(el.tag)
        if tag in ("trkpt", "rtept"):
            points.append(_parse_point(el))
        elif tag == "name" and name is None and el.text and el.text.strip():
            name = el.text.strip()

    if len(points) < 2:
        raise InvalidGpxError("GPX 中無有效 route/track 點位")

    distance = 0.0
    gain = 0.0
    for (lat1, lon1, ele1), (lat2, lon2, ele2) in zip(points, points[1:], strict=False):
        distance += haversine_km(lat1, lon1, lat2, lon2)
        # 只在相鄰兩點都有海拔時累計，缺值不當成 0
        if ele1 is not None and ele2 is not None and ele2 > ele1:
            gain += ele2 - ele1

    lats = [p[0] for p in points]
    lons = [p[1] for p in points]
    return GpxSummary(
        name=name,
        point_count=len(points),
        distance_km=round(distance, 2),
        elevation_gain_m=round(gain),
        bbox=(min(lons), min(lats), max(lons), max(lats)),
    )
