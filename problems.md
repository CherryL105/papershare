# PaperShare 项目优化空间分析

## 已完成优化（摘要）

1. **`core.js` 拆分**：从 4246 行收缩到 286 行纯 bootstrap 层；业务逻辑迁出到 8 个 service，请求读写拆到 `http/`，纯函数按领域拆到 `utils/`。
2. **前端 legacy runtime 移除**：catalog/detail 页面统一由 Preact 驱动，legacy 桥接层全部删除。
3. **Dashboard 缓存**：聚合逻辑集中到 `dashboard-service.js`，进程内缓存 + 写操作显式失效。
4. **首页查询优化**：`listWithActivity` 读取冗余列，不再做 N 个相关子查询。
5. **JSON 克隆 / scrypt 异步 / 路由竞态 / ownership backfill / 静态资源缓存 / bootstrap 安全 / HTTP 解析统一 / SQLite 参数限制**：均已完成。
6. **代码卫生**：`sanitizeAttachmentName` 去重、speech-service 注入参数去冗余、`requirePaper()` 路由收敛。
7. **前端性能**：catalog 初始化与 `changeUsername` 并行刷新、`selectPaper` content 请求并发化。
8. **前端架构**：`client-store.js` 拆分为状态容器（518 行）+ `session-store.js` + `catalog-store.js` + `detail-store.js`；speech helper 脱离 detail 命名空间移至 `speech-helpers.js`。
9. **测试**：paper-scoped 404 集成测试基线修复；新增 `server-utils.test.js`；当前 `npm test` 64/64 通过。

---

## 待优化项

### 一、服务端

#### 1. `papers-service.js` 体量偏大（1702 行）
- Elsevier XML→HTML 转换器（`convertElsevierXmlToHtml` 及其 20+ 个渲染/解析辅助函数）独占约 **1000 行**，与论文 CRUD 业务逻辑混在同一文件中。
- HTML metadata 提取（`extractMetadataFromHtml`、`extractAbstractFromHtml`、`findTagAttributes` 等）又占约 **350 行**。
- **建议**：将 Elsevier 转换器提取为 `elsevier-converter.js`，HTML metadata 提取提取为 `metadata-extractor.js`。`papers-service.js` 只保留 CRUD 编排（约 300 行）。改动不影响外部接口，只是文件拆分。

#### 2. `normalizeServiceDeps` 兼容层已无调用方
- `services/index.js:135-209` 的 `normalizeServiceDeps()` 是为旧版扁平 deps 格式提供的适配层。当前 `core.js` 已经直接传入分组结构，测试中也使用旧扁平格式通过这个兼容层。
- 如果测试也迁移到分组格式，这 75 行兼容代码可以删除。
- **建议**：将 `services.test.js` 中的 `createContainerDeps()` 改为分组格式，然后删除 `normalizeServiceDeps`。

#### 3. `detail-helpers.js` 仍偏大（996 行）
- 其中 `extractReadableArticleHtml`（reader DOM 处理、article image fallback、math 渲染）和 annotation highlight/selection 逻辑各占约 300-400 行。
- **建议**：可以拆为 `article-reader.js`（DOM/渲染）和 `annotation-highlight.js`（选区/高亮），`detail-helpers.js` 只保留轻量工具。优先级不高，当前已脱离 store 层。

#### 4. `fetchHtmlDocument` 中 TLS 回退修改全局 `process.env`
- `papers-service.js:464` 通过临时修改 `process.env.NODE_TLS_REJECT_UNAUTHORIZED` 实现 TLS 证书错误重试。在并发请求下存在竞态风险（虽然当前单用户场景不太可能触发）。
- **建议**：改为使用 Node.js 的 `undici.Agent` 或 `https.Agent` 配置 `rejectUnauthorized: false`，作用域限定到单次请求。

### 二、前端

#### 5. `DetailLibraryView.jsx` 体量偏大（1300 行）
- 单个 JSX 文件同时承载 reader panel（article + annotation 列表 + annotation thread）和 discussion panel（discussion 列表 + discussion thread），以及编辑态、回复态、附件上传的全部 UI。
- **建议**：提取 `AnnotationPanel.jsx`（annotation 列表 + thread + 编辑/回复）和 `DiscussionPanel.jsx`（discussion 列表 + thread + 编辑/回复），`DetailLibraryView.jsx` 只做布局编排和 article 渲染。

#### 6. `catalog-store.js` 和 `detail-store.js` 串行刷新模式残留
- `catalog-store.js` 中 `deleteUser`（purgeContent 场景）、`deleteActivity`、`deletePaperById` 在变更后执行 `await refreshPapers(); await refreshDashboard(); await refreshMembersData()` 串行刷新。
- **建议**：与 #16 已完成的 `initializeCatalogPage` 并行化保持一致，将这些后续刷新也改为 `Promise.all`。

### 三、测试

#### 7. 集成测试覆盖面可扩展
- 当前集成测试主要覆盖 happy path（登录、CRUD、静态资源）。批注/讨论的编辑、回复链删除、附件上传/保留等 speech 写路径在集成测试中覆盖较薄，主要依赖 `services.test.js` 的单元测试。
- **建议**：补充 multipart 附件上传、编辑保留附件、回复链级联删除的集成测试。优先级低，当前单元测试已覆盖。

---

## 优先级建议（按 ROI）

| 优先级 | 项目 | 原因 |
|--------|------|------|
| **高** | #1 papers-service Elsevier/metadata 拆分 | 当前最大服务端文件，拆分后降至 ~300 行，改动纯机械 |
| **高** | #6 变更后刷新并行化 | 与已完成的 #16 一致，直接可测量的性能提升 |
| **中** | #2 删除 normalizeServiceDeps 兼容层 | 消除 75 行死代码，需同步改测试 |
| **中** | #4 TLS 回退改为 per-request agent | 消除全局状态竞态风险 |
| **中** | #5 DetailLibraryView 组件拆分 | 长期维护收益，改动面较大 |
| **低** | #3 detail-helpers 继续拆分 | 已脱离 store 层，不阻塞开发 |
| **低** | #7 集成测试扩展 | 单元测试已覆盖，优先级最低 |

### 远期备忘

- 如果未来出现多进程部署，再把 dashboard 进程内缓存与静态资源版本感知升级为跨进程可感知的方案。
- 如果 `dist` 体量明显增长，再把当前"全量预热"静态缓存升级为按大小受限的 LRU/分层策略。
