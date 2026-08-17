# dsh-turn-notify

[English](./README.en.md) | 简体中文

DSH（DeepSeek Harness）通知插件：在 **Agent 需要你介入** 的任何时刻，发送 Windows 系统通知——右下角弹窗 + 提示音 + 问答内容预览，让你离开屏幕也能感知 Agent 何时在等你。

## 功能特性

### 触发时机（凡是需要人工操作都提示）

| 时机 | 事件 | 说明 |
|---|---|---|
| 轮次完成 | `turn/end: completed` | 仅用户直接发起的轮次；10s 冷却去抖 |
| 目标阻塞 / 暂停 / 完成 | `goal/change` | 状态转变时通知（`create→active` 等不通知） |
| 对话中断 / 中止 | `turn/end: aborted` | 区分用户中止与父代理/hook 中止 |
| 轮次出错 | `turn/end: error` | 含错误码与截断的错误信息 |
| 达到输出上限 | `turn/end: max-tokens` | 本轮输出被截断 |
| 会话中断（崩溃恢复） | `turn/end: interrupted` | 检查会话状态 |
| **等待批准** | `approval/asked` | 含工具名与原因说明 |
| **等待回答** | `ask_user_question` 工具调用 | Agent 主动向你提问并阻塞等待，含问题文本与问题数 |
| **计划待审阅** | `exit_plan_mode` 工具调用 | 计划完成，等你审阅或继续规划 |
| **运行出错** | `agent/error` | 步骤级错误，回合中途失败即通知，不等回合结束 |

> 子代理会话静默，只通知根会话。

### 通知样式

- **WinRT Toast**：`duration='long'` 长横幅、`ToastText02` 模板、标题 `hint-style='title'`
- **图标**：DSH 黑色鲸鱼（由开始菜单快捷方式 `IconLocation` 决定，无需打包进 exe）
- **正文三行**：会话编号（`会话 xxxxxx`）/ `问：…` / `答：…`，问答各按 `previewChars`（默认 15 字）截断
- **双语**：`language: 'zh' | 'en'`（默认中文），标题/正文/问答前缀/会话标签全部跟随语言

### 提示音

- 默认 `C:\Windows\Media\Windows Background.wav`（缺失时回退 chimes / Ding / Notify）
- `SoundPlayer` 直接播放，**与弹窗同步**（无延迟；不依赖系统通知音效设置）

### 多会话隔离与防风暴

- 通知状态按会话键控（`session.id`），互不干扰
- `completed` 走串行队列逐个发送；关键事件**直发**，不受队列阻塞
- **防风暴**：同一会话同类关键事件 1.5s 合并为一条（`error` 与 `agent-error`、`blocked` 与 `goal-blocked` 归一，避免双弹）
- 会话状态随 `session/disposed` 释放，并有容量上限（默认 128 会话，最旧淘汰）——长跑无内存增长

### 通知器

- 优先 `dsh-notify.exe`（C# 独立可执行文件，AUMID `dsh-turn-notify` 已注册，绕开安全软件对脚本宿主的拦截）
- 缺失时自动回退 `notify.ps1`（PowerShell + WinRT Toast）
- 通知失败三级降级：Toast → 托盘气泡 → 日志

## 目录结构

```
dsh-turn-notify/
├── plugin/                  # 插件本体（纯 ESM，无构建步骤）
│   ├── index.mjs            # Cordis 插件入口：事件监听 + 调度
│   ├── decide.mjs           # 决策器：事件→通知映射、双语文案、过滤、冷却、防风暴、预览
│   ├── scheduler.mjs        # 通知调度：串行队列 + 关键事件直发 + 超时
│   ├── dsh-notify.cs        # 通知器 C# 源码（Toast + 提示音 + 托盘气泡）
│   ├── dsh-notify.exe       # 构建产物（AUMID dsh-turn-notify，不入库，见「构建」章节）
│   ├── notify.ps1           # PowerShell 回退通知脚本
│   ├── smoke.ps1            # 手动冒烟脚本
│   └── test.mjs             # node:test 单元测试
├── docs/                    # 设计文档与实施计划
└── test/harness/            # 测试用 DSH 事件模拟器
```

## 环境要求

- Windows 10/11
- DSH（DeepSeek Harness），利用其 cordis 补丁机制（`cordis.patch.yml`）
- Node.js ≥ 18.13（仅测试需要）

## 接入方式

### 1. 安装插件（拷贝到全局 profile）

```powershell
# 先构建 dsh-notify.exe（见「构建」章节），再拷贝 plugin/ 全部文件
Copy-Item "plugin\*" "$env:USERPROFILE\.dsh\profiles\web\turn-notify\" -Recurse -Force
```

（或 `git clone https://github.com/Ruiming-cn/dsh-turn-notify` 后按上述操作。）

### 2. 配置补丁

在 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 列表中追加条目：

```yaml
    - id: turn-notify
      name: "./turn-notify/index.mjs"
      config:
        language: zh            # zh | en（通知文案语言，默认 zh）
        sound: true
        notify:
          completed: true
          blocked: true
          aborted: true
          error: true
          maxTokens: true
          interrupted: true
          goals: true
          approvals: true
          questions: true
          planReview: true
          agentError: true
        cooldownMs: 10000
        mergeWindowMs: 1500
        previewChars: 15
        titlePrefix: DSH
        showSessionTag: true
        timeoutMs: 10000
        dryRun: false
```

