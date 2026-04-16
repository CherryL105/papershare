# PaperShare 项目优化空间分析

## 一、架构与代码组织（最大问题）

### 1. [已完成] `src/server/core.js` 体量失控
- `core.js` 已从 **4246 行** 进一步收缩到 **945 行**。本轮收尾完成后，`auth/users` 与 `static/storage` 也已从 `core.js` 迁出，`core.js` 现在主要保留启动装配、环境与常量、record normalizer、multipart/http helper、少量共享纯 helper。
- [已完成] `speech-service.js` 现在直接拥有批注/讨论的新增、回复、编辑、删除、批量清空、按论文读取、按用户聚合，以及附件草稿解析、保留/新增合并、文件写入、失败回滚、删除清理。
- [已完成] `papers-service.js` 现在直接拥有文献抓取、HTML 导入、快照存储/读取、文献删除、Elsevier Full Text API 抓取、XML 转 HTML、对象图片代理。
- [已完成] `auth-service.js` 现在直接拥有当前用户解析、登录/登出 session、cookie 序列化、密码 hash/verify 与 legacy rehash、认证态用户序列化。
- [已完成] `users-service.js` 现在直接拥有改名、改密、创建成员、删除用户、管理员转让、bootstrap 用户初始化，以及用户名跨表同步、retain/purge 内容清理。
- [已完成] `assets-service.js` 现在直接拥有静态资源与私有附件读取、路径安全校验、`ETag` / `Last-Modified` / `304` 协商缓存，以及启动时静态资源预热。
- [已完成] `system-service.js` 现在直接拥有 `ensureRuntimeReady()`，统一执行目录创建、SQLite ready、bootstrap 用户校验、ownership backfill、activity backfill 与静态缓存预热。
- [已完成] `createServices()` 已从“注入高层业务函数”切换为“注入 store / fs / path / ID 生成器 / normalizer / 配置等底层能力，由 service 自己实现流程”。`assets.fetchElsevierObject()` 也改为复用 papers domain，而不是继续从 `core.js` 透传。
- [已完成] `tests/services.test.js` 已升级为真实 owner 行为测试，补上 `auth/users/assets/system` 的直接行为覆盖；`tests/server.integration.test.js` 也补上静态 `304` 与 `dist` 缺失回归；`npm test` 当前全绿。

### 2. [已完成] 前端双轨期已经收尾，legacy runtime 已移除
- [已完成] 目录页现在完整由 Preact 驱动：`CatalogLibraryView`、`CatalogProfileView`、`CatalogPasswordView`、`CatalogUserManagementView`、`CatalogMembersView` 全部接入共享 `client-store`，catalog 页不再依赖 `dangerouslySetInnerHTML` 或 legacy DOM 渲染。
- [已完成] 共享 `client-store` 已扩展为 catalog/detail 共用状态层，除了 `auth / papers / catalog / detail`，现在还统一承接 profile/members/user-management 数据与 `initializeCatalogPage`、`setCatalogView`、`changeUsername`、`changePassword`、`createUser`、`deleteUser`、`transferAdmin` 等 action。
- [已完成] `AppHeader` 的 view switcher 已改为受控组件，目录页登录、首次改密锁定、管理员入口、成员页切换都直接由 React 状态驱动。
- [已完成] detail 页早先迁入 React 的 `DetailLibraryView` 继续复用共享 store；catalog/detail 两页现已统一到同一套前端状态模型。
- [已完成] `src/client/legacy/app-runtime.js`、`catalog-runtime.js`、`detail-runtime.js`、`shared/legacy-runtime.js`、`legacy-panels.html`、两份失活 `main-content.html` 均已删除，legacy 前端桥接层不再存在。
- [已完成] 前端测试已更新为 React 视角，覆盖目录页初始化、视图切换、首次改密约束、成员详情跳转、共享 store 的 catalog action，以及 detail 页既有行为；`npm test` 当前全绿。

## 二、性能热点

### 3. [已完成] Dashboard 聚合已迁出 `core.js`，并补上轻量查询缓存
- `getUserDashboard()`、`listUsersWithStats()`、`getPublicUserProfile()` 及其配套 helper 已从 `core.js` 删除，聚合逻辑现在集中在 `src/server/services/dashboard-service.js`。
- `/api/me/dashboard`、`/api/me/annotations`、`/api/users`、`/api/users/:userId/profile` 保持原响应形状，但 ownership 归属判断已经统一到 `created_by_user_id`。
- `speech.getAnnotationsByUserId()` 不再依赖旧的 `core.js` dashboard 代理，而是直接复用 dashboard service。
- [已完成] `dashboard-service` 现在对 `getForUser()` 与 `listUsersWithStats()` 做进程内缓存；论文、批注/讨论、用户变更都会通过 `papers/speech/users service` 显式失效，避免同一状态下重复跑整套聚合查询。

