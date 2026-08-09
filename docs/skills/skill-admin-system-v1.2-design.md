# BloomAI Skills Management Console v1.2 设计规格

> **设计名称：** BloomAI Skills Management Console
> **版本：** v1.2
> **日期：** 2026-08-06
> **状态：** 设计完成，可进入实现评审
> **基线页面：** `docs/skills/ui/skill-management-console-v1.1.html`
> **交付原型：** `docs/skills/ui/skill-management-console-v1.2.html`

## 1. 版本目标

v1.2 是基于 v1.1 独立 HTML 原型的视觉与交互细化版本，不改变原有页面的信息架构和现行 Package Runtime 演示数据模型，重点解决三个问题：

1. **与当前 BloomAI 主应用的视觉语言保持一致**：使用当前 renderer 的暖灰、白色、品牌紫蓝渐变，以及统一的 info / success / warning / danger 语义色。
2. **状态信息更容易扫描**：状态同时使用颜色、图标和文字表达，避免只依赖颜色；运行、审批、草稿、失败、隔离和禁用等状态在列表、详情、通知和 Toast 中保持一致。
3. **保留原型的可演示性**：继续支持双击打开、无构建依赖、无网络依赖；保留 v1.1 中的导航切换、搜索、筛选、详情、运行、权限、Artifact 和设置交互。

### 1.1 设计原则

- **Neutral first**：大部分界面使用暖灰和白色，品牌渐变只用于品牌标识、主操作和少量强调。
- **Semantic, not decorative**：颜色只承担状态语义，不用大面积高饱和色填充内容区域。
- **Icon + label**：状态图标必须与文字同时出现，图标不能单独承担关键含义。
- **Dense but calm**：列表、指标和控制面板保持高信息密度，但通过 0.5px 边框、6–10px 圆角和充足留白避免拥挤。
- **Safe by default**：危险操作采用 danger 色、明确动作名和二次确认；导入与执行继续保持分离。

## 2. 页面与信息架构

v1.2 沿用原 HTML 的九个可切换视图：

| 视图 | 导航名称 | 页面职责 | 主要状态 |
|---|---|---|---|
| `center` | Skills Center | Skill Catalog、指标、最近运行、待处理事项 | enabled、draft、disabled、quarantined |
| `import` | 导入 Skill | GitHub、本地目录、ZIP、npx 产物导入 | scanning、validated、warning、rejected |
| `creator` | Skills Creator | 创建 Draft、选择 Runtime 与 Capability、实时预览 | draft、ready、needs-review |
| `detail` | Skill 详情 | Package、Version、文件树、能力、运行历史 | installed、update、rollback |
| `permissions` | 权限与安装 | Installation、Capability Grant、审批队列 | active、pending、revoked |
| `runs` | 运行记录 | 全部 Run 查询和筛选 | running、waiting、succeeded、failed |
| `run-detail` | Run 详情 | Timeline、Run Context、Capabilities、Artifacts | queued、running、completed、cancelled |
| `artifacts` | Artifacts | 产物浏览、预览、来源追溯和下载 | ready、processing、orphaned |
| `settings` | 系统设置 | Runtime、导入、安全、Artifact 和 Feature Flags | healthy、degraded、disabled |

### 2.1 对象关系

```text
Skill Package
  └── Skill Version
        └── Installation
              ├── Run
              │    ├── Event / Timeline
              │    ├── Capability Grant
              │    └── Artifact
              └── Audit / Activity
```

详情入口必须保留上下文链路：

```text
Skill Center → Skill Detail → Run Detail → Artifact / Capability
```

## 3. BloomAI 当前配色映射

颜色取自当前 BloomAI renderer 的设计 token；独立 HTML 使用等价的本地变量名，避免原型脱离主应用视觉系统。

### 3.1 基础颜色

