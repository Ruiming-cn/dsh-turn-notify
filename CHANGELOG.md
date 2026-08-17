# Changelog

本项目所有显著变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.0] - 2026-08-17

### Added（新增）

- **双语通知**：`language: 'zh' | 'en'` 配置，标题/正文/问答前缀/会话标签全部跟随语言（默认中文）
- **等待回答**：`ask_user_question` 工具调用时通知（含问题文本与问题数）
- **计划待审阅**：`exit_plan_mode` 工具调用时通知
- **运行出错**：`agent/error` 步骤级错误即时通知（与 `turn/end: error` 归一防双弹）
- **防风暴合并**：同会话同类关键事件 1.5s 合并（`mergeWindowMs` 可配）
- **approval 原因**：`approval/asked` 的 `reason` 显示为「原因：…」
- **会话状态清理**：`session/disposed` 释放状态 + 容量上限（`maxSessions`，默认 128）
- **版本自检日志**：启动输出 `[turn-notify] loaded (build ...)` 便于确认版本

### Changed（变更）

- 提示音改为 `Windows Background.wav`（缺失回退 chimes/Ding/Notify）
- 提示音与弹窗**同步播放**（移除旧版 1.2s 延迟）
- `dsh-notify.exe` 改为构建产物、**不入库**（clone 后需按 README「构建」章节编译）

### Fixed（修复）

- `truncate` 按 Unicode 码点截断（emoji 不再被劈开）
- spawn 同步抛错不再卡住串行队列（记日志后继续下一个）
- 超时日志文案适配 exe 模式（不再误写 "killing powershell"）

## [0.1.0] - 2026-08-16

### Added（新增）

- 初始实现：Cordis 插件监听 `session/event`，覆盖轮次完成/目标阻塞/对话中断/出错/输出上限/会话中断/等待批准
- `dsh-notify.exe`（C# 独立通知器，AUMID `dsh-turn-notify`）与 `notify.ps1` 回退路径
- WinRT Toast（长横幅 + 鲸鱼图标 + 标题放大）+ 托盘气泡降级
- 问答内容预览（`previewChars`，默认 15 字）与「叮咚」提示音（默认开启）
- 多会话隔离：按会话冷却、completed 串行队列、关键事件直发、子代理静默
- 45 个 `node:test` 单元测试

[Unreleased]: https://github.com/Ruiming-cn/dsh-turn-notify/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Ruiming-cn/dsh-turn-notify/releases/tag/v1.0.0
[0.1.0]: https://github.com/Ruiming-cn/dsh-turn-notify/releases/tag/v0.1.0