### 4. [已完成] `listWithActivity` SQL 使用冗余列替代相关子查询
- 首页 papers 列表不再对 annotations/discussions 做 N 个相关子查询聚合，而是直接读取 papers 表上已维护的 `speech_count / latest_speech_at / latest_speaker_username`。
- `sqlite-store.js` 已在写路径和 backfill 路径中维护这些冗余字段，首页查询成本已经显著下降。

### 5. [已完成] JSON 列模式带来的额外克隆/反序列化
- repository 仍然会做 `JSON.parse(row.json)`，但此前 `core.js` 上层多余的 `cloneJsonValue` 已删除，不再出现“parse 一次再 stringify/parse 一次”的重复开销。
- 长期如果 papers / dashboard 热查询继续增长，可以再考虑把更多热字段提到列上，并在必要时使用 `json_extract`。

### 6. [已完成] 密码 scrypt 同步阻塞事件循环
- `hashPassword()` / `verifyPassword()` 已改为异步 `scrypt`，登录、创建用户、改密路径不再用 `scryptSync` 阻塞整个 HTTP server。

## 三、正确性 / 潜在 bug

### 7. [已完成] 路由初始化竞态
- 路由已在 `createHttpServer()` 中显式初始化，不再依赖请求时 lazy init。

### 8. [已完成] `createCountMapFromRows` 与 `getOwnedRecordCountForUser` 双映射
- 启动流程已增加 ownership backfill：在 `ensureDefaultUsers()` 之后扫描 `papers / annotations / discussions` 中 `created_by_user_id=''` 且用户名可匹配现存用户的历史记录，并回填到列值与 `json` payload。
- `/api/users` 统计和 dashboard 归属判断现在只按 `created_by_user_id` 聚合，不再维护“按 id”和“按 username”两套 count map。
- 无法匹配现存用户的 orphan 记录会保留原样并输出 warning，但不会再进入新的 userId-only 统计路径。

### 9. [已完成] `serveStaticAsset` 仍是磁盘直读
- 静态资源现在会在启动阶段递归扫描 `dist` 并预热进内存缓存，缓存项包含 `content / size / contentType / etag / lastModified / cacheControl`。
- `serveStaticAsset()` 对 `GET` / `HEAD` / 条件请求 已改为完全复用内存缓存，不再在热路径上执行运行时 `fs.stat` / `fs.readFile`；安全性上仍保留路径边界校验与 `403/404` 处理。
- 若 `dist` 缺失，启动只会输出 warning，不会影响 API 初始化；静态资源请求会稳定返回 `404`。私有附件 `/api/storage/*` 仍保持磁盘直读，不进入静态资源缓存。

## 四、其它细节

- [已完成] bootstrap 管理员密码已改为通过 `PAPERSHARE_BOOTSTRAP_ADMIN_PASSWORD` 注入，首次创建时若缺失该环境变量会直接启动失败；`users` 表和登录态也新增 `mustChangePassword`，强制 bootstrap 账号先改密再访问其它受保护 API。
- [已完成] `http-service` 已补上 `readPaperRequest()`、`readPaperHtmlImportRequest()` 与 `sendError()`；`/api/papers`、`/api/papers/import-html`、批注/讨论写接口不再重复手写 `String(...).trim()` 和 `catch -> sendJson` 模板，参数校验错误现在也稳定返回 `400`，不再落到外层 `500`。
- [已完成] `listByIds` / `papers.listByIdsWithStoredActivity()` 已改为按 900 条分块查询，避免触发 SQLite 999 参数限制。
- [已完成] React 入口已不再存在双轨：catalog 与 detail 页面都由 Preact 直接挂载，旧的 legacy runtime / raw HTML bridge 已全部移除。

## 优先级建议（按 ROI）

1. **如果未来出现多进程部署，再把 dashboard 进程内缓存与静态资源版本感知升级为跨进程可感知的方案**。
2. **如果 `dist` 体量明显增长，再把当前“全量预热”静态缓存升级为按大小受限的 LRU/分层策略**。
3. **如果还想继续压缩 `core.js`，可以再把 multipart/http parsing helper 下沉成更细的 utility 或 service，但这已经不是当前瓶颈**。
