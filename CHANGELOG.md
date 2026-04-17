# 更新日志

## [Unreleased] - 2026-04-16

### 前端 TypeScript 与样式重构
- **前端迁移至 TS/TSX**：前端页面、状态层与测试已从 `.js` / `.jsx` 迁移到 `.ts` / `.tsx`。
- **严格模式**：启用了 TypeScript `strict`，并将核心业务类型集中到 `src/client/shared/types.ts`。
- **构建流程优化**：
  - 新增 `npm run type-check` 用于静态分析。
  - `npm run build` 现在包含 `tsc && vite build`。
- **运行时稳定化**：服务端入口仍为 `server.js` 与 `src/server/**/*.js`，生产运行使用 `node server.js`，不依赖 `tsx`。
- **测试支持**：Vitest 测试已同步迁移到 TypeScript，并保持通过。

### 稳定性观察窗口
- **依赖升级**：本次前端同时引入 Vite 8、TypeScript 6、Vitest 4、Tailwind CSS 4 与新的 PostCSS 配置。
- **视觉回归关注点**：`src/client/styles.css` 已按 Tailwind v4 重写，发布前后需重点人工走查 catalog 与 detail 页的登录、切页、批注、讨论、附件、选区高亮与移动端布局。
