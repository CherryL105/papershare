# PaperShare 项目优化空间分析

## 已完成优化（摘要）

1. **`core.js` 拆分**：从 4246 行收缩到 945 行；业务逻辑迁出到 `speech-service`、`papers-service`、`auth-service`、`users-service`、`assets-service`、`system-service`、`dashboard-service`、`http-service`；`createServices()` 改为注入底层能力，由 service 自己实现流程。
2. **前端 legacy runtime 移除**：catalog/detail 页面统一由 Preact 驱动；`app-runtime.js`、`catalog-runtime.js`、`detail-runtime.js`、`legacy-panels.html` 等全部删除。
3. **Dashboard 缓存**：聚合逻辑集中到 `dashboard-service.js`，`getForUser()` / `listUsersWithStats()` 做进程内缓存，写操作显式失效。
4. **首页查询优化**：`listWithActivity` 改为读取 papers 表冗余列 `speech_count / latest_speech_at / latest_speaker_username`，不再做 N 个相关子查询。
5. **JSON 克隆开销**：删除上层多余 `cloneJsonValue`，消除 parse-stringify-parse 重复。
6. **scrypt 异步化**：`hashPassword()` / `verifyPassword()` 改为异步，不再阻塞事件循环。
7. **路由初始化竞态**：路由在 `createHttpServer()` 中显式初始化。
8. **ownership backfill**：启动时回填 `created_by_user_id`，统计和 dashboard 只按 userId 聚合。
9. **静态资源内存缓存**：启动预热 `dist`，热路径不再 `fs.stat` / `fs.readFile`；支持 ETag/304。
10. **bootstrap 管理员安全**：密码通过环境变量注入，首次登录强制改密。
11. **HTTP 请求解析统一**：`http-service` 补上 `readPaperRequest()`、`sendError()` 等，参数校验错误稳定返回 400。
12. **SQLite 参数限制**：`listByIds` 按 900 条分块查询。
13. **附件名清洗逻辑收敛**：`sanitizeAttachmentName` 统一由 `core.js` 注入 `speech-service`，删除重复实现。
14. **speech-service 注入参数去冗余**：附件限制统一只保留 `maxAttachmentBytes / maxAttachmentCount / maxTotalAttachmentBytes` 一套命名。
15. **paper 路由存在性校验收敛**：`routes/api.js` 提取 `requirePaper()`，复用到 paper 详情、批注、讨论相关路由。
16. **catalog 热路径并行刷新**：`initializeCatalogPage()`、`changeUsername()` 改为并行刷新 papers/dashboard/members。
17. **detail content 请求并发化**：`selectPaper()` 在列表元数据已知有 snapshot 时并行预取 `/content`，并保留旧数据回退路径。
18. **前端状态层按 domain 拆分**：`client-store.js` 收敛为状态容器（当前 518 行），认证/导航/API 下沉到 `session-store.js`，catalog/profile/members/user-management action 下沉到 `catalog-store.js`，detail page action 下沉到 `detail-store.js`。
19. **speech helper 脱离 detail 命名空间**：annotation/discussion 排序、thread/reply 规则、附件编辑态与 `createSpeechFormData()` 等共享纯函数移动到 `speech-helpers.js`；`detail-helpers.js` 只保留 reader/DOM 逻辑（当前 996 行）。
20. **paper-scoped 404 集成测试基线修复**：`tests/server.integration.test.js` 改为对真实监听中的 server 使用 `request.agent(server)`，消除 `ECONNRESET` 假失败；当前 `npm test` 为 57/57 通过。

---

## 待优化项

### 一、架构可维护性

#### 8. `core.js` 可继续下沉的纯函数
- `core.js`（945 行）仍包含 multipart 解析（~150 行）、record normalizer（~120 行）、attachment 分类、HTML image stripping、文本工具等纯函数。
- **建议**：下沉为 `multipart.js`、`normalizers.js`、`html-sanitizer.js`，让 `core.js` 只做应用组装和启动。已不是瓶颈，视维护需要决定优先级。

---

## 优先级建议（按 ROI）

| 优先级 | 项目 | 原因 |
|--------|------|------|
| **高** | #8 core.js 继续下沉 | 当前剩余最明显的组装层噪音，适合继续把 `core.js` 收敛成纯装配层 |

### 远期备忘

- 如果未来出现多进程部署，再把 dashboard 进程内缓存与静态资源版本感知升级为跨进程可感知的方案。
- 如果 `dist` 体量明显增长，再把当前"全量预热"静态缓存升级为按大小受限的 LRU/分层策略。