| 语义 | BloomAI token | v1.2 值 | 使用位置 |
|---|---|---|---|
| 主背景 | `--bg-secondary` | `#F5F5F4` | 页面背景、侧边导航背景 |
| 主表面 | `--bg-primary` | `#FFFFFF` | Panel、按钮、输入框、卡片 |
| 次级表面 | `--bg-tertiary` | `#EEEDE9` | Hover、禁用、分组背景 |
| 主文字 | `--text-primary` | `#1A1A18` | 标题、正文、关键数据 |
| 次文字 | `--text-secondary` | `#3D3D3A` | 辅助标题、导航文字、表格内容 |
| 弱文字 | `--text-tertiary` | `#73726C` | 元数据、说明、时间、占位符 |
| 主边框 | `--border-tertiary` | `#DDDBD6` | 卡片、分隔线、输入框 |
| 强边框 | `--border-secondary` | `#B8B5AE` | Focus、强调边界、拖拽区域 |

### 3.2 品牌颜色

| 语义 | 值 | 使用位置 |
|---|---|---|
| Brand Purple | `#7C6FF7` | BloomAI 标识渐变起点、Creator 强调 |
| Brand Blue | `#4B9BF5` | BloomAI 标识渐变终点、进度和视觉辅助 |
| Brand Gradient | `linear-gradient(135deg, #7C6FF7, #4B9BF5)` | Brand mark、用户头像、主按钮 |
| Purple Action | `#534AB7` | Creator / 特殊功能标签、当前导航 icon |

品牌渐变只用于可识别的品牌点和主要 CTA；普通状态不使用品牌渐变，避免用户将“品牌强调”误认为“成功状态”。

## 4. 状态颜色与状态图标

### 4.1 统一状态矩阵

| 状态类别 | 颜色 token | 背景 | 图标 | 示例文案 |
|---|---|---|---|---|
| Success / Active | `#085041` | `#EDF7F2` | `check` | 已启用、Healthy、已安装、成功 |
| Info / Running | `#0C447C` | `#EFF5FC` | `play` / `activity` | 运行中、扫描中、更新可用 |
| Warning / Pending | `#633806` | `#FEF5E8` | `clock` / `lock` | 草稿、等待审批、需确认 |
| Danger / Failed | `#7A1B1B` | `#FCEBEB` | `info` | 失败、隔离、拒绝、越权风险 |
| Neutral / Disabled | `#73726C` | `#EEEDE9` | `pause` | 已禁用、取消、只读 |
| Brand / Creator | `#534AB7` | `#F2F0FF` | `spark` / `wand` | Creator、模板、特殊能力 |

### 4.2 规则

- 状态 Badge 使用 **图标 + 文字 + 背景色**，不能只显示色点。
- `running` 使用播放图标；`waiting_approval` 使用时钟或锁图标；`succeeded` / `enabled` 使用勾选图标；`failed` / `quarantined` 使用信息警告图标；`disabled` / `cancelled` 使用暂停图标。
- 高风险操作的按钮使用 danger 语义，但不要使用红色作为普通链接、选中态或装饰色。
- 颜色对比度不足时优先加深文字，不通过提高背景饱和度解决。
- 所有状态必须能在灰度或色觉差异下通过文字和图标被识别。

## 5. 图标系统

### 5.1 视觉规范

- 使用线性图标，默认 `stroke-width: 1.8`，完成勾选类图标可使用 `2`。
- 导航图标为 17×17px；按钮图标为 15–16px；状态 Badge 图标为 12px；指标图标为 30×30px 容器。
- 图标颜色继承当前语义文字色，不单独引入新的彩色图标。
- 图标只表达动作、对象或状态，不替代按钮文本和表格标题。

### 5.2 图标语义表

