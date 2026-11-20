# 丰麟云面 · Fenglin Cloud Interview

面向大学生的求职陪练 Web 应用：把「简历优化 → JD 匹配 → 从简历生成面试追问 → 模拟面试 → 复盘沉淀 → 题库再练」串成一条闭环。

- 在线体验（公开，无需登录）：https://37kt7qk05rsihxps0fr.traesite.cn
- 参赛赛道：TRAE 大学生大赛 · 校园生活
- 代码目录：`app/`；交付文档：`2026-11-20/fenglin-mianshi/outputs/`

## 解决什么问题

1. **简历和目标岗位对不上**：按板块逐条给修改建议并说明「为什么改」，粘贴 JD 后给出匹配度、缺失关键词与覆盖对照表。
2. **面试缺乏针对自己简历的练习**：题目从你的简历与目标岗位生成，四轮推进、三维反馈、最多两层追问，结束出报告。
3. **面完就忘**：复盘与个人题库沉淀，可按岗位/类型筛选，标记薄弱项后再练。

## 功能一览

| 模块 | 入口 | 能力 |
|---|---|---|
| 0 模板库 | `/templates` | 4 套岗位模板（技术研发 / 产品经理 / 运营 / 数据分析）、逐项填写引导、正反例、实时预览、生成初版简历 |
| 1 简历优化 | `/optimize` | 逐条建议 + 修改理由、JD 匹配评分与覆盖对照、多轮对话迭代、行级 diff 对比、导出 Markdown |
| 2 模拟面试 | `/interviews` | 四轮推进（自我介绍 → 专业 → 行为 → 反问）、三维反馈与改进示例、追问最多 2 层、语音作答（不可用降级）、计时进度、面试报告 |
| 3 复盘题库 | `/reviews`、`/bank` | 面试一键生成复盘、题库分类、薄弱标记、抽题再练、导出 Markdown |
| 4 档案与数据 | `/profile`、`/resumes`、`/jobs`、`/privacy` | 本地档案、多份简历/岗位、模块间数据打通、隐私说明 |

## 技术栈

- 前端：React 18 + TypeScript + Vite 6，手写 CSS（纸感纸色 + 朱批红，无 UI 库），桌面优先并适配手机
- 后端：Node 20 + Express 4（TypeScript），同一进程托管前端静态文件与 `/api`
- 数据：SQLite（sql.js / WebAssembly 版，无原生二进制），覆盖档案、简历、岗位、JD 分析、面试与逐轮问答、复盘、题库、薄弱标记
- 模型：智谱开放平台 `glm-4-air`，服务端调用，JSON 输出 + zod 校验 + 最多 3 次重试 + 55s 超时；不可用时部分能力降级为本地规则并标注

## 快速开始

```bash
cd app
npm install
copy .env.example .env     # macOS/Linux: cp .env.example .env
# 编辑 .env，填入 ZHIPU_API_KEY（仅服务端使用）
npm run dev
```

- 前端：http://localhost:5173
- 接口：http://localhost:8787（Vite 代理 `/api`）
- 数据：`app/data/fenglin.sqlite`（本地持久）

生产模式（单进程）：

```bash
cd app
npm run build
# PowerShell: $env:NODE_ENV='production'; $env:PORT=8787
# cmd:        set NODE_ENV=production && set PORT=8787
npm start
```

打开 http://localhost:8787 即可。生产模式默认把库写到 `%TMPDIR%\fenglin-cloud-interview\fenglin.sqlite`，可用 `DB_PATH` 指定持久位置。

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `ZHIPU_API_KEY` | 是 | 智谱开放平台 Key，只在服务端读取；`.env` 已忽略，不会入库 |
| `ZHIPU_MODEL` | 否 | 默认 `glm-4-air` |
| `PORT` | 否 | 默认 8787，托管环境由平台注入 8000 |
| `DB_PATH` | 否 | 覆盖数据库文件路径 |
| `SHARED_DEMO` | 否 | 置 `1` 显示「公网演示实例」提示 |

## 目录结构

```
.
├─ app/                         应用源码
│  ├─ src/                      前端（pages / components / lib / styles.css）
│  ├─ server/                   后端（Express、SQLite、智谱客户端、路由）
│  ├─ package.json              脚本：dev / build / start / typecheck
│  └─ .env.example              环境变量示例（不含密钥）
├─ 2026-11-20/fenglin-mianshi/
│  └─ outputs/                  README、部署说明、演示分镜、截图清单、Session ID 说明、截图
└─ .gitignore
```

## 文档

- [交付说明 README](2026-11-20/fenglin-mianshi/outputs/README.md)
- [部署说明（含 SQLite 兼容性取舍与公网限制）](2026-11-20/fenglin-mianshi/outputs/部署说明.md)
- [演示视频分镜脚本](2026-11-20/fenglin-mianshi/outputs/演示视频分镜脚本.md)
- [截图清单](2026-11-20/fenglin-mianshi/outputs/截图清单.md)
- [Session ID 说明](2026-11-20/fenglin-mianshi/outputs/Session%20ID%20说明.md)

## 已知限制

1. 不做注册/登录：公网托管没有持久化存储卷，账号数据会随实例重启丢失，因此维持单机档案；公网实例所有访客共享一份数据，重启即清空。
2. 导出仅 Markdown / 纯文本，docx 与 PDF 未实现。
3. 不做 PDF / 图片简历解析，只支持粘贴文本或导入 `.md` / `.txt`。
4. 语音作答依赖浏览器 Web Speech API，不支持时自动降级为文字。
5. 模型耗时受网络影响：出题 1–7s、单题反馈 5–17s、建议与报告 8–30s（单次上限 55s）。

## 隐私

简历正文、JD 与作答内容会发送到智谱开放平台用于生成建议与反馈；API Key 只在服务端，前端产物与接口响应不包含密钥。本地运行时数据保存在 `app/data/`；公网演示实例的数据存放在临时目录，重启或重新部署即清空。详见应用内「隐私说明」页。
