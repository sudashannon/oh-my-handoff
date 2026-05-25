# Session Handoff System Design

> 自动 + 手动并行策略，融合 DCP、Structured Artifact、session 机制
> 参考: GSD (get-shit-done) `.planning/` 文件体系

---

## 1. 核心概念

### 问题
- LLM context window 有限，DCP 压缩只能延寿不能永生
- Session 终归要换，但新 session 是"凉启动"——不知道决策历史、不知道关键文件、不知道做到哪了

### 解法：三层语义

```
Layer 3: .sisyphus/session-handoff.md (结构化 artifact)
    └── 持久化、跨 session 存活、包含完整状态
Layer 2: DCP + Chapter Index (当前 session 保活 + 摘要沉淀)
    └── 压缩旧消息 + 每次压缩结果写入 artifact
Layer 1: OpenCode Session (实际对话 + 推理)
    └── 正常交互，agent 日常维护 artifact
```

---

## 2. Artifact 格式

路径: `{workspace}/.sisyphus/session-handoff.md`

```yaml
---
session_id: ses_xxx
parent_session: ses_prev_or_null
model: deepseek-v4-flash-free
created: 2026-05-22T10:00:00Z
status: active          # active | sealed | archived
goal: "当前 session 主线目标"
tags: [design, infra]
handoff_count: 3        # 第几次 handoff
---
```

### Decision Log

每次关键决策记一条。由 agent 在做出决策时自动追加。

```
| 时间 | 决策 | 上下文 | 替代方案 | 理由 |
|---|---|---|---|---|
| 10:00 | 选用 Structured Artifact | 需跨 session 连续性 | 全量DCP/人工 | 自动结构化 |
```

### Key Artifacts

记录 session 中创建或修改的重要文件。

```
| 文件 | 用途 | 状态 |
|---|---|---|
| src/auth/jwt.ts | JWT 验证中间件 | created |
| docs/api.md | API 文档 | modified |
```

### Subagent Outputs (高价值)

只记录高价值 agent 产出（explore, oracle, brainstorm 等）。

```
| Agent | Task | Key Finding | Timestamp |
|---|---|---|---|
| oracle | 架构评审 | 推荐使用 Strategy Pattern 替代 if-else 链 | 10:15 |
| explore | DCP 存储结构 | 数据在 storage/plugin/dcp/ 下按 session 分文件 | 10:20 |
```

### Design Outputs

brainstorming 技能的设计产出记录。

```
| Skill | Output | Path |
|---|---|---|
| brainstorming | Session Handoff 设计 | .sisyphus/specs/session-handoff-design.md |
```

### DCP Chapter Index

DCP 每次压缩执行后，自动写入一条索引 + 摘要。

```
| # | Range | Topic | Summary | DCP Summary |
|---|---|---|---|---|
| 1 | msg 1-10 | 仓库分析 | 分析了 awesome-design-md 的价值 | [DCP 压缩原文摘要] |
| 2 | msg 11-20 | 上下文机制 | fork/subagent/session 模型对比 | [DCP 压缩原文摘要] |
| 3 | msg 21-35 | Handoff 设计 | 三层架构设计讨论 | [DCP 压缩原文摘要] |
```

支持通过 `session_read(session_id=ses_xxx, limit=10)` 回溯原始消息。

### Current State

实时快照，从 `todowrite` 同步。

```
- Active Goal: 设计 session handoff 策略
- Blockers: 等待设计审批
- Todo Snapshot:
  - [x] DCP 分析完成
  - [x] GSD 参考研究
  - [ ] 实现 artifact 自动维护
- Open Questions: 无
```

### Next Steps

```
1. 等待设计审批
2. 实现 artifact 自动维护 (agent 行为)
3. 实现 handoff 触发检测
```

---

## 3. 触发方式

上下文传递完全由用户手动触发。无自动触发。

### 两条手动命令

| 命令 | 效果 | 适用场景 |
|---|---|---|
| `/handoff-seal` | 密封 artifact，agent 输出 handoff 引导信息 | 准备结束当前 session，下个 session 继承 |

两个命令执行相同的底层操作：agent 填充 `goal`、刷新所有 sections、设 `status: sealed`。区别仅在于给用户的回复内容不同。

### Plugin 层的行为匹配

新 session 启动时 `initArtifact` 检查旧 artifact 的 `status`：

| status | 意思 | plugin 行为 |
|---|---|---|
| 不存在 | 首次使用 | 创建空白 artifact |
| `active` | 普通 `/new` 或上次 session 未密封 | 存档旧 artifact → 空白冷启动 |
| `sealed` | 用户手动运行了密封命令 | 存档旧 artifact → 继承上下文 |

### Known Sessions (防重复存档)

Plugin 自动记录所有见过的 sessionID 到 `.sisyphus/.known-sessions`：

| 场景 | 行为 |
|---|---|
| **新 sessionID + sealed** | 存档旧 artifact + 创建继承 artifact |
| **新 sessionID + active** | 存档旧 artifact + 创建空白 artifact |
| **已知 sessionID（切换回来）** | 跳过所有 artifact 操作，直接继续 |
| **并发 session（另一个进程持有锁）** | 创建独立 artifact，不碰主文件 |

---

## 4. 工作流

### 初始化

```
新 session 启动
  ├── 检测 {workspace}/.sisyphus/session-handoff.md
  ├── 存在 → Agent 读取文件，获得完整上下文
  │   ├── 读取 parent_session 回溯历史
  │   ├── 读取 Decision Log → 知道已有决策
  │   ├── 读取 Key Artifacts → 知道关键文件
  │   ├── 读取 DCP Chapter Index → 知道历史压缩摘要
  │   ├── 读取 Current State → 知道做到哪了
  │   └── 读取 Next Steps → 知道下一步
  └── 不存在 → 创建新模板
```

### 运行中 (Agent 自动维护)

```
Agent 每次执行关键操作后:
  ├── 做出决策 → 追加到 Decision Log
  ├── 创建/修改关键文件 → 更新 Key Artifacts
  ├── task(explore/oracle) 返回 → 提取关键发现到 Subagent Outputs
  ├── brainstorming 产出 → 记录到 Design Outputs
  ├── DCP 执行 compress → 记录到 Chapter Index
  └── todowrite 变化 → 同步到 Todo Snapshot
```

### Handoff 触发 (手动命令)

上下文传递只通过两条手动命令触发：

```
用户随时执行 /handoff-seal:
  ├── Agent 执行最终刷新 artifact
  │   ├── 填充 goal 字段
  │   ├── 更新所有 sections 为最新状态
  │   └── 将 status 从 active 改为 sealed
  ├── Agent 回复: "Handoff ready. Start a fresh OpenCode session..."
  └── 用户按引导操作:
      ├── 新 session 启动
      ├── Plugin 检测到 artifact status=sealed
      ├── Plugin 存档旧 artifact + 创建继承新 artifact
      ├── Agent 检测到 artifact 存在
      ├── Agent 读取全部状态
      └── 继续工作，零冷启动
```

Agent 不会主动检测或建议 handoff。只有用户觉得"上下文需要传递到下个 session"时，才执行手动命令。

### Session 封存

不自动封存。用户需要跨 session 传递时才手动执行密封命令。

```
Session 结束时:
  └── artifact 保留为 active 状态
      ├── 下次 /new → 冷启动（不继承）
      └── 下次手动命令密封 + 新 session → 继承
```

---

## 5. DCP 的具体角色

| 角色 | 说明 |
|---|---|
| **当前 session 的保活者** | 正常压缩旧消息，让 session 跑更久 |
| **Chapter Index 的输入源** | 每次 compress 调用 → 提取主题和摘要写入 artifact |
| **Handoff 后清零** | 新 session DCP 从头跟踪，artifact 提供上层连续性 |

DCP 负责 **当前 session 别撑爆**，artifact 负责 **换 session 别失忆**。

---

## 6. 与已有能力的衔接

| 能力 | 在本设计中的角色 |
|---|---|
| **AGENTS.md** | 注入 handoff 维护规则 (频率配置、行为约束) |
| **todowrite** | Todo Snapshot 快照源 |
| **DCP plugin** | Chapter Index 的输入源 (每次 compress 后回调) |
| **task() (openagent)** | Subagent Outputs 的输入源 (只记高价值 agent) |
| **brainstorming skill** | Design Outputs 的输入源 |
| **/refactor** | Key Artifacts 的文件变更记录源 |
| **session_read/search** | Chapter Index 的 Backlink 回溯入口 |
| **compress** | Agent 自身最终调用 DCP 压缩的入口 |
| **GSD `.planning/` 模式** | 同层级文件体系，但 GSD 没有 DCP 集成 |

---

## 7. 与 GSD 的对比

| Aspect | GSD | 本设计 |
|---|---|---|
| 状态位置 | `.planning/*.md` | `.sisyphus/session-handoff.md` |
| Handoff 触发 | 纯手动 (`/gsd:pause-work`) | 手动命令 (`/handoff-seal`)
| Context 压缩 | 无 (依赖 fresh subagent) | DCP + Chapter Index 双保险 |
| DCP 集成 | 无 | Chapter Index 捕获压缩摘要 |
| Subagent 产出 | `.planning/phases/*/RESEARCH.md` | Decision Log + Subagent Outputs |
| Brainstorming 产出 | `.planning/phases/*/CONTEXT.md` | Design Outputs |
| Session 元数据 | 无 | session_id, parent_session, model, handoff_count |
| 适用范围 | GSD 工作流内 | 通用，不依赖特定工作流 |
