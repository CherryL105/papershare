# PaperShare 项目优化空间分析

## 一、架构与代码组织（最大问题）

### 1. [部分完成] `src/server/core.js` 体量失控
- `core.js` 目前仍有 **4621 行**，Elsevier XML 解析、HTML 抓取/正则解析、附件管理、用户/会话/权限、dashboard 聚合等大量业务实现仍然集中在单文件里，这个问题还没有彻底解决。
- [已完成] 已新增 `src/server/services/` 服务组合层，按 `http / assets / system / auth / users / papers / speech / dashboard` 8 个命名空间拆出服务工厂；`router.js` 和 `routes/api.js` 已改为消费分组服务，而不是直接依赖扁平的 `core.*`。
- [已完成] `createRouteServices()` 已被 `createAppServices()` / `createServices()` 取代，`core.js` 至少退回到了“兼容门面 + 服务装配入口”的角色，路由层不再直接拿 `fs`、`path`、`STORAGE_DIR`、`PAPERS_FILE` 之类底层依赖。
- [已完成] 已补 `tests/services.test.js`，覆盖服务容器装配、`papers.readSnapshotContent()`、`system.getCollectionStats()`、`assets.fetchElsevierObject()` 等高层接口，给后续继续迁出 `core.js` 内部实现提供护栏。
- 下一步仍建议继续把 `papers/import`、`speech`、`dashboard/users`、附件处理等具体实现从 `core.js` 迁出，最终把该文件收缩为真正的薄门面。

### 2. `src/client/legacy/app-runtime.js` 7072 行单文件
- 299 个 function，跟 React 入口（`CatalogPage.jsx`、`DetailPage.jsx`，每个 16 行）并存。看起来正在做 legacy → React 迁移，但 legacy runtime 仍然承担全部 UI 逻辑，新 React 代码几乎是空壳。
- 建议确认迁移路线图：要么推进拆分到 `catalog/`、`detail/`、`shared/`，要么如果迁移卡住至少把 legacy runtime 按 feature 切片（auth、annotations、discussions、import、admin），打包体积也能从中受益。

## 二、性能热点

### 3. `getUserDashboard()` (core.js L2163-L2292) — 6 次串行 SQL + 大量 JSON.parse
- 6 个 prepare/all 全部同步串行，每条都 `SELECT json` 全字段拉回再 `JSON.parse`（`queryJsonRows` L2310-L2315）。
- `papersById/annotationsById/discussionsById` 的构建和 dedupe 在 JS 端做，本可用 SQL `IN` 一次拉齐。
- 对每条 reply 还要 JOIN parent 来反查所有权——可以考虑一次 CTE，或在 annotations/discussions 表加一列 `parent_owner_user_id` 冗余。
- 若 dashboard 是热点 API，建议加结果缓存（按 userId + max(updated_at) 失效）。

### 4. [已完成] `listWithActivity` SQL (sqlite-store.js L356-L416) 是 N 个相关子查询
- 每行 papers 都触发 4 个独立的 `SELECT … UNION ALL` 子查询（speech_count、latest_speech_at、latest_speaker_username、ORDER BY 又一次）。在 papers 多时是 O(P · A+D)。
- 优化方案：用 CTE 一次性聚合：
  ```sql
  WITH speech AS (
    SELECT paper_id, created_at, created_by_username FROM annotations
    UNION ALL
    SELECT paper_id, created_at, created_by_username FROM discussions
  ),
  agg AS (
    SELECT paper_id, COUNT(*) AS c, MAX(created_at) AS latest_at
    FROM speech GROUP BY paper_id
  )
  SELECT p.json, agg.c, agg.latest_at, ... FROM papers p LEFT JOIN agg ON ...
  ```
- 或者直接用列表里已经存在的 `latest_speech_at / latest_speaker_username / speech_count` 冗余字段——repository 里 update 语句（L335-L350）已经会写它们，那 `listWithActivity` 完全可以直接读列，不再聚合。**这是最大收益项。**

