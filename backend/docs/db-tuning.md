# 資料庫索引調校（T7）

## 結論

- API 目前會送出的 9 條主要查詢，**全部用上預期的索引**，T7 不需要新增或刪除索引，也沒有新的 migration。
- 效果最大的是「我的路線」與上傳配額計數：沒有 `idx_routes_user_list` 時要掃 2.8 萬列，有索引只讀 10 列，時間從約 88 ms 降到 0.55 ms。
- 公開路線清單少了 `idx_routes_public_list` 會變成全表掃描加 filesort（5.7 萬列），有索引只讀 190 列，排序也直接由索引完成。
- 收藏相關的兩個索引效益比較小：每人最多 50 筆收藏，PK `(user_id, route_id)` 本身就能縮小範圍。`idx_favorites_user_created` 省掉的是排序（filesort）並讓查詢只讀索引；`idx_favorites_route` 則是刪路線清收藏、FK 串聯刪除必備的，沒有它會全表掃描 7.6 萬列。

## 怎麼量的

腳本：`backend/app/scripts/explain_queries.py`，由 Backend CI 的 MySQL 8.4 job 自動執行（步驟「索引 EXPLAIN 報告（T7）」）。報告貼在每次 run 的 Summary，也存成 `explain-report` artifact。

1. **灌假資料**：線上只有 4 條公開路線，資料太少時優化器多半直接全表掃描，看不出索引效果，所以在空的 MySQL 灌入：
   - users 5,000 筆
   - routes 60,188 筆：每人 12 條私人路線（其中 2 條已軟刪除），加上 200 條公開路線（其中 5% 已下架）
   - favorites 89,982 筆：每人收藏 15 條公開路線，另外加上約 1/4 自己的私人路線
   - 灌完跑 `ANALYZE TABLE`，讓優化器拿到正確的索引統計
2. **SQL 不是手寫的**：每個情境都呼叫 service 層的真實函式，用 SQLAlchemy 的 `before_cursor_execute` 攔下實際送出的語句與參數，再拿去 `EXPLAIN`。之後 service 改了查詢，報告也會跟著變。
3. **「之前」怎麼產生**：用 MySQL 8 的 optimizer hint `/*+ NO_INDEX(table index) */` 讓優化器假裝沒有這個索引，不必真的 `DROP INDEX`。`idx_routes_user_list`、`idx_favorites_route` 是 FK 需要的索引，MySQL 不准直接刪。
4. **時間**：每條 SELECT 重複執行 30 次，取中位數。DELETE 只看執行計畫，不重複執行。
5. **防退化**：任何一條查詢在「之後」沒用上預期索引，腳本會以 exit 1 結束，CI 轉紅。
6. **安全**：`users` 表不是空的就拒絕執行，避免誤灌到正式機。

## 結果（MySQL 8.4.13，CI run 41216701753）

| 查詢 | 來源 | 索引 | 之前 type／rows | 之後 type／rows | 之前 ms | 之後 ms |
|---|---|---|---|---|---|---|
| 公開路線清單（探索頁、訪客 dashboard） | `public_route_service.list_public_routes` | `idx_routes_public_list` | ALL／56,856 | ref／190 | 39.55 | 3.43 |
| 公開路線詳情／下載（以 slug 查） | `public_route_service.get_public_route` | `uq_routes_slug` | ref／190 | const／1 | 0.67 | 0.30 |
| 我的路線清單（新上傳在前） | `route_service.list_routes` | `idx_routes_user_list` | ref／28,428 | ref／10 | 87.91 | 0.55 |
| 上傳配額計數 | `route_service.count_routes` | `idx_routes_user_list` | ref／28,428 | ref／10 | 74.51 | 0.25 |
| 我的收藏（新收藏在前） | `favorite_service.list_favorites` | `idx_favorites_user_created` | ref／18 | ref／18 | 0.90 | 0.90 |
| 加入收藏：以 slug 找公開路線 | `favorite_service._find_route` | `uq_routes_slug` | ALL／56,856 | const／1 | 34.72 | 0.35 |
| 加入收藏：以 public_id 找私人路線 | `favorite_service._find_route` | `uq_routes_public_id` | ALL／56,856 | index_merge／2 | 44.02 | 0.41 |
| 加入收藏：收藏數上限檢查 | `favorite_service.add_favorite` | `idx_favorites_user_created` | ref／18 | ref／18 | 0.18 | 0.18 |
| 刪除私人路線時清掉它的收藏 | `route_service.delete_route` | `idx_favorites_route` | ALL／76,037 | range／1 | — | — |

`rows` 是優化器估計要讀的列數。

## 逐條說明

### 公開路線清單

```sql
SELECT routes.* FROM routes
WHERE routes.visibility = 'public' AND routes.status = 'ready' AND routes.deleted_at IS NULL
ORDER BY routes.name
```

| | type | key | rows | filtered | Extra |
|---|---|---|---|---|---|
| 之前 | ALL | — | 56,856 | 3.33 | Using where; Using filesort |
| 之後 | ref | idx_routes_public_list | 190 | 33.33 | Using index condition; Using where |

