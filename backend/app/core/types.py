"""MySQL 專用欄位型別；在 SQLite（測試）退回通用型別。"""

from sqlalchemy import BigInteger, DateTime, Integer, func
from sqlalchemy.dialects import mysql
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.types import UserDefinedType

# BIGINT UNSIGNED；SQLite 的自增主鍵必須是 INTEGER
UBigInt = (
    BigInteger()
    .with_variant(mysql.BIGINT(unsigned=True), "mysql")
    .with_variant(Integer(), "sqlite")
)
UInt = Integer().with_variant(mysql.INTEGER(unsigned=True), "mysql")
USmallInt = Integer().with_variant(mysql.SMALLINT(unsigned=True), "mysql")
DateTime3 = DateTime().with_variant(mysql.DATETIME(fsp=3), "mysql")


class Geometry(UserDefinedType):
    """MySQL 空間欄位（POLYGON / POINT），固定 SRID 4326。"""

    cache_ok = True

    def __init__(self, kind: str, srid: int = 4326) -> None:
        self.kind = kind
        self.srid = srid

    def get_col_spec(self, **kw) -> str:
        return f"{self.kind} SRID {self.srid}"


@compiles(Geometry, "sqlite")
def _geometry_sqlite(_type, _compiler, **_kw) -> str:
    # 測試用 SQLite 沒有空間型別，以 WKT 文字存放
    return "TEXT"


def geometry_from_wkt(db: Session, wkt: str, srid: int = 4326):
    """寫入空間欄位用的值：MySQL 轉成 ST_GeomFromText，SQLite（測試）直接存 WKT。"""
    if db.get_bind().dialect.name == "mysql":
        # SRID 4326 在 MySQL 預設是 lat-lon 軸序；WKT 用 lon lat，所以要指定 axis-order
        return func.ST_GeomFromText(wkt, srid, "axis-order=long-lat")
    return wkt
