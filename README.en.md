# dsh-turn-notify

English | [简体中文](./README.md)

A notification plugin for DSH (DeepSeek Harness): whenever the **agent needs your input**, it sends a Windows system notification — a toast in the corner + a chime + a preview of the question/answer — so you know the moment the agent is waiting for you, even when you're away from the screen.

## Features

### When it fires (every moment the agent needs you)

| Moment | Event | Notes |
|---|---|---|
| Turn completed | `turn/end: completed` | User-initiated turns only; 10s cooldown |
| Goal blocked / paused / completed | `goal/change` | Only on phase transitions (`create→active` etc. stay silent) |
| Conversation interrupted / aborted | `turn/end: aborted` | Distinguishes user stop vs parent/hook cancel |
| Turn error | `turn/end: error` | Includes error code + truncated message |
| Output limit reached | `turn/end: max-tokens` | Output was truncated |
| Session interrupted (crash recovery) | `turn/end: interrupted` | Check the session |
| **Approval needed** | `approval/asked` | Includes tool name and reason |
| **Waiting for your answer** | `ask_user_question` tool call | Agent asks and blocks on you; includes question text and count |
| **Plan awaiting review** | `exit_plan_mode` tool call | Plan is ready — review it or keep planning |
| **Runtime error** | `agent/error` | Step-level failure, notified mid-turn without waiting for turn end |

> Subagent sessions stay silent; only root sessions notify.

### Notification style

