# dsh-turn-notify

[简体中文](./README.zh.md) | English

Windows toast notifications for DeepSeek Harness: know when the agent is waiting
on you, and when the turn you started is done — without keeping the window in
front of you.

> **Windows only.** Everywhere else the plugin loads, logs one line, and does
> nothing.

## What it tells you

Two families of moments, split into three notification switches plus one for
sound.

| Switch | Moments | What the toast says |
| --- | --- | --- |
| **When I am needed** | `approval/asked`, `ask_user_question`, `exit_plan_mode` | waiting for your approval / answer / plan review, with the tool, the first question, or the reason |
| **When a turn completes** | `turn/end` → `completed`, for turns you started | turn completed, with a short preview of the answer |
| **When a turn ends badly** | `turn/end` → `error` / `blocked` / `aborted` / `max-tokens` / `interrupted` | the error code and message, or which kind of ending happened |
| **Play a sound** | every toast | the default Windows notification sound, or silence |

Turn endings are only announced for turns you asked for: goal rounds, cron jobs
and other injected turns stay quiet. Subagent sessions never notify. A turn that
ends because you stopped it says so instead of pretending something failed.

## Install

```powershell
dsh plugin --profile <profile> add https://github.com/Ruiming-cn/dsh-turn-notify/releases/download/v1.0.0/dsh-turn-notify-1.0.0.tgz
```

Or from a checkout:

```powershell
dsh plugin --profile <profile> add D:\path\to\dsh-turn-notify
```

Restart the GUI after installing. The startup log shows one line:

```
[turn-notify] ready: Windows toasts for approvals, questions and turn ends
```

## The switches

**Settings → Turn notifications.** Four checkboxes, applied to the next
notification — no restart, no reload. They are ordinary live plugin
configuration, so the values are stored in the profile's `cordis.patch.yml`
under the `turn-notify` row and can also be edited there:

```yaml
- id: turn-notify
  name: dsh-turn-notify
  config:
    needsInput: true
    turnCompleted: false
    turnProblems: true
    sound: true
```

A missing value means the default (`true`).

## How it works

- One listener on the durable `session/event` feed. Approvals and questions are
  read from `approval/asked` and the two blocking tool calls; turn endings from
  `turn/end` and its reason. No polling, no timer, no state on disk.
- Each toast is one `powershell.exe -File notify.ps1` call: a WinRT toast under
  the plugin's own app identity, with the tray balloon as a fallback. Nothing
  leaves the machine, and no process is left running.
- The notification language follows the Windows display language: Chinese when
  it starts with `zh`, English otherwise.

## Limitations

- **Windows only.** The Host entry refuses to do anything elsewhere.
- **Windows PowerShell 5.1 is required** — the script uses the WinRT
  projection that only Windows PowerShell provides.
- **Focus Assist and notification settings can hide the toast.** That is a
  Windows setting, not something this plugin can override.
- The toast is shown under the app id `dsh-turn-notify`. Windows displays it
  without a registered Start-menu shortcut on current builds; if your machine
  drops it, see the troubleshooting table.
- Notification content is a short preview, not a transcript: the toast is capped
  at roughly three lines.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No toast at all | Settings → System → Notifications: notifications on, Focus Assist off, and the `dsh-turn-notify` entry allowed if it appears in the list |
| No toast, no log line | The plugin is not active: check the Plugins page and the startup log line |
| Toast but no sound | The sound switch, then the Windows volume mixer |
| Toast is missing the question text | The model called the tool without a readable question; the title still fires |
| Nothing on macOS/Linux | Expected: the plugin is Windows-only |
| Manual test | `powershell.exe -NoProfile -File notify.ps1 -Title "DSH · test" -Body "hello" -Sound` |

## Development

```powershell
npm ci
npm run check     # build (esbuild + declarations) and unit tests
npm pack          # the prebuilt tarball storefronts should offer
```

`lib/` is committed and must stay reproducible: CI regenerates it and fails on a
diff.

## License

MIT