| 图标 | 语义 | 使用位置 |
|---|---|---|
| `grid` | Skill 集合 / Catalog | Skills Center |
| `wand` | 创建 / Creator | 创建 Skill、Creator 导航 |
| `download` / `upload` | 导入 / 导出 | Import、Artifact、Audit |
| `package` | Package / Version | Skill 详情、版本 |
| `shield` | 安全 / Capability | 权限、导入检查、策略提示 |
| `activity` | 运行活动 / 指标 | Runs、Worker、指标 |
| `file` / `fileText` | Artifact / 文档 | Artifact、文件树 |
| `settings` | 系统设置 | Settings |
| `check` | 成功 / 已完成 / 健康 | Success、Active、Validated |
| `play` | 执行中 / 开始 Run | Running、Start Run |
| `clock` | 等待 / 延迟 / 待处理 | Pending、Approval、Queue |
| `pause` | 禁用 / 取消 / 暂停 | Disabled、Cancelled |
| `info` | 失败 / 风险 / 详情 | Failed、Quarantine、Notice |
| `lock` | 审批 / 锁定范围 | Capability Grant、Approval |
| `refresh` | 重试 / 更新 / 刷新 | Run、Skill Update、Artifact |
| `eye` | 查看详情 / 预览 | 详情、预览、Skills Center 行操作 |
| `play` / `pause` | 启用或禁用 Skill | Skills Center 行操作，随当前状态动态切换 |
| `edit` | 创建新版本 | Skills Center 行操作 |
| `stop` | 卸载 Installation | Skills Center 行操作，危险动作 |

## 6. 布局与响应式

### 6.1 桌面端

- App shell 使用两列布局：左侧导航 240px，右侧主内容自适应。
- 顶部上下文栏高度 68px，包含面包屑、Runtime 状态、Worker 数量、全局搜索、通知、帮助和当前用户。
- 内容区默认左右 padding 30px、底部 padding 42px；页面标题与操作区采用两列对齐。
- Panel 使用白色表面、0.5–1px 暖灰边框、6–10px 圆角和轻量阴影。
- 表格保持可水平滚动，信息列不通过强制换行破坏扫描节奏。

### 6.2 平板和移动端

- 1120px 以下隐藏次要的 `2 Workers` 上下文信息，保留 Runtime 健康状态。
- 860px 以下侧边导航收起为移动菜单，主内容使用 18px / 14px 页面 padding。
- 双列和三列工作台降为单列；指标降为两列；表格保留横向滚动。
- 移动端操作按钮左对齐，主操作保持可见；Skill Catalog 保留可横向滚动的四个内联操作图标，不折叠为三点菜单。其他页面的低频操作可根据具体上下文使用更多菜单。

## 7. 组件规格

### 7.1 Brand 与导航

- Brand mark 使用 BloomAI 当前紫蓝渐变，字母 `B` 使用白色粗体。
- Active nav 使用白色表面、暖灰边框和左侧 3px 紫色指示条。
- Nav count 使用白底、暖灰边框和次文字，不使用高饱和背景。
- Workbench switcher 使用白色卡片，底部固定；头像继续使用品牌渐变。

### 7.2 顶部上下文栏

顶部必须可快速回答“当前在哪里、Runtime 是否健康、谁在操作”：

- `Control Plane / 当前视图` 面包屑；
- `Runtime Healthy` 绿色状态胶囊，带 `check` 图标；
- `2 Workers` 中性上下文胶囊，带 `activity` 图标；
- 全局搜索框；
- 通知、帮助和用户头像。

### 7.3 Button

| 类型 | 外观 | 典型用途 |
|---|---|---|
| Primary | 品牌紫蓝渐变、白字 | 导入 Skill、确认主流程、开始扫描 |
| Soft | info 浅蓝背景、蓝字 | 创建 Skill、查看更新、辅助动作 |
| Default | 白底、暖灰边框 | 刷新、查看全部、取消 |
| Warning | warning 浅橙背景、深橙字 | 审批、确认风险 |
| Danger | danger 浅红背景、深红字 | 取消 Run、撤销、卸载 |
| Ghost | 透明背景 | 返回、轻量导航 |

所有 icon-only 按钮必须有 `aria-label`、`title` 和可读的 hover/focus 文字反馈。Skills Center 的表格行不使用三点入口；Actions 列固定直接展示四个图标，顺序为：查看详情、启用/禁用、创建新版本、卸载 Installation。卸载图标使用 danger 语义，普通操作保持中性 hover。