- **WinRT Toast**: `duration='long'`, `ToastText02` template, `hint-style='title'` headline
- **Icon**: DSH black whale (set via the Start-menu shortcut's `IconLocation`; not embedded in the exe)
- **Three-line body**: session tag (`Session xxxxxx`) / `Q: …` / `A: …`, each truncated to `previewChars` (default 15)
- **Bilingual**: `language: 'zh' | 'en'` (default Chinese) — titles, bodies, Q/A prefixes and session tags all follow the language

### Chime

- Defaults to `C:\Windows\Media\Windows Background.wav` (falls back to chimes / Ding / Notify)
- Played directly via `SoundPlayer`, **in sync with the toast** (no delay; independent of the system notification-sound setting)

### Multi-session isolation & anti-storm

- Per-session state keyed by `session.id`; sessions never interfere
- `completed` notifications run through a serial queue; critical events are dispatched **immediately**, never blocked by the queue
- **Anti-storm**: same-session same-kind critical events merge into one within 1.5s (`error`/`agent-error` and `blocked`/`goal-blocked` are unified, preventing double toasts)
- Session state is released on `session/disposed` and capped (default 128 sessions, oldest evicted) — no unbounded memory growth

### Notifier

- Prefers `dsh-notify.exe` (standalone C# binary, AUMID `dsh-turn-notify` registered — bypasses security software that blocks script hosts)
- Falls back to `notify.ps1` (PowerShell + WinRT Toast) when the exe is missing
- Three-level degradation on failure: Toast → tray balloon → log

## Layout

```
dsh-turn-notify/
├── plugin/                  # Plugin body (pure ESM, no build step)
│   ├── index.mjs            # Cordis entry: event listeners + dispatch
│   ├── decide.mjs           # Decider: event→notice mapping, bilingual copy, filtering, cooldown, anti-storm, preview
│   ├── scheduler.mjs        # Scheduling: serial queue + critical fast-path + timeout
│   ├── dsh-notify.cs        # Notifier C# source (Toast + chime + tray balloon)
│   ├── dsh-notify.exe       # Build artifact (AUMID dsh-turn-notify; NOT committed, see "Build")
│   ├── notify.ps1           # PowerShell fallback script
│   ├── smoke.ps1            # Manual smoke-test script
│   └── test.mjs             # node:test unit tests
├── docs/                    # Design docs & implementation plan
└── test/harness/            # DSH event simulator for tests
```

## Requirements

- Windows 10/11
- DSH (DeepSeek Harness), using its cordis patch mechanism (`cordis.patch.yml`)
- Node.js ≥ 18.13 (tests only)

## Installation

### 1. Install the plugin (copy to the global profile)

```powershell
# Build dsh-notify.exe first (see "Build"), then copy all of plugin/
Copy-Item "plugin\*" "$env:USERPROFILE\.dsh\profiles\web\turn-notify\" -Recurse -Force
```

(Or `git clone https://github.com/Ruiming-cn/dsh-turn-notify` and follow the same steps.)

### 2. Configure the patch

Append an entry to the insert list in `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
    - id: turn-notify
      name: "./turn-notify/index.mjs"
      config:
        language: zh            # zh | en (notification copy; default zh)
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

> `name` resolves relative to the profile directory; use a `file:///` URL when referencing a plugin inside a repo.

### 3. Restart the DSH GUI

**Restarting is required after any plugin code change** (Node module cache + DSH's HMR is watch-only — it listens to `cordis.patch.yml` only, it does not hot-reload plugin JS). After restart, the startup log should show:

```
[turn-notify] loaded (build <date>: questions/planReview/agentError/mergeWindow active)
```

### 4. One-time: register the AUMID shortcut

For the toast to show the app icon and belong to "DSH 通知" instead of "PowerShell", a Start-menu shortcut with an AUMID must exist:

- Location: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\DSH 通知.lnk`
- Target: `...\turn-notify\dsh-notify.exe`
- AppUserModelID: `dsh-turn-notify`
- IconLocation: DSH black whale icon `C:\Users\20668\.dsh\dsh-whale.ico,0`

> Do this once; re-register after reinstalling or switching machines.

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `notify` | all on | Per-kind toggles (`completed`/`blocked`/`aborted`/`error`/`maxTokens`/`interrupted`/`goals`/`approvals`/`questions`/`planReview`/`agentError`) |
| `language` | `'zh'` | Notification copy language: `zh` (Chinese) or `en` (English) |
| `cooldownMs` | `10000` | Completed-notification cooldown (ms per session) |
| `mergeWindowMs` | `1500` | Anti-storm merge window for critical events (ms, per session per kind) |
| `maxSessions` | `128` | Session-state cap (oldest evicted when exceeded) |
| `previewChars` | `15` | Q/A preview truncation length |
| `titlePrefix` | `'DSH'` | Notification title prefix |
| `showSessionTag` | `true` | Show the session-tag line |
| `sound` | `true` | Play the chime |
| `timeoutMs` | `10000` | Notifier subprocess timeout |
| `dryRun` | `false` | Log only, don't actually send (testing) |
| `rootSessionsOnly` | `true` | Notify root sessions only (subagents stay silent) |

## Building dsh-notify.exe (required after clone)

`dsh-notify.exe` is a build artifact and is **not committed** (see `.gitignore`). Build it after cloning so the plugin uses the exe path; when missing, the plugin falls back to `notify.ps1` (which security software may block). Dependencies:

- .NET Framework 4.8 `csc.exe` (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`)
- Windows SDK `Windows.winmd` (UnionMetadata, e.g. 10.0.26100.0)
- GAC `System.Runtime.dll` and `System.Runtime.WindowsRuntime.dll`

```powershell
$winmd = "C:\Program Files (x86)\Windows Kits\10\UnionMetadata\10.0.26100.0\Windows.winmd"
$sysruntime = "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime\v4.0_4.0.0.0__b03f5f7f11d50a3a\System.Runtime.dll"
& "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /nostdlib /target:exe /out:"dsh-notify.exe" /r:mscorlib.dll /r:System.dll /r:System.Core.dll /r:"$sysruntime" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Runtime.WindowsRuntime.dll /r:"$winmd" "dsh-notify.cs"
```

Run it inside `plugin/` (`/out` writes to the current directory), then copy the whole `plugin/` folder to the global profile.

## Tests

```powershell
node --test plugin/test.mjs
```

51 unit tests covering: every notification kind, waiting-answer / plan-review / runtime-error, Chinese & English copy, subagent silence, per-session cooldown, anti-storm merging, serial queue & critical fast-path, timeout & error handling, synchronous spawn-failure recovery, dryRun, exePath mode, Q/A preview with code-point-safe truncation, state cleanup & capacity cap.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Changes don't take effect | **Restart the GUI** (plugin JS is not hot-reloaded); confirm `[turn-notify] loaded (build ...)` in the startup log |
| No chime | Check `sound: true` in the patch; verify manually with `dsh-notify.exe -Title t -Body b -Sound`; confirm `C:\Windows\Media\Windows Background.wav` exists |
| No toast | Confirm the `DSH 通知.lnk` shortcut exists (AUMID registered); add `dsh-notify.exe` to security-software trust; check Focus Assist (Do Not Disturb) |
| Banner content clipped | Windows banners hold ~3 lines; keep `previewChars=15` for a full three-line body |
| No toast while DSH is focused | Notifications are OS-level UI, unrelated to focus; usually Focus Assist or system volume |

## Migration & Release

- **Published**: https://github.com/Ruiming-cn/dsh-turn-notify (MIT License)
- **Deployed globally**: runs at `~/.dsh/profiles/web/turn-notify/`, patch uses a relative path
- **Updating**: pull the latest code → build the exe in `plugin/` (see "Build") → copy `plugin/` to the global profile → restart the GUI
- **History**: see [CHANGELOG.md](./CHANGELOG.md)
