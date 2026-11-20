import { Link } from 'react-router-dom';
import { Callout, Card, PageHeader } from '../components/ui';
import { useApp } from '../state';

export function Privacy() {
  const { sharedDemo } = useApp();
  return (
    <div className="page">
      <PageHeader
        eyebrow="透明说明"
        title="隐私说明"
        desc="这份说明写给真实用户，也写给评审：我们明确写清数据在哪处理、哪些内容会外发模型、哪些能力并没有做到。"
      />

      {sharedDemo && (
        <Callout tone="warn">
          当前访问的是<strong>公网演示实例</strong>：服务端没有账号体系，所有访问者共享同一份数据，且数据存放在实例的临时目录里，实例重启或重新部署即清空。
          请只填写示例信息，不要输入真实简历、手机号等隐私内容。
        </Callout>
      )}

      <div className="privacy-grid">
        <Card title="一句话结论">
          <p className="lead">
            你的简历、JD、面试回答都存在<strong>你自己部署的这台机器的 SQLite 文件</strong>里；只有在你点击 AI 功能时，相关文本才会发送给<strong>智谱开放平台</strong>用于生成结果。
            我们没有账号体系，也不会把数据存到任何第三方服务器；模型调用只发送当次所需的内容，返回后即用即走。
          </p>
        </Card>

        <Card title="数据流向">
          <ol className="flow-list">
            <li>
              <strong>浏览器 → 本地服务端</strong>：你填写的简历、岗位、回答通过本机 HTTP 接口提交，存入 SQLite。
            </li>
            <li>
              <strong>本地服务端 → 智谱 API</strong>：仅在调用以下功能时发送：简历批注、JD 匹配、对话迭代、出题、作答反馈、生成报告、润色、复盘建议。
              发送内容为当次需要的文本（简历正文 / JD / 你的回答 / 题目），不包含你的浏览器环境信息。
            </li>
            <li>
              <strong>模型 → 服务端 → 浏览器</strong>：模型返回 JSON，服务端按约定结构校验后才展示；解析失败会重试，失败则降级或给出错误提示。
            </li>
          </ol>
        </Card>

        <Card title="上传 PDF / 图片时">
          <ul className="principles">
            <li>
              <strong>电子版 PDF</strong>：用 pdf.js 在<strong>浏览器本地</strong>抽取文字层，原文件和文字都不上传；解析结果先给你确认。
            </li>
            <li>
              <strong>扫描件 / 照片</strong>：浏览器把页面渲染成图片，经本地服务端转发给<strong>智谱多模态模型（glm-4v-flash）</strong>识别。
              图片只在内存中处理，<strong>不落盘、不写入数据库、不长期存储</strong>。
            </li>
            <li>解析结果先进入带原文预览的<strong>可编辑确认页</strong>，你点确认后才写入简历表，不会自动入库。</li>
            <li>限制：单文件 ≤10MB；支持 PDF / PNG / JPG / WEBP；扫描件最多解析前 3 页。</li>
          </ul>
        </Card>

        <Card title="我们不会做的事">
          <ul className="principles crossed">
            <li>不做注册、不收集手机号 / 邮箱 / 身份证等身份信息。</li>
            <li>不做用户画像、不做埋点统计、不接入第三方分析 SDK。</li>
            <li>不把 API Key 写进前端代码、打包产物、接口响应或日志。</li>
            <li>不把简历内容写入服务端日志（只记录调用标签、耗时、错误码）。</li>
            <li>不把你的数据上传到任何云端备份。</li>
          </ul>
        </Card>

        <Card title="明确的限制（不粉饰）">
          <ul className="principles">
            <li>数据库文件<strong>没有加密</strong>：能读到文件的人就能读到简历内容，请放在可信设备上。</li>
            <li>没有多用户隔离：同一地址的所有访问者共享一份数据，仅适合个人使用或演示。</li>
            <li>语音作答使用浏览器 Web Speech API：Chrome 等浏览器可能把音频发送给浏览器厂商的识别服务，这与本应用无关，也无法由我们关闭。不支持该 API 的浏览器会自动降级为文字输入并提示。</li>
            <li>模板库与本地降级能力由规则生成，不调用模型；结果会明确标注「本地降级」。</li>
            <li>导出支持 Markdown 与 Word（.docx，服务端生成）；PDF 通过专用 A4 打印视图，由浏览器「另存为 PDF」生成，不上传任何文件。</li>
          </ul>
        </Card>

        <Card title="部署形态带来的限制">
          <ul className="principles">
            <li>
              公网部署运行在无状态容器里：数据库文件写在 <code>{'{TMPDIR}'}/fenglin-cloud-interview/</code>，属<strong>临时存储</strong>，实例重启、重新部署或平台清理后会丢失。
            </li>
            <li>
              因此这一版<strong>不做注册/登录</strong>：托管平台没有提供可持久化的数据库或对象存储，账号与简历会在重启后一并消失，做出来只是假承诺。
            </li>
            <li>没有账号就没有多用户隔离：公网实例的所有访问者看到同一份数据，页面顶部会持续提示这一点。</li>
            <li>本地运行时（<code>npm run dev</code>）数据落在 <code>app/data/fenglin.sqlite</code>，是持久的，可自行备份。</li>
          </ul>
        </Card>

        <Card title="如何删除你的数据">
          <ul className="principles">
            <li>逐条删除：简历、岗位、面试、复盘、题库页面都提供删除入口。</li>
            <li>全部清空：停止服务后删除 <code>data/fenglin.sqlite</code>，重启即得到空库。</li>
            <li>删除后不可恢复，建议先复制文件做备份。</li>
          </ul>
          <Callout tone="warn">
            比赛演示环境中的示例数据由「载入示例档案」功能生成，姓名、学校、公司、项目与分数均为虚构，不包含任何真实用户的隐私信息。
          </Callout>
        </Card>

        <Card title="示例数据（演示用）">
          <ul className="principles">
            <li>
              训练台首屏提供<strong>「载入示例档案」</strong>：一次性写入岗位（含 JD）、简历、JD 匹配、3 场不同水平的面试（含逐题反馈与报告）、复盘与题库薄弱项；若本机档案四项都为空，也会写入示例姓名与学校。
            </li>
            <li>所有示例记录的名称都以<strong>「示例-」</strong>开头，并在服务端单独登记标记，便于识别与清理。</li>
            <li>
              同页提供<strong>「清空示例数据」</strong>：只删除被标记的示例记录，绝不会删除你自己创建的简历、岗位、面试、复盘或题库题目。
            </li>
            <li>重复点击载入会先清理旧的示例记录再写入，不会产生重复数据。</li>
            <li>示例分数与反馈是固定内容，不调用模型，目的是让评委在空库上也能看到完整链路。</li>
          </ul>
        </Card>

        <Card title="关于模型服务">
          <p>
            对话模型通过服务端环境变量 <code>ZHIPU_API_KEY</code> 调用智谱开放平台，密钥只存在于服务器进程内存与 <code>.env</code> 文件中（<code>.env</code> 已在
            <code>.gitignore</code> 内）。前端永远拿不到密钥，所有模型请求都由后端代理。
          </p>
          <p className="muted small">
            模型输出的质量与稳定性由第三方服务决定；我们做了结构校验、超时与重试，但仍可能出现不准确的内容，请把它当作练习建议而非权威结论。
          </p>
          <div className="mt-12">
            <Link to="/profile" className="link">
              返回本地档案 →
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
