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

```bash
cp path/to/oh-my-handoff/plugin/session-handoff.ts ~/.config/opencode/plugins/
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

<session_handoff_config>
handoff_frequency: medium   # high | medium | low
</session_handoff_config>

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

### Handoff Trigger Conditions

The agent MUST check after each response whether a trigger condition is met:

| Level | Auto Trigger | Manual Trigger |
|---|---|---|
| high | 30 messages OR 1 DCP compression | User `/handoff` anytime |
| medium (default) | 50 messages OR 2 DCP compressions | User `/handoff` anytime |
| low | 80 messages OR 3 DCP compressions | User `/handoff` anytime |

### Handoff Flow

When a trigger condition is met, the agent suggests handoff. On user confirm:
1. Agent does FINAL REFRESH of all artifact sections
2. Set frontmatter `status: sealed`, increment `handoff_count`
3. Output handoff instructions

### New Session Bootstrap

When a new session starts, the agent MUST:
1. Check if `.sisyphus/session-handoff.md` exists
2. If YES: Read all sections and acknowledge to user
3. If NO: Treat as fresh session

### Session End

When session ends: set `status: sealed`, artifact remains for next session.
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
| Session compaction | `experimental.session.compacting` hook 自动写入 Chapter Index + 注入 artifact 上下文 | Plugin |
| 做出关键决策 | agent 追加到 Decision Log | 行为层 |
| 子代理 (task) 返回高价值产出 | agent 提取到 Subagent Outputs | 行为层 |
| Session 消息数或压缩频率超标 | agent 提示"建议 handoff" | 行为层 |
| 用户确认 handoff | agent 刷新 artifact → status sealed → 输出引导信息 | 行为层 |
| 新 session 启动 | agent 检测到 artifact → 读取全部状态 → 继续工作 | 行为层 |

### Handoff 触发阈值

| 等级 | 自动触发 | 手动触发 |
|---|---|---|---|
| high | 30 条消息 或 1 次 DCP compression | 用户 `/handoff-seal` 随时 |
| medium（默认）| 50 条消息 或 2 次 DCP compression | 用户 `/handoff-seal` 随时 |
| low | 80 条消息 或 3 次 DCP compression | 仅用户 `/handoff-seal` |

> OpenCode 内置了 `/handoff` 命令（生成 session 摘要），与本系统的 `/handoff-seal` 命令功能不同，互不冲突。

注意：上述表格中的 `/handoff` 指**在聊天框输入**的一条消息让 agent 识别并执行 handoff（由 AGENTS.md 行为规则处理）。安装了 `commands/handoff-seal.md` 后也可以用 `/handoff-seal` 斜杠命令实现相同效果，两者任选其一。

### Handoff 流程

```
当前 session 达到 N 条消息 (配置阈值 M)
  → Agent 提示: "当前 session 已达 N 条消息，建议 handoff。继续还是换新 session?"
  → 用户确认换:
    1. Agent 刷新 artifact 所有字段
    2. 设置 status: sealed，increment handoff_count
    3. 输出: "Handoff 完成。新 session 打开后 artifact 将被自动加载。"
  → 新 session 中:
    1. Agent 自动检测到 artifact 存在
    2. 读取全部 7 个 section
    3. 汇报: "从 session [xxx] 恢复，继续 [goal]"
    4. 零冷启动，直接继续
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
│   └── handoff-seal.md                 ← `/handoff-seal` 斜杠命令模板（手动复制到 OpenCode commands 目录，不冲突）
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