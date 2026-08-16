# dsh-turn-notify

DSH（DeepSeek Harness）轮次完成通知插件：在**轮次完成、目标阻塞、对话中断、出错、等待批准**等需要用户下达新指令的时刻，发送 Windows 系统通知——叮咚提示音 + DSH 黑色鲸鱼图标 + 问/答内容预览，让你离开屏幕也能感知 Agent 何时在等你。

## 功能清单

### 触发时机

监听 DSH 会话事件（`session/event`），在以下时机弹出通知：

- **轮次完成**（`turn/end: completed`，仅用户直接发起的轮次）
- **目标阻塞 / 暂停 / 完成**（`goal/change` 状态转变）
- **对话中断 / 中止**（`turn/end: aborted`，区分用户中止与父代理中止）
- **轮次出错 / 达到输出上限**（`turn/end: error / max-tokens`）
- **会话中断（崩溃恢复）**（`turn/end: interrupted`）
- **等待批准**（`approval/asked`，含工具名）

### 通知样式

- **WinRT Toast**：`duration='long'` 长横幅、`ToastText02` 模板、标题使用 `hint-style='title'` 档
- **图标**：DSH 黑色鲸鱼（由开始菜单快捷方式 `IconLocation` 指向 `dsh-whale.ico` 决定，无需打包进 exe）
- **正文三行格式**：会话编号（`会话 xxxxxx`）/ `问：…` / `答：…`，问与答各按 `previewChars=15` 字截断，保证三行完整显示

### 提示音

- 系统 `chimes.wav`「叮咚」提示音，`SoundPlayer` 直接播放
- 延迟 1.2s 与横幅同步出现（先弹横幅、再播声音）
- **不依赖系统通知音效设置**——即使 Windows 通知音效被设为「无」也照常播放

### 多会话隔离

- 通知状态按会话键控（`session.id`），互不干扰
- `completed` 通知走串行队列逐个发送；关键事件（阻塞/中断/出错/等待批准）**直发**，不受队列阻塞
- 冷却去抖：同一会话普通完成 10s 限频，关键事件不限
- 子代理会话静默，只通知根会话

### 通知器

- 优先 `dsh-notify.exe`：C# 编译的独立可执行文件，AUMID `dsh-turn-notify` 已注册，绕开安全软件对脚本宿主的拦截
- 缺失时自动回退 `notify.ps1`（PowerShell + WinRT Toast）
- 通知失败自动降级：Toast → 托盘气泡 → 日志

### 可配置项

| 配置 | 默认 | 说明 |
| --- | --- | --- |
| `notify` | 全开 | 各事件类型的开关（`completed` / `blocked` / `aborted` / `error` / `maxTokens` / `interrupted` / `goals` / `approvals`） |
| `cooldownMs` | `10000` | 普通完成通知的冷却时间（毫秒/会话） |
| `previewChars` | `15` | 问/答预览截断字数 |
| `titlePrefix` | `'DSH'` | 通知标题前缀 |
| `showSessionTag` | `true` | 是否显示会话编号行 |
| `sound` | `true` | 是否播放提示音 |
| `timeoutMs` | `10000` | 通知子进程超时 |
| `dryRun` | `false` | 只记录日志不真正发送（测试用） |

## 目录结构

```
dsh-turn-notify/
├── plugin/                  # 插件本体（纯 ESM，无构建步骤）
│   ├── index.mjs            # Cordis 插件入口：事件监听 + 调度
│   ├── decide.mjs           # 决策器：事件→通知映射、过滤、冷却、预览
│   ├── scheduler.mjs        # 通知调度：串行队列 + 关键事件直发 + 超时
│   ├── dsh-notify.cs        # 通知器 C# 源码（Toast + 提示音 + 托盘气泡）
│   ├── dsh-notify.exe       # 编译产物（AUMID dsh-turn-notify）
│   ├── notify.ps1           # PowerShell 回退通知脚本
│   ├── smoke.ps1            # 手动冒烟脚本
│   └── test.mjs             # node:test 单元测试
├── docs/                    # 设计文档与实施计划
└── test/harness/            # 测试用 DSH 事件模拟器
```

## 环境要求

- Windows 10/11
- DSH（DeepSeek Harness），利用其 cordis 补丁机制（`cordis.patch.yml`）

## 接入方式

### 1. 安装插件（拷贝到全局 profile）

将插件目录拷贝到 DSH profile：

```powershell
Copy-Item "P:\dshTest\dsh-turn-notify\plugin\*" "C:\Users\20668\.dsh\profiles\web\turn-notify\" -Recurse -Force
```