`(visibility, deleted_at, name)` 前兩欄是等值條件，第三欄剛好是排序欄，所以排序直接沿著索引完成，不需要 filesort。`status` 不在索引裡，由 index condition pushdown 過濾（filtered 33%）。公開路線只有幾百條，不值得為 `status` 再加一欄。

### 公開路線詳情（slug）

| | type | key | rows | Extra |
|---|---|---|---|---|
| 之前 | ref | idx_routes_public_list | 190 | Using index condition; Using where |
| 之後 | const | uq_routes_slug | 1 | |

沒有 `uq_routes_slug` 時，優化器退而使用公開清單索引，逐一比對 190 條公開路線；有了唯一索引就是 const，只讀 1 列。

### 我的路線清單、上傳配額計數

```sql
SELECT routes.* FROM routes
WHERE routes.user_id = ? AND routes.visibility = 'private' AND routes.deleted_at IS NULL
ORDER BY routes.created_at DESC
```

| | type | key | rows | filtered | Extra |
|---|---|---|---|---|---|
| 之前 | ref | idx_routes_public_list | 28,428 | 0.02 | Using index condition; Using where; Using filesort |
| 之後 | ref | idx_routes_user_list | 10 | 100 | Using where; Backward index scan |

沒有 `(user_id, deleted_at, created_at)` 時，優化器只能用 `visibility = 'private'` 縮小範圍，但私人路線佔了將近一半，等於要讀 2.8 萬列再排序。有索引時只讀這位使用者的 10 列，並反向掃描索引完成 `created_at DESC`，不用另外排序。配額計數（`count_routes` 的子查詢）會被 MySQL 合併成同一個計畫，結果相同。

### 我的收藏

```sql
SELECT favorites.*, routes_1.*
FROM favorites
  JOIN routes ON favorites.route_id = routes.id
  LEFT JOIN routes AS routes_1 ON routes_1.id = favorites.route_id
WHERE favorites.user_id = ? AND routes.deleted_at IS NULL AND routes.status = 'ready'
  AND (routes.visibility = 'public' OR routes.visibility = 'private' AND routes.user_id = ?)
ORDER BY favorites.created_at DESC
```

| | table | type | key | rows | Extra |
|---|---|---|---|---|---|
| 之前 | favorites | ref | PRIMARY | 18 | Using filesort |
| 之後 | favorites | ref | idx_favorites_user_created | 18 | Backward index scan; Using index |
| 兩者 | routes, routes_1 | eq_ref | PRIMARY | 1 | |

讀的列數一樣（PK 的 `user_id` 前綴本來就能縮小範圍）。差別在於有索引時不用 filesort，而且 favorites 這一側只讀索引、不回表。由於每人最多 50 筆，時間差距在誤差範圍內。

### 加入收藏：找路線

- 以 slug 找公開路線：沒有 `uq_routes_slug` 時要全表掃描（5.7 萬列），有了是 const。這裡的條件含 `OR`（公開路線，或自己的私人路線），優化器無法改用其他索引，所以退回全表掃描。
- 以 ULID 找私人路線：條件變成 `slug = ? OR public_id = ?`，MySQL 用 index_merge 把 `uq_routes_slug` 與 `uq_routes_public_id` 兩個唯一索引的結果合併（`Using union(...)`），只讀 2 列。

### 加入收藏：收藏數上限檢查

`SELECT count(*) FROM favorites WHERE user_id = ?`：有沒有 `idx_favorites_user_created` 都是 ref／18、只讀索引。拿掉它時會改走 PK，效能相同。

### 刪除路線時清收藏

`DELETE FROM favorites WHERE route_id = ?`：沒有 `idx_favorites_route` 時要全表掃描 7.6 萬列，而且 InnoDB 會鎖住掃過的列。有索引時只碰到那 1 列。下架公開路線（`unpublish_missing`）用的是同一條語句。

## 其他觀察（這次沒改）

1. **`list_favorites` 多 JOIN 一次 routes**：`Favorite.route` 設定了 `lazy="joined"`，SQLAlchemy 會為了載入關聯再補一個 `LEFT JOIN routes AS routes_1`，跟過濾用的 `JOIN routes` 重複。因為是主鍵 eq_ref，成本很低。要省掉的話，可以在 query 裡改用 `contains_eager(Favorite.route)`。
2. **目前沒有查詢用到的索引**：
   - `idx_sessions_expires`：還沒有清理過期 session 的排程，所以沒有查詢以 `expires_at` 為條件。之後加清理工作時就會用上，先保留。
   - `sp_routes_bbox`：空間索引是為之後的範圍查詢（例如「附近的路線」）預留的，目前沒有 API 使用。
3. **`idx_favorites_user_created` 效益小**：只省排序與回表。收藏數有上限，就算拿掉也不會變慢多少。保留的寫入成本也很小，所以維持現狀。

## 重跑

- CI：每次改到 `backend/**` 的 PR 都會自動跑，報告在該次 run 的 Summary。
- 本機：`cd backend && docker compose up -d --wait && docker compose exec api python -m app.scripts.explain_queries`。需要空的資料庫，要重跑時先 `docker compose down -v`。
