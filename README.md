# oh-my-handoff

> OpenCode session handoff 系统 — 三层架构：Hook 层 + 行为层 + 持久化 Artifact

在 LLM context window 有限的约束下，实现跨 session 的无缝上下文延续。解决"换 session 就失忆"的问题。

---

## 问题

OpenCode 的 LLM session 有 context window 上限（128K-200K tokens）。DCP (Dynamic Context Pruning) 通过压缩旧消息来延长单 session 寿命，但：

- 压缩只能延寿不能永生
- 换新 session 等于冷启动——不知道决策历史、不知道关键文件、不知道做到哪了

**oh-my-handoff** 提供了从 session 到 session 的结构化上下文传递机制。

---

## 架构

```
┌─────────────────────────────────────────────────┐
│  Layer 3: .sisyphus/session-handoff.md           │  持久化 artifact
│  (结构化 artifact，跨 session 存活，完整状态)      │  行为层维护
├─────────────────────────────────────────────────┤
│  Layer 2: DCP Chapter Index                      │  Hook 层自动记录
│  (每次压缩自动记录摘要到 artifact)                 │
├─────────────────────────────────────────────────┤
│  Layer 1: OpenCode Session                       │  日常交互
│  (正常对话 + agent 根据 AGENTS.md 维护 artifact)   │
└─────────────────────────────────────────────────┘
```

### 两层驱动

| 层 | 确定性 | 文件 | 职责 |
|---|---|---|---|
| **Hook 层** (Plugin) | ✅ 每次必执行 | `plugin/session-handoff.ts` | 消息计数、Chapter Index 自动记录、context 压力监控 |
| **行为层** (AGENTS.md) | ❌ 依赖 agent 遵守 | `AGENTS.md` 中的行为规则 | 判断决策价值、提取 subagent 产出、handoff 时机判断 |

### Artifact 结构

`.sisyphus/session-handoff.md` 包含：

```yaml
---
session_id: "ses_xxx"
parent_session: "ses_prev_or_null"
model: "deepseek-v4-flash-free"
status: active          # active | sealed | archived
goal: "当前 session 主线目标"
handoff_count: 3        # 第几次 handoff
---
```

7 个 section：Decision Log / Key Artifacts / Subagent Outputs / Design Outputs / DCP Chapter Index / Current State / Next Steps

---

## 安装

### 前置条件