（或直接 `git clone https://github.com/Ruiming-cn/dsh-turn-notify` 后拷贝。）

### 2. 配置补丁

在 `~/.dsh/profiles/web/cordis.patch.yml` 的 insert 列表中追加条目：

```yaml
    - id: turn-notify
      name: "./turn-notify/index.mjs"
      config:
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
        cooldownMs: 10000
        previewChars: 15
        titlePrefix: DSH
        showSessionTag: true
        timeoutMs: 10000
        dryRun: false
```

> `name` 使用相对路径（相对 profile 目录解析，如 `./turn-notify/index.mjs`）；若插件在仓库内用绝对路径，需用 `file:///` URL 形式（Node ESM 不接受盘符裸路径）。

### 2. 重启 GUI

修改 patch 后**重启 DSH GUI** 生效。插件启动后可查看日志确认 `[turn-notify]` 相关输出。

### 3. 首次使用：注册 AUMID 快捷方式（一次性）

Toast 要显示应用图标、且归属于「DSH 通知」而不是「PowerShell」，需要系统里存在一个带 AUMID 的开始菜单快捷方式：

- 位置：开始菜单 `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DSH 通知.lnk`
- 目标：`P:\dshTest\dsh-turn-notify\plugin\dsh-notify.exe`
- AppUserModelID：`dsh-turn-notify`
- IconLocation：DSH 黑色鲸鱼图标 `C:\Users\20668\.dsh\dsh-whale.ico,0`

**作用**：① AUMID 注册是 WinRT Toast 按应用显示的必需条件（否则 toast 归到 "PowerShell" 名下、图标异常）；② 快捷方式的 IconLocation 是 toast 顶部应用图标的唯一来源（exe 内不打包图标）。

> 已注册后无需重复操作；重装/换机需重新注册。

## 测试

```powershell
node --test plugin/test.mjs
```

28 个单元测试，覆盖：各事件类型的通知判定、子代理静默、按会话冷却、串行队列与关键事件直发、超时与异常处理、dryRun、exePath 模式、问/答预览截断与清理等。

## 构建 dsh-notify.exe（可选）

插件优先使用预编译的 `dsh-notify.exe`（已入库）；如需重新编译（如更新 C# 代码），依赖：

- .NET Framework 4.8 的 csc.exe（`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`）
- Windows SDK 的 `Windows.winmd`（UnionMetadata，本机 10.0.26100.0）
- GAC 中的 `System.Runtime.dll` 与 `System.Runtime.WindowsRuntime.dll`

```powershell
$winmd = "C:\Program Files (x86)\Windows Kits\10\UnionMetadata\10.0.26100.0\Windows.winmd"
$sysruntime = "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Runtime.dll"
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /nostdlib /target:exe /out:"dsh-notify.exe" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:"$sysruntime" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Runtime.WindowsRuntime.dll /r:"$winmd" "dsh-notify.cs"
```

图标资源：toast 鲸鱼图标来自开始菜单快捷方式「DSH 通知.lnk」的 IconLocation（指向 `dsh-whale.ico`，需随迁移拷贝至目标目录并重建快捷方式：Target=dsh-notify.exe、AppUserModelID=dsh-turn-notify）。

## 故障排查

| 现象 | 排查 |
| --- | --- |
| 无提示音 | 检查 patch 配置 `sound: true`；手动验证：`dsh-notify.exe -Title t -Body b -Sound` |
| toast 不显示 | 确认开始菜单「DSH 通知.lnk」快捷方式存在（AUMID 已注册）；安全软件（电脑管家等）拦截时，对 `dsh-notify.exe` 添加信任 |
| 横幅内容被裁剪 | Windows 横幅高度限制约 3 行，`previewChars=15` 保证「会话/问/答」三行完整显示；不要把该值调得过大 |
| 系统通知音效设为「无」仍无声 | 本插件用 `SoundPlayer` 直接播放 `chimes.wav`，不依赖系统通知音效设置；若仍无声，检查系统音量与 `C:\Windows\Media\chimes.wav` 是否存在 |

## 迁移与发布

- **已发布**：https://github.com/Ruiming-cn/dsh-turn-notify （MIT License）
- **已迁移全局**：插件运行于 `~/.dsh/profiles/web/turn-notify/`，patch 使用相对路径 `./turn-notify/index.mjs`
- **更新插件**：拉取仓库最新代码后，重新拷贝 `plugin/` 至全局目录并重启 GUI；如 `dsh-notify.cs` 有改动需重编译 exe（见「构建 dsh-notify.exe」章节）

