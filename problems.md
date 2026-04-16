# PaperShare 项目优化空间分析

## 一、架构与代码组织（最大问题）

### 1. [部分完成] `src/server/core.js` 体量失控
- `core.js` 已从 **4246 行** 收缩到 **1918 行**。本轮已经完成两阶段拆分：`speech + attachments` 迁入 `src/server/services/speech-service.js`（764 行），`papers/import + Elsevier` 迁入 `src/server/services/papers-service.js`（1727 行）。
- [已完成] `speech-service.js` 现在直接拥有批注/讨论的新增、回复、编辑、删除、批量清空、按论文读取、按用户聚合，以及附件草稿解析、保留/新增合并、文件写入、失败回滚、删除清理。
- [已完成] `papers-service.js` 现在直接拥有文献抓取、HTML 导入、快照存储/读取、文献删除、Elsevier Full Text API 抓取、XML 转 HTML、对象图片代理。
- [已完成] `createServices()` 已从“注入高层业务函数”切换为“注入 store / fs / path / ID 生成器 / normalizer / 配置等底层能力，由 service 自己实现流程”。`assets.fetchElsevierObject()` 也改为复用 papers domain，而不是继续从 `core.js` 透传。
- [已完成] `tests/services.test.js` 已从透传型测试升级为真实 service 行为测试，覆盖 snapshot 读取、真实 `fetch()` 抓取、discussion 写入、Elsevier 资源代理等关键路径；`npm test` 当前全绿。
- 剩余在 `core.js` 的主要职责已经收敛为：启动与环境装配、auth/users、静态资源与私有存储服务、record normalizer、少量共享 helper。后续如果还要继续瘦身，优先考虑再拆 `auth/users` 或 `static/storage`，但它们已经不是当前最大的结构瓶颈。

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

### 9. [部分完成] `serveStaticAsset` 仍是磁盘直读
- [已完成] 静态资源已经补上 `Cache-Control`、`ETag`、`Last-Modified` 和 `304` 协商缓存，安全性上也保留了 `CLIENT_DIST_DIR` 边界校验。
- 仍未完成的是内存级缓存：当前每次请求还是 `fs.stat`，`GET` 还会继续 `fs.readFile`。如果部署场景以单机 Node 直出为主，可以考虑启动时索引 + 热文件弱缓存；如果前面有 Nginx/Caddy/CDN，这项优先级可以后移。

## 四、其它细节

- [已完成] bootstrap 管理员密码已改为通过 `PAPERSHARE_BOOTSTRAP_ADMIN_PASSWORD` 注入，首次创建时若缺失该环境变量会直接启动失败；`users` 表和登录态也新增 `mustChangePassword`，强制 bootstrap 账号先改密再访问其它受保护 API。
- [已完成] `http-service` 已补上 `readPaperRequest()`、`readPaperHtmlImportRequest()` 与 `sendError()`；`/api/papers`、`/api/papers/import-html`、批注/讨论写接口不再重复手写 `String(...).trim()` 和 `catch -> sendJson` 模板，参数校验错误现在也稳定返回 `400`，不再落到外层 `500`。
- [已完成] `listByIds` / `papers.listByIdsWithStoredActivity()` 已改为按 900 条分块查询，避免触发 SQLite 999 参数限制。
- [已完成] React 入口已不再存在双轨：catalog 与 detail 页面都由 Preact 直接挂载，旧的 legacy runtime / raw HTML bridge 已全部移除。

## 优先级建议（按 ROI）

1. **静态资源内存缓存**。
2. **如果还想继续压缩服务端复杂度，再拆 `auth/users` 或 `static/storage`**，但这已经是“锦上添花”而不是当前主瓶颈。
3. **如果未来出现多进程部署，再把 dashboard 进程内缓存升级为跨进程可感知的版本键/共享缓存**。