### 7.4 Metric Card

- 使用白色背景和暖灰边框；
- 数值使用主文字，大字号；
- 左侧或顶部显示 label；
- 右上角使用语义色图标容器；
- 趋势文字使用 success 或 warning，但不能只用颜色表达趋势。

### 7.5 Status Badge

```html
<span class="badge teal">
  <span class="badge-icon">check icon</span>
  已启用
</span>
```

Badge 高度约 24px，圆角 999px，内边距 4px 8px，文字 11px、700 weight。v1.2 中 Skill 表格、Run 列表、Run 详情和设置健康状态统一使用同一套语义色。

### 7.6 Notice / Callout

- `blue`：信息、可用更新、当前环境；
- `amber`：等待审批、风险提示、需要人工确认；
- `red`：失败、隔离、权限拒绝；
- Notice 左侧必须有 icon，正文包含标题和补充解释。

### 7.7 Modal、Toast 与长任务

- Modal 标题必须是用户能理解的动作或对象名称，例如“批准 Capability”而非“Confirm”。Skill Catalog 的常规行操作不通过“Skill 操作”菜单 Modal 承载；卸载等危险动作可以使用只针对该动作的确认 Modal。
- Toast 保留图标、标题和说明；成功使用 check，警告使用 clock/info，错误使用 info。
- 长任务用持久化状态表达，不能只通过一次性 Toast 表示；Run 列表和详情都要能看到当前状态。

## 8. 页面级设计规格

### 8.1 Skills Center

- 顶部展示 `全部 Skills`、`已启用`、`本周 Runs`、`待处理事项` 四个指标。
- KPI 下方放置“状态语言”图例，帮助用户理解状态色和图标。
- Skill Catalog 支持搜索、排序、Tabs、状态筛选和行操作。
- Actions 列在每个 Skill 行直接显示四个图标：查看详情、启用/禁用、创建新版本、卸载 Installation；鼠标悬停或键盘 Focus 时显示对应文字说明。
- 表格字段：Skill、Version、Status、Risk、Capabilities、Actions。
- 最近运行列表复用 Run 状态 Badge；需要关注卡片使用 shield、refresh、info 三类图标。

### 8.2 导入 Skill

- 使用 3 步 Stepper：选择来源 → 解析和扫描 → 确认安装。
- GitHub、本地目录、ZIP、npx 产物使用对象图标区分。
- 导入检查中展示成功、警告和风险项；导入阶段不直接执行 Skill。
- 中风险使用 amber；高风险或隔离使用 red；通过校验使用 teal。

### 8.3 Skills Creator

- 左侧为字段与 Capability 选择，右侧为 SKILL.md 预览。
- Creator 相关的品牌强调使用 purple / brand gradient，不与 Success 色混用。
- `workspace_write`、`command` 等高风险能力必须有 amber / red 说明和审批提示。

### 8.4 Skill 详情

- Hero 区显示 Skill logo、名称、描述、版本、来源、风险和主要操作。
- Detail Tabs 包含 Overview、Files、Capabilities、Runs、History。
- 版本历史使用当前版本、已安装、可回滚等不同状态 Badge。
- “启动 Run”使用 primary；“禁用/卸载”使用 warning 或 danger，并进入二次确认。

### 8.5 权限与安装

- 安装关系、Capability Grant、Pending Approval 采用分组 Panel。
- Grant 状态：Active 使用 teal，Pending 使用 amber，Revoked 使用 red。
- 所有 scope 必须可读；审批操作展示 capability、范围、来源 Run 和有效期。

### 8.6 运行记录与 Run 详情

- Runs 表格突出 Run ID、Skill、Status、Duration、Artifacts。
- Run Detail 以 Hero + KPI + Execution Timeline + Run Context 的结构展示。
- `running` 需要 play/activity 图标，`waiting_approval` 需要 clock/lock 图标，失败使用 info 图标。
- Cancel / Retry / Export Events 分别使用 danger、primary、default 类型。

### 8.7 Artifacts

- Artifact 卡片使用文件类型 icon；图片、Markdown、PDF、JSON、ZIP 使用不同的中性背景辅助区分。
- 详情预览必须显示来源 Skill、Run ID、创建时间、大小和下载动作。
- 不把文件类型颜色误认为安全状态；安全状态仍然使用统一语义色。

### 8.8 系统设置

- 设置按 Runtime、导入和安全、Artifact、Feature Flags 分组。
- Runtime 健康卡片使用 Healthy / Warning / Disabled 状态矩阵。
- 高风险开关默认关闭；关闭状态使用 neutral，开启状态使用 teal，不使用品牌渐变表示开关开启。

## 9. 交互规则

1. 左侧导航切换视图时，当前项同步更新 active 状态和面包屑。
2. 全局搜索输入后进入 Skills Center，并保留搜索词。
3. Skills Center 的 Actions 列直接显示查看详情、启用/禁用、创建新版本和卸载 Installation 四个图标；普通操作在列表行直接执行或导航，卸载等危险动作只进入单动作确认，不再打开标题为“Skill 操作”的菜单弹窗。
4. Capability 审批完成后，回到原上下文并显示状态收敛结果。
5. 扫描、运行、导出等长任务保留当前状态；刷新或切换页面不应让用户误以为任务消失。
6. Toast 只做即时反馈，不能替代表格、Timeline 或详情中的持久状态。
7. 空状态必须提供下一步动作；错误状态必须提供重试或返回入口。
8. 所有 icon-only 操作具备可读的 `aria-label`；按钮和输入框支持键盘 Focus。

## 10. 可访问性要求

- 颜色和图标必须与文字同时展示；状态不能只依赖颜色。
- Focus ring 使用紫色半透明描边，至少 3px，和控件边界保持 2px 间距。
- 表格表头使用 `th`，图标按钮使用 `aria-label`，搜索框使用 `aria-label`。
- Modal 使用 `role="dialog"`、`aria-modal="true"` 和标题关联；Escape 可关闭。
- 交互控件的可点击区域不小于 29×29px；移动端主按钮保持足够的触控间距。
- 正文、表头、Badge 和辅助文字都必须在暖灰背景上保持可读对比度。

## 11. 独立 HTML 原型验收标准

文件：`docs/skills/ui/skill-management-console-v1.2.html`

- [x] 双击可打开，无构建依赖、无网络依赖。
- [x] 保留 v1.1 的 Skills Center、导入、Creator、详情、权限、Runs、Run Detail、Artifacts、Settings 视图。
- [x] 使用 BloomAI 当前暖灰、白色、品牌紫蓝渐变和语义状态色。
- [x] 顶部显示 Runtime Healthy 和 Worker 上下文状态。
- [x] Skills Center 增加状态语言图例。
- [x] Skill 与 Run 的主要状态同时显示颜色、图标和文字。
- [x] 主要操作、风险提示、Toast 和 Modal 延续原交互语义。
- [x] Skills Center 列表不再显示三点入口，每个 Skill 行直接显示四个操作图标。
- [x] 操作图标在 hover/focus 时显示查看详情、启用/禁用、创建新版本或卸载 Installation 的文字说明。
- [x] 卸载仅使用单动作确认，不打开“Skill 操作”菜单弹窗。
- [x] 在窄屏下隐藏次要上下文并保留核心操作与可滚动表格。
- [ ] 真实产品接入后，用 API 返回的状态和权限覆盖原型静态数据。

## 12. 交付文件与变更边界

本次交付只新增以下两个 v1.2 文件，不覆盖 v1.1 基线文件：

1. `docs/skills/skill-admin-system-v1.2-design.md`
2. `docs/skills/ui/skill-management-console-v1.2.html`

v1.2 HTML 继续使用单文件内联 CSS、SVG 图标和 JavaScript 交互，适合产品评审、视觉走查和后续拆分为 React 组件。实现时应优先从本设计文档中的 token、状态矩阵和组件规格抽取共享变量，避免页面继续出现局部硬编码颜色。
