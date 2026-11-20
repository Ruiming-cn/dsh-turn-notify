# Changelog

## 1.0.0 — 2026-11-20

Rewritten from the 2026-08 prototype. The prototype compiled its own notifier
executable, asked for a Start-menu shortcut, and carried eleven independent
switches; this release keeps the two things people actually wanted and drops
the rest.

### Added

- **Live switches in the GUI** — Settings → Turn notifications, four switches:
  when I am needed, when a turn completes, when a turn ends badly, play a sound.
  Each one is read at send time, so a change applies to the next notification
  without restarting anything.
- Toast text previews: the first question, the approval's tool and reason, and a
  short answer preview for completed turns.
- `notify.ps1` falls back to a tray balloon when the WinRT toast throws.

### Changed

- One listener on the durable `session/event` feed replaces the prototype's
  event mix: approvals and questions come from `approval/asked` and the two
  blocking tool calls (`ask_user_question`, `exit_plan_mode`); turn endings from
  `turn/end`. No `agent/error` listener, no goal notifications.
- Notification language follows the Windows display language instead of a
  configuration key.
- The toast is sent under the app id `dsh-turn-notify` with no executable and no
  shortcut registration step.

### Removed

- The compiled `dsh-notify.exe` and its `csc` build instructions.
- The start-menu shortcut / AppUserModelID registration step.
- The serial notification queue, the per-session cooldown, the merge window and
  the `dryRun` / `maxSessions` / `titlePrefix` / `previewChars` tuning keys.
- `docs/superpowers/` design and plan documents; the code and the README are
  the design now.

### Kept from the prototype

- Subagent sessions stay silent.
- A turn only announces completion when a direct human prompt started it.
- Turn problems are announced regardless of who started the turn.
- Duplicate notices of one kind for one session within two seconds collapse.
