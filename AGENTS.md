# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

- **项目理解加速**：初始可以依赖项目下`package.json`文件理解项目类型，如果没有或无法理解退化成阅读其他文件。
- **Hydration 错误预防**：严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。


## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**

## 外部服务依赖

### 腾讯云智能切题服务（QuestionSplitOCR）
- **用途**: 替代原有 AI Vision 预检测，自动识别资料中的题目区域（统一标记为题干框）
- **API 文档**: https://cloud.tencent.com/document/product/866/115930
- **服务端点**: `ocr.tencentcloudapi.com`
- **接口**: `QuestionSplitOCR`（智能切题）
- **版本**: `2018-11-19`
- **代码位置**: `src/app/api/auto-detect-boxes/route.ts`
- **切题策略**: 方案C — 腾讯云切出的框统一标为 `'question'` 类型；答案在步骤2通过全局匹配或手动画框补充

### 环境变量配置 (.env.local)
```
TENCENT_SECRET_ID=你的腾讯云SecretId
TENCENT_SECRET_KEY=你的腾讯云SecretKey
```
- `.env.local` 已加入 `.gitignore`，不会提交到版本库
- 生产环境需在部署平台配置对应环境变量

## 项目本地 Skills

- 页面逻辑审核：当用户要求审核前端页面、原型页面、页面逻辑、字段文案、按钮状态、异常场景、测试关注点或生成决策问题时，必须先读取 `.ai/skills/01-page-logic-auditor/SKILL.md`，并按照该 skill 的输出格式执行。
- 需求注册表生成：当用户要求把已确认页面决策转换为需求注册表、结构化 PRD 数据、页面角标数据源、右侧 PRD 阅读面板数据源时，必须先读取 `.ai/skills/02-requirement-registry-writer/SKILL.md`，并同时读取 `.ai/skills/02-requirement-registry-writer/references/registry-field-spec.md`。
- 业务逻辑写作规范：生成需求注册表、页面逻辑角标、悬浮业务逻辑面板、右侧 PRD 阅读面板或 Markdown PRD 时，必须遵循 `.ai/skills/shared/logic-writing-spec.md` 中对“显示说明”和“操作说明”的分层写法；用户侧 PRD 默认不展示“无额外权限限制”等空兜底说明。
- 页面逻辑角标核对：当用户要求在页面组件、按钮、字段、文案旁添加需求数字角标、稳定锚点、点击悬浮业务逻辑面板，用于分批核对页面逻辑时，必须先读取 `.ai/skills/03-requirement-marker-reviewer/SKILL.md`。
- PRD 原型联动：当用户要求实现右侧 PRD 阅读面板、拖拽分栏、点击 PRD 需求定位页面对象、高亮组件、执行需求激活路径时，必须先读取 `.ai/skills/04-prd-prototype-integrator/SKILL.md`，并同时读取 `.ai/skills/04-prd-prototype-integrator/references/layout-and-activation.md`。
- 注册表生成 Markdown PRD：当用户要求基于已核对的需求注册表生成 Markdown PRD、页面级 PRD、供 AI 阅读的 PRD 文档时，必须先读取 `.ai/skills/05-registry-to-prd-generator/SKILL.md`，并同时读取 `.ai/skills/05-registry-to-prd-generator/references/prd-document-template.md`。
