# dsh-turn-notify

DSH（DeepSeek Harness）轮次完成通知插件：在**目标阻塞、对话中断、轮次完成**等需要用户下达新指令的时刻，向操作系统发送 Windows 通知（Toast / 托盘气泡）。

## 状态

> 🧪 **试点中**：当前在 `P:\dshTest\dsh-turn-notify` 开发验证，功能稳定后迁移至 `~/.dsh` 全局配置；若效果良好，将发布至 GitHub。

## 功能

- 监听 DSH 会话事件（`session/event`），在以下时机弹出系统通知：
  - 轮次完成（`turn/end: completed`，仅用户直接发起的轮次）
  - 目标阻塞 / 暂停 / 完成（`goal/change` 状态转变）
  - 对话中断 / 中止（`turn/end: aborted`）
  - 轮次出错 / 达到输出上限（`turn/end: error / max-tokens`）
  - 等待批准（`approval/asked`）
- 只通知根会话，子代理会话静默
- 冷却去抖：普通完成 10s 限频，关键事件不限
- 通知失败自动降级：WinRT Toast → 托盘气泡 → 日志

## 目录结构

```
dsh-turn-notify/
├── plugin/                  # 插件本体（纯 ESM，无构建步骤）
│   ├── index.mjs            # Cordis 插件：事件监听 + 决策器 + 通知调度
│   ├── notify.ps1           # Windows 通知脚本（WinRT Toast + 气泡回退）
│   ├── test.mjs             # node:test 单元测试（决策逻辑）
│   └── smoke.ps1            # 手动冒烟脚本
└── docs/superpowers/specs/  # 设计文档
```

## 环境要求

- Windows 10/11
- DSH（DeepSeek Harness），利用其 cordis 补丁机制（`cordis.patch.yml`）

## 接入方式（试点）

（待设计定稿后填写）