- [OpenCode](https://opencode.ai) >= 1.15.6
- OpenCode DCP plugin（`@tarquinen/opencode-dcp@latest`）— 用于自动压缩

### 步骤 1: 安装 Plugin（Hook 层）

插件启动时会**自动创建** `.sisyphus/session-handoff.md`，无需手动复制模板。

> ⚠️ 新版本插件采用模块化结构，`session-handoff.ts` 依赖 `lib/` 下的 4 个辅助文件（template/parse/io/lock），必须复制整个 `plugin/` 目录。

```bash
cp -r path/to/oh-my-handoff/plugin ~/.config/opencode/plugins/
# 结果: ~/.config/opencode/plugins/session-handoff.ts + lib/{template,parse,io,lock}.ts
```

编辑 `~/.config/opencode/opencode.jsonc`，在 `plugin` 数组中添加：

```jsonc
{
  "plugin": [
    "oh-my-openagent@latest",
    "superpowers@git+https://github.com/obra/superpowers.git",
    "@tarquinen/opencode-dcp@latest",
    "file:///home/<你的用户名>/.config/opencode/plugins/session-handoff.ts"
  ]
}
```

### 步骤 2: 添加 AGENTS.md 行为规则

将以下内容追加到项目 `AGENTS.md` 或 `~/.config/opencode/AGENTS.md` 末尾：

```markdown
<!-- SESSION_HANDOFF_START -->
## Session Handoff System

### Artifact

Path: `{workspace}/.sisyphus/session-handoff.md`

When present, the agent MUST read this file at session start to recover full context.

### Maintenance Rules

The agent MUST update the artifact when:

1. **Decision made** → Append row to `Decision Log`
2. **Key file created/modified** → Update `Key Artifacts`
3. **High-value subagent completes** → Extract findings to `Subagent Outputs`
   - High-value agents: `oracle`, `explore`, `brainstorming`, `deep`, `ultrabrain`
4. **brainstorming finishes** → Record in `Design Outputs`
5. **compress is called** → Before calling compress, record summary in `DCP Chapter Index`
6. **todowrite changes** → Sync current todo state to `Current State` > `Todo Snapshot`

### New Session Bootstrap

Artifact status determines whether the new session inherits context:

| Artifact status | What happened | Plugin behavior |
|---|---|---|
| no artifact | First session in workspace | Creates blank artifact |
| `status: sealed` | Previous session was sealed by `/handoff-seal` or `/new-with-history` | Archives old artifact, creates new one with inherited sections |
| `status: active` | Previous session was `/new` or ended normally | Archives old artifact, creates **blank** artifact (no inheritance) |

When the artifact exists, the agent MUST read all sections and acknowledge to the user.

When resuming a previously-seen sessionID (known-sessions), the plugin skips artifact operations — the artifact was already populated for this session.

### Session End

No automatic action. User manually invokes `/handoff-seal` or `/new-with-history` to seal the artifact and prepare for context inheritance in the next session.
<!-- SESSION_HANDOFF_END -->
```

完整内容参考 [`plans/2026-05-22-session-handoff.md`](plans/2026-05-22-session-handoff.md) 的 Task 2。

### 步骤 3: 安装 `/handoff-seal` 斜杠命令（可选但推荐）

> ⚠️ OpenCode 自带内置的 `/handoff` 命令（创建 session 摘要）。为了避免冲突，oh-my-handoff 使用 `/handoff-seal` 作为自定义命令名。

`/handoff-seal` 让用户随时手动触发 handoff 终结流程：agent 会推断并填充 `goal` 字段、刷新 artifact 所有 sections、并把 `status` 设为 `sealed`。

复制命令文件到全局命令目录（适用于所有项目）：

```bash
mkdir -p ~/.config/opencode/commands
cp path/to/oh-my-handoff/commands/handoff-seal.md ~/.config/opencode/commands/
```

或仅对当前项目生效：

```bash
mkdir -p .opencode/commands
cp path/to/oh-my-handoff/commands/handoff-seal.md .opencode/commands/
```

### 步骤 4: 重启 OpenCode

```bash
# 关掉重开
opencode
```

检查日志确认无报错：

```bash
grep "session-handoff" ~/.local/share/opencode/log/$(ls -t ~/.local/share/opencode/log/ | head -1)
```

预期输出：`INFO ... service=plugin path=file:///...session-handoff.ts loading plugin`

---

## 使用

### 日常自动行为

安装完成后，系统**自动运行**，无需人工干预：

| 时机 | 发生什么 | 谁负责 |
|---|---|---|
| 每次新消息 | `chat.message` hook 计数 +1 | Plugin |
| 全新 session 启动 | `initArtifact` 检查旧 artifact status → sealed 则继承，active 则冷启动空白 artifact | Plugin |
| Session 恢复（已知 ID） | Plugin 跳过 artifact 操作，直接继续 | Plugin |
| 并发 session 启动 | Plugin 创建独立 artifact，不修改主 artifact | Plugin |
| Session compaction | `experimental.session.compacting` hook 自动写入 Chapter Index + 注入 artifact 上下文 | Plugin |
| 做出关键决策 | agent 追加到 Decision Log | 行为层 |
| 子代理 (task) 返回高价值产出 | agent 提取到 Subagent Outputs | 行为层 |
| 新 session 启动 | agent 检测到 artifact → 读取全部状态 → 继续工作 | 行为层 |

> 💡 有两种手动命令触发上下文传递：
> - 使用 `/handoff-seal` → 密封 artifact，输出 handoff 引导信息
> - 使用 `/new-with-history` → 密封 artifact，引导用户用 `/new` 开继承 session

### Session 感知（Known Sessions）

Plugin 自动追踪所有见过的 sessionID 到 `.sisyphus/.known-sessions`，区分"全新 session"和"session 切换/恢复"：

| 场景 | Plugin 行为 |
|---|---|
| **全新 sessionID + artifact status: sealed** | 存档旧 artifact → 创建新 artifact **继承**所有 sections（手动命令生效） |
| **全新 sessionID + artifact status: active** | 存档旧 artifact → 创建**空白** artifact（`/new` 冷启动） |
| **已知 sessionID**（用户切回之前的 session） | 跳过 artifact 操作，直接继续。artifact 内容不变 |
| **并发 session**（另一个进程持有锁） | 创建独立 artifact `.sisyphus/session-handoff-standalone-<sid>.md` 独立运行 |

### `/new-with-history` 斜杠命令

与 `/handoff-seal` 类似，专用于"想开新 `/new` 但希望继承当前上下文"的场景：

1. 密封当前 artifact（填充 `goal`、设 `status: sealed`）
2. 刷新所有 sections（决策、文件、产出、状态、下一步）
3. Agent 回复："Artifact sealed. Type `\`/new` to start a fresh session that inherits all context..."

**安装方式**（同 `/handoff-seal`）：

```bash
cp path/to/oh-my-handoff/commands/new-with-history.md ~/.config/opencode/commands/
```

### 验证安装

```bash
# 1. 检查 msg-counter 是否在增长 (chat.message hook)
cat .sisyphus/.msg-counter

# 2. 检查 artifact 是否存在
ls -la .sisyphus/session-handoff.md

# 3. 检查 plugin 日志
grep "session-handoff" ~/.local/share/opencode/log/$(ls -t ~/.local/share/opencode/log/ | head -1)
```

---

## 目录结构

```
oh-my-handoff/
├── README.md                          ← 本文件
├── LICENSE                            ← MIT
├── plugin/
│   ├── session-handoff.ts             ← OpenCode Plugin（Hook 层实现）
│   ├── lib/                           ← 共享纯函数（template / parse / io / lock）
│   └── __tests__/                     ← Vitest 单元测试
├── commands/
│   ├── handoff-seal.md                 ← `/handoff-seal` 斜杠命令模板
│   └── new-with-history.md             ← `/new-with-history` 斜杠命令模板
├── examples/
│   └── handoff-example.md             ← 真实 handoff artifact 示例（仅参考，运行时由插件自动生成）
├── specs/
│   └── session-handoff-design.md      ← 完整设计文档
└── plans/
    └── 2026-05-22-session-handoff.md  ← 实现计划（6 个 Task）
```

---

## 设计参考

- **DCP (Dynamic Context Pruning)** — OpenCode 的上下文压缩机制，作为当前 session 的保活手段
- **GSD (get-shit-done)** — 参考其 `.planning/` 文件体系 + `continue-here.md` handoff 模式
- **OpenCode Plugin API** — 使用 `experimental.session.compacting` / `tool.execute.after` / `chat.message` hooks

更多设计细节见 [`specs/session-handoff-design.md`](specs/session-handoff-design.md)。

---

## License

[MIT](LICENSE)