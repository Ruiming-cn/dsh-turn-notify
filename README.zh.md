# dsh-turn-notify

简体中文 | [English](./README.md)

给 DeepSeek Harness 的 Windows 系统通知：Agent 停下来等你时、你发起的轮次结束时，都能收到提醒——不必把窗口一直放在最前面。

> **仅 Windows 可用。** 其他平台上插件会正常加载、打一行日志，然后什么都不做。

## 会提醒什么

两类时机，三个开关。

| 开关 | 时机 | 通知内容 |
| --- | --- | --- |
| **需要你介入时** | `approval/asked`、`ask_user_question`、`exit_plan_mode` | 等待批准 / 等待回答 / 计划待审阅，并带上工具名、首个问题或原因 |
| **轮次完成时** | `turn/end` → `completed`，且是你发起的轮次 | 轮次完成，附一句回答预览 |
| **轮次异常结束时** | `turn/end` → `error` / `blocked` / `aborted` / `max-tokens` / `interrupted` | 错误码与信息，或具体是哪一种结束 |
| **播放提示音** | 每条通知 | 系统默认通知音，或静音 |

只有你发起的轮次结束才会提醒：目标续跑、定时任务等注入式轮次保持安静。子智能体会话一律不提醒。你自己中断的轮次会明说是「已停止」，不会假装出错。

## 安装

```powershell
dsh plugin --profile <profile> add https://github.com/Ruiming-cn/dsh-turn-notify/releases/download/v1.0.0/dsh-turn-notify-1.0.0.tgz
```

或从本地检出安装：

```powershell
dsh plugin --profile <profile> add D:\path\to\dsh-turn-notify
```

安装后重启 GUI，启动日志会出现一行：

```
[turn-notify] ready: Windows toasts for approvals, questions and turn ends
```

## 开关

**设置 → 轮次提醒。** 四个复选框，改完对下一条通知立即生效，不需要重启或刷新。它们就是插件的热更新配置，值存在 profile 的 `cordis.patch.yml` 中 `turn-notify` 行下，也可以直接改文件：

```yaml
- id: turn-notify
  name: dsh-turn-notify
  config:
    needsInput: true
    turnCompleted: false
    turnProblems: true
    sound: true
```

缺省视为默认值（`true`）。

## 实现方式

- 只监听持久化事件流 `session/event`：批准与提问来自 `approval/asked` 和两个阻塞式工具调用，轮次结束来自 `turn/end` 及其 reason。没有轮询、没有定时器、不落盘任何状态。
- 每条通知就是一次 `powershell.exe -File notify.ps1`：以插件自己的应用身份弹 WinRT toast，失败时降级为托盘气泡。数据不出本机，也不会残留进程。
- 通知语言跟随 Windows 显示语言：以 `zh` 开头用中文，否则英文。

## 限制

- **仅 Windows**，其他平台 Host 入口直接返回。
- **需要 Windows PowerShell 5.1**——脚本用的 WinRT 投影只有 Windows PowerShell 提供。
- **专注助手（勿扰）和通知开关会挡住通知**，这是系统设置，插件无法绕过。
- toast 以应用 id `dsh-turn-notify` 显示。当前 Windows 版本无需注册开始菜单快捷方式即可显示；若你的机器丢弃它，见下方排查表。
- 通知只带短预览，不是完整记录：长横幅大约三行。

## 排查

| 现象 | 检查 |
| --- | --- |
| 完全收不到通知 | 设置 → 系统 → 通知：通知已开启、专注助手已关闭；如列表中有 `dsh-turn-notify` 则允许它 |
| 收不到通知也没有日志 | 插件未生效：看 Plugins 页面和启动日志那一行 |
| 有通知没声音 | 提示音开关，再看 Windows 音量合成器 |
| 通知里没有问题文本 | 模型调用工具时没给出可读的问题；标题仍会弹出 |
| macOS/Linux 上没反应 | 预期行为，插件仅支持 Windows |
| 手工测试 | `powershell.exe -NoProfile -File notify.ps1 -Title "DSH · 测试" -Body "hello" -Sound` |

## 开发

```powershell
npm ci
npm run check     # 构建（esbuild + 类型声明）并跑单测
npm pack          # 生成市场应提供的预构建 tarball
```

`lib/` 入库且必须可复现：CI 会重新构建，出现 diff 即失败。

## 许可证

MIT
