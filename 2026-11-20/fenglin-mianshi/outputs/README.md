# 丰麟云面 · Fenglin Cloud Interview

面向大学生的求职陪练 Web 应用，参赛赛道：**TRAE 大学生大赛 · 校园生活（造个校园新体验）**。

它把「简历优化 → JD 匹配 → 从简历生成面试追问 → 模拟面试 → 复盘沉淀 → 题库再练」串成一条闭环，解决两个具体问题：简历和目标岗位对不上、面试缺乏针对自己简历的练习。

- **在线体验（公开，无需登录）**：https://37kt7qk05rsihxps0fr.traesite.cn
- 代码目录：`e:\Trae\fenglin-cloud-interview\app`
- 说明与素材：`e:\Trae\fenglin-cloud-interview\2026-11-20\fenglin-mianshi\`
  - `work/`：设计过程、截图、测试脚本与日志
  - `outputs/`：README、部署说明、演示脚本、截图清单、Session ID 说明

> 公网实例是无状态的演示环境：**所有访客共享一份数据，实例重启/重新部署后数据清空**，页面顶部与隐私页都有明确提示。本地运行时数据是持久的。

---

## 一、功能地图（模块 0–4 全部可用，无空壳页）

| 模块 | 入口 | 已实现能力 |
|---|---|---|
| 0 新手入口 / 模板库 | `/templates`、`/templates/:id` | 4 套岗位模板（技术研发 / 产品经理 / 运营 / 数据分析），每套 6 个板块；逐项填写引导、正反例对照、实时预览、AI 润色、Markdown/文本导入；生成初版简历后一键带入优化 |
| 1 简历优化助手 | `/optimize` | 粘贴简历 + 选目标岗位；按板块逐条建议并说明「为什么改」（措辞 / 量化 / 结构顺序 / 冗余删减）；粘贴 JD 得匹配度评分 + 缺失关键词 + 已覆盖项对照表（已覆盖 / 部分覆盖 / 缺失）；多轮对话迭代 + 修改前后行级高亮 diff；导出 Markdown / Word（docx），打印视图存 PDF |
| 2 模拟面试 | `/interviews`、`/interviews/:id/session` | 从简历与目标岗位生成追问；四轮推进（自我介绍 → 专业 → 行为 → 反问）；结构 / 内容 / 表达三维反馈与改进示例；追问最多 2 层且限定项目细节、数据来源、个人贡献，分数达标即不追问；语音作答走浏览器 Web Speech API，不可用时自动降级为文字并提示；轮次进度 + 计时；结束生成报告（各轮得分、薄弱环节、建议复习点） |
| 3 复盘与个人题库 | `/reviews`、`/bank` | 复盘记录（问题 / 我的回答 / 实际表现 / 改进点 / 评分 / 标签）；一键从面试生成复盘草稿；题库按岗位与类型分类、支持抽题再练；薄弱项标记与复习清单；复盘导出 Markdown / Word，打印存 PDF |
| 4 账号与数据 | `/profile`、`/resumes`、`/jobs`、`/privacy` | 本地档案（不做注册登录）；多份简历 / 多个目标岗位管理；模块间数据打通（简历 → 面试题 → 复盘 → 题库 → 再练）；隐私说明如实写清模型外发范围、存储位置与限制 |

数据流转是真实打通的：面试题读取所选简历正文与目标岗位 JD；面试结束把题目写进题库；复盘从面试作答生成；题库勾选后可开启「题库练习」模式再练一轮。

---

## 二、技术架构

```
React 18 + TypeScript + Vite 6  ──/api──▶  Express 4（Node 20）
手写 CSS（纸感 + 朱批红，无 UI 库）          ├─ 智谱开放平台 glm-4-air（JSON 模式）
                                             └─ SQLite（sql.js / WASM）
