"""T7 EXPLAIN 腳本的純函式部分；實際 EXPLAIN 在 CI 的 MySQL 容器跑。"""

from app.scripts.explain_queries import without_index


def test_without_index_adds_hint_after_select():
    sql = "SELECT routes.id \nFROM routes WHERE routes.slug = %(slug_1)s"
    assert without_index(sql, "routes", "uq_routes_slug") == (
        "SELECT /*+ NO_INDEX(routes uq_routes_slug) */ routes.id \n"
        "FROM routes WHERE routes.slug = %(slug_1)s"
    )


def test_without_index_covers_subquery_and_delete():
    sub = "SELECT count(*) FROM (SELECT routes.id FROM routes) AS anon_1"
    assert without_index(sub, "routes", "idx").count("NO_INDEX(routes idx)") == 2
    delete = "DELETE FROM favorites WHERE favorites.route_id = %(route_id_1)s"
    assert without_index(delete, "favorites", "idx_favorites_route").startswith(
        "DELETE /*+ NO_INDEX(favorites idx_favorites_route) */ FROM favorites"
    )