### 5. [已完成] JSON 列模式带来的全表反序列化
- 所有 repository 的 `listAll()` 都 `JSON.parse(row.json)`，N 行 → N 次 parse，热路径上代价高。
- core.js 里 `readAnnotations` (L2813) / `readDiscussions` (L2819) / `readPapers` (L3143) 又对结果 `cloneJsonValue` 一次（`JSON.parse(JSON.stringify(...))`），相当于每条记录解析两遍 + 序列化一遍。
- `cloneJsonValue` 是为了防御 normalize 函数修改入参，但 parse 出来的对象本来就是私有副本——这层 clone 完全可以删除。
- 长期可考虑只把热查询字段提到列上，用 `json_extract` 替代 `SELECT json` 全量回填。

### 6. [已完成] 密码 scrypt 同步阻塞事件循环
- `hashPassword` (L4076) / `verifyPassword` (L4082) 用的是 `crypto.scryptSync`，在登录/创建用户路径上会阻塞整个 HTTP server。改为 `promisify(crypto.scrypt)` 即可异步。

## 三、正确性 / 潜在 bug

### 7. [已完成] 路由初始化竞态
- `routeRequest()` (L161-L167) 用 `if (!appRouter) appRouter = createRouter(...)` 实现 lazy init。`createRouter` 是同步的，所以单事件循环 tick 下没有真竞态，但建议在 `start()` 里就构建好，避免误改成 async 后出问题。

### 8. `createCountMapFromRows` (L2294) 与 `getOwnedRecordCountForUser` (L4507) 双映射
- 必须维护"按 id"和"按 username"两套 count map 来兼容 `created_by_user_id == ''` 的历史数据。如果可以做一次性数据修复（迁移把空 user_id 解析成对应 user_id），就能消掉一半 SQL 和 JS 路径。

### 9. `serveStaticAsset` (L2863-L2921)
- `path.normalize(...).replace(/^(\.\.[/\\])+/, "")` 之后还有 `startsWith(CLIENT_DIST_DIR)` 校验，OK；但每次请求都做 `fs.stat` + `fs.readFile`（小文件直接整块读到内存），没有内存缓存。dist 静态资源可以用启动时一次性扫描 + 弱缓存，或者交给反向代理。

## 四、其它细节

- `core.js` L31-L32 缩进用了 tab 而非两空格，与文件其它部分不一致。
- `DEFAULT_USERS` (L111-L119) 把明文 `"1234"` 写死成默认管理员密码，初始化时就 hash 写库——如果是生产部署里的 bootstrap，建议通过环境变量传入并在首次登录强制改密。
- `readRequestBody` (L2937) 之类的工具方法重复了很多 `String(...).trim()` 模式，可抽取。
- `listByIds` 动态拼 placeholders (L2317-L2324) 没有上限保护，超大 id 数组会触发 SQLite 999 参数限制——加分块。
- React 入口（`CatalogPage` / `DetailPage`）目前只是 `dangerouslySetInnerHTML` 渲染原生 HTML 字符串（`raw-markup.jsx` 仅 3 行）。如果迁移没有路线图，可以反过来：放弃 React 壳，直接保留 vanilla + Vite 构建，省掉双轨。

## 优先级建议（按 ROI）

1. [已完成] **直接读 papers 表上已存在的 `latest_speech_at` / `speech_count` 冗余列**，移除 `listWithActivity` 的子查询 —— 一次性大幅降低首页查询成本。
2. [已完成] **删除 `cloneJsonValue` 多余克隆**，scrypt 改异步。
3. [部分完成] **继续拆分 `core.js`** —— 服务容器和路由解耦已落地，下一步应继续把 import / speech / dashboard / attachments 的具体实现迁出。
4. **dashboard 查询合并 + 缓存**。
5. 决定 legacy runtime / React 迁移走向。