生产：同一进程托管 dist/ 静态文件与 /api，单端口 8000
```

- **前端**：React Router 6 单页应用；设计 token 集中在 `src/styles.css`（纸色底、朱红批注、宋体标题）；桌面优先，1180 / 980 / 640 三档响应式，手机宽度无横向溢出。
- **后端**：Express + TypeScript，按 core / ai / interview / review 拆分路由；统一 `HttpError` 与错误中间件，异常不会让页面白屏。
- **数据层**：SQLite 表结构覆盖 `profile`、`job`、`resume`、`jd_analysis`、`interview`、`interview_turn`、`review`、`bank_item`、`setting`。公网运行时用 **sql.js（SQLite 的 WebAssembly 版）**，原因见部署说明；写入后 150ms 防抖落盘，先写临时文件再原子替换。
- **模型调用**：只走服务端 `ZHIPU_API_KEY`；请求 `response_format=json_object`；zod 校验 + 最多 3 次重试（把解析/结构错误回灌纠错）；单次超时 55 秒。
- **降级**：JD 匹配、面试出题、单题反馈、面试报告在模型不可用时切本地规则并标注「本地降级」；简历建议与多轮迭代没有可靠的本地等价物，返回 503 结构化错误由页面提示重试。

### 目录结构

```
app/
├─ src/                 前端
│  ├─ pages/            每个路由一个页面（共 14 个，含 404）
│  ├─ components/       Layout、ui 组件库、图标
│  ├─ lib/              markdown 渲染、行级 diff、语音、下载、格式化
│  ├─ api.ts            全部接口封装（含统一错误类型）
│  ├─ state.tsx         全局档案 / 简历 / 岗位上下文
│  └─ styles.css        全部样式与设计 token
├─ server/
│  ├─ index.ts          Express 入口、静态托管、错误处理
│  ├─ db.ts             SQLite（sql.js）持久层
│  ├─ llm.ts 智谱客户端（JSON 校验 + 重试 + 超时）
│  ├─ schemas.ts        zod 输出契约
│  ├─ prompts.ts  fallback.ts  templates.ts  interview-plan.ts
│  └─ routes/           core / ai / interview / review
├─ index.html  vite.config.ts  tsconfig*.json
└─ package.json  package-lock.json
```

---

## 三、启动方式（两种）

### 方式 A：开发模式（前后端一起起）

```bash
cd e:\Trae\fenglin-cloud-interview\app
npm install
copy .env.example .env        # Windows；macOS/Linux 用 cp
# 在 .env 里填 ZHIPU_API_KEY=你的智谱 Key
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:8787（Vite 已把 `/api` 代理到 8787）
- 数据库：`app/data/fenglin.sqlite`，**持久保存**

### 方式 B：生产模式（单进程）

```bash
cd e:\Trae\fenglin-cloud-interview\app
npm install
npm run build                 # 产出 dist/（前端）与 dist-server/（后端）
set NODE_ENV=production       # PowerShell: $env:NODE_ENV='production'
set PORT=8787
npm start                     # node dist-server/index.js
```

打开 http://localhost:8787 即可，静态文件与 API 同端口。生产模式默认把数据库写到 `%TMPDIR%\fenglin-cloud-interview\fenglin.sqlite`（可用 `DB_PATH` 覆盖），这是为无状态托管环境准备的；本地想持久化就显式设置 `DB_PATH`。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ZHIPU_API_KEY` | 是 | 智谱开放平台 Key，**只在服务端读取**，`.env` 已加入 `.gitignore` |
| `ZHIPU_MODEL` | 否 | 默认 `glm-4-air`（实测出题 1–7s、单题反馈 5–17s、建议与报告 8–30s；思考型模型会超时，故不选） |
| `PORT` | 否 | 默认 8787；公网部署由平台注入 8000 |
| `DB_PATH` | 否 | 覆盖数据库文件路径 |
| `STATIC_DIR` | 否 | 覆盖前端静态目录（一般不用） |
| `SHARED_DEMO` | 否 | 置 `1` 时页面顶部显示「公网演示实例」提示条 |

**密钥安全**：Key 只出现在服务端环境变量与本地 `.env`；前端打包产物、接口响应、日志中都不会出现（日志只打印长度与前缀）。已对线上 JS 产物做过字符串检查。

---

## 四、自测与证据

| 项目 | 结果 | 证据 |
|---|---|---|
| 端到端链路（模板 → 简历 → 建议 → JD → 面试 → 报告 → 复盘 → 题库 → 再练） | 通过，131s | `work/logs/e2e-chain.log` |
| 浏览器完整面试（7 题 + 报告 + 复盘 + 题库再练） | 通过，无运行时报错 | `work/scripts/flow2-interview.cjs`、`work/shots/flow-09…14` |
| 真实模型调用样例 | 建议 8 条（10.7s），JD 匹配 72 分 | `work/samples/m1-real-call.json` |
| 生产产物结构验证（dist/server + dist/node_modules，8000 端口） | 首页 / 深链 / 静态资源 / 写库均 200 | `work/logs/api.log` |

端到端自测可重跑：

```bash
npm run dev:server          # 终端 A
node work/scripts/e2e-chain.mjs   # 终端 B（脚本在 work/scripts）
```

---

## 五、已知限制（不粉饰）

1. **不做注册 / 登录**：托管平台没有持久化存储卷或外部数据库，账号与数据会在实例重启后消失，做出来是假承诺。公网实例所有访客共享一份数据，仅适合演示。
2. **公网数据是临时的**：`{TMPDIR}/fenglin-cloud-interview/fenglin.sqlite`，重启、重新部署或平台清理即清空。本地开发是持久的。
3. **导出说明**：Word（docx）由服务端用纯 JS 的 `docx` 库生成，表格输出为真正的 Word 表格；PDF 通过 A4 打印视图由浏览器「另存为 PDF」生成，没有引入 PDF 生成库。Word 与打印视图使用已保存的简历版本。
4. **不做 PDF / 图片简历解析**：只支持粘贴文本或导入 `.md` / `.txt`。
5. **语音作答依赖浏览器 Web Speech API**：Chrome 可能把音频交给浏览器厂商的识别服务（与应用无关）；不支持的浏览器自动降级为文字并提示。
6. **模型回复质量与耗时受网络影响**：出题 1–7 秒，单题反馈 5–17 秒，建议与报告 8–30 秒（单次上限 55 秒）；失败会提示重试或走本地降级，不会白屏。