> `name` 使用相对路径（相对 profile 目录解析）；插件在仓库内用绝对路径时需 `file:///` URL 形式。

### 3. 重启 DSH GUI

**改插件代码后必须重启 GUI 生效**（Node 模块缓存 + DSH 的 HMR 为 watch-only，只监听 `cordis.patch.yml`，不会热重载插件 JS）。重启后启动日志出现以下行即确认新版本已生效：

```
[turn-notify] loaded (build <日期>: questions/planReview/agentError/mergeWindow active)
```

### 4. 首次使用：注册 AUMID 快捷方式（一次性）

Toast 要显示应用图标、且归属于「DSH 通知」而不是「PowerShell」，需要系统存在一个带 AUMID 的开始菜单快捷方式：

- 位置：开始菜单 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DSH 通知.lnk`
- 目标：`...\turn-notify\dsh-notify.exe`
- AppUserModelID：`dsh-turn-notify`
- IconLocation：DSH 黑色鲸鱼图标 `C:\Users\20668\.dsh\dsh-whale.ico,0`

> 已注册后无需重复操作；重装/换机需重新注册。

## 配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `notify` | 全开 | 各事件类型开关（`completed`/`blocked`/`aborted`/`error`/`maxTokens`/`interrupted`/`goals`/`approvals`/`questions`/`planReview`/`agentError`） |
| `language` | `'zh'` | 通知文案语言：`zh`（中文）或 `en`（英文） |
| `cooldownMs` | `10000` | 普通完成通知冷却（毫秒/会话） |
| `mergeWindowMs` | `1500` | 关键事件防风暴合并窗口（毫秒，同会话同类） |
| `maxSessions` | `128` | 会话状态容量上限（超限淘汰最旧） |
| `previewChars` | `15` | 问/答预览截断字数 |
| `titlePrefix` | `'DSH'` | 通知标题前缀 |
| `showSessionTag` | `true` | 是否显示会话编号行 |
| `sound` | `true` | 是否播放提示音 |
| `timeoutMs` | `10000` | 通知子进程超时 |
| `dryRun` | `false` | 只记录日志不真正发送（测试用） |
| `rootSessionsOnly` | `true` | 只通知根会话（子代理静默） |

## 构建 dsh-notify.exe（clone 后必需）

`dsh-notify.exe` 是构建产物、**不入库**（见 `.gitignore`），clone 后需先编译，插件才走 exe 通知路径；缺失时自动回退 `notify.ps1`（但可能被安全软件拦截）。依赖：

- .NET Framework 4.8 的 csc.exe（`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）
- Windows SDK 的 `Windows.winmd`（UnionMetadata，本机 10.0.26100.0）
- GAC 中的 `System.Runtime.dll` 与 `System.Runtime.WindowsRuntime.dll`

```powershell
$winmd = "C:\Program Files (x86)\Windows Kits\10\UnionMetadata\10.0.26100.0\Windows.winmd"
$sysruntime = "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Runtime.dll"
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /nostdlib /target:exe /out:"dsh-notify.exe" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:"$sysruntime" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Runtime.WindowsRuntime.dll /r:"$winmd" "dsh-notify.cs"
```

在 `plugin/` 目录下执行（`/out` 输出到当前目录），然后把 `plugin/` 整体拷贝到全局 profile。

## 测试

```powershell
node --test plugin/test.mjs
```

51 个单元测试，覆盖：各事件类型通知判定、等待回答/计划审阅/运行出错、中英文文案、子代理静默、按会话冷却、防风暴合并、串行队列与关键事件直发、超时与异常处理、spawn 同步失败续排、dryRun、exePath 模式、问/答预览与码点安全截断、状态清理与容量上限等。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 改代码后不生效 | **重启 GUI**（插件 JS 不热重载）；确认启动日志出现 `[turn-notify] loaded (build ...)` |
| 无提示音 | 检查 patch 配置 `sound: true`；手动验证 `dsh-notify.exe -Title t -Body b -Sound`；确认 `C:\Windows\Media\Windows Background.wav` 存在 |
| toast 不显示 | 确认「DSH 通知.lnk」快捷方式存在（AUMID 已注册）；安全软件拦截时对 `dsh-notify.exe` 添加信任；检查专注助手（勿扰）设置 |
| 横幅内容被裁剪 | Windows 横幅高度约 3 行，`previewChars=15` 保证三行完整；不要调得过大 |
| 焦点在 DSH 时不弹窗 | 通知是系统级 UI，与焦点无关；多半是专注助手或系统音量问题 |

## 迁移与发布

- **已发布**：https://github.com/Ruiming-cn/dsh-turn-notify （MIT License）
- **已迁移全局**：插件运行于 `~/.dsh/profiles/web/turn-notify/`，patch 使用相对路径
- **更新插件**：拉取最新代码 → `plugin/` 下编译 exe（见「构建」章节）→ 拷贝 `plugin/` 至全局目录 → 重启 GUI
- **变更历史**：见 [CHANGELOG.md](./CHANGELOG.md)
