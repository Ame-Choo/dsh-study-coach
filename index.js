/**
 * dsh-study-coach — host half.
 *
 * 面板挂两处，因为 DSH 内嵌浏览器不许开 DSH 自身的 origin：
 *   · DSH 自己的 webServer → http://127.0.0.1:19387/study（同源，系统浏览器与对话链接走这条）
 *   · 插件自己的独立端口  → http://127.0.0.1:19388/study（不同 origin，内嵌 Browser 页签才肯加载）
 *
 *   GET  /study            → 面板页面
 *   GET  /study/assets/*   → 面板的 js / css
 *   *    /study/api/*      → 学习档案读写（见 lib/routes.js）
 *
 * 注册 15 个模型面向的工具（study_report / study_goal / study_map / study_analysis /
 * study_record / study_plan / study_material / study_tool_level / study_archive /
 * study_ability / study_library / study_files / study_pages / study_guide / study_inbox），
 * 让教练在对话里就能读写档案、给面板留话、收面板上的留言。
 *
 * 再把「学习教练」agent 预设登记进 host 的 agentPresets 注册表（见 lib/preset.js），
 * 这样 Web 上新建会话的模式列表里会多一个「学习教练」。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { Library } from './lib/library.js'
import { createRouter } from './lib/routes.js'
import { createBridge } from './lib/bridge.js'
import { createChat } from './lib/chat.js'
import { createHandler } from './lib/handler.js'
import { DEFAULT_PORT, startPanelServer } from './lib/panel-server.js'
import { registerTools } from './lib/tools.js'
import { registerPreset } from './lib/preset.js'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-study-coach'

/** Services required before mounting. */
export const inject = ['webServer', 'tools']

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'assets')

/** 档案放哪儿。想换地方就设 DSH_STUDY_ROOT。 */
export const DATA_ROOT = process.env.DSH_STUDY_ROOT || join(homedir(), '.dsh', 'study-coach')

/**
 * 拆出来的页图和网页上传的原件，都放档案库根下，**不动用户自己的文件夹**。
 * 页图单独开一条只读出口（/study/page），因为它不归任何一份登记过的材料管。
 */
export const PAGES_ROOT = join(DATA_ROOT, 'pages')
export const UPLOAD_ROOT = join(DATA_ROOT, 'uploads')

/** @param {import('@deepseek-ai/cordis').Context} ctx */
export function apply(ctx) {
  const store = new Library(DATA_ROOT)
  store.ensure()

  /**
   * 面板 → 对话 的那条线。sessionController 不写进 inject：
   * 是个可选增强，缺了面板照样能用（留言先存着，我下回开口时会看到），
   * 写进 inject 反而会让整个插件在这台机器上装不上。
   */
  const bridge = createBridge({
    resolve: () => (typeof ctx.get === 'function' ? ctx.get('sessionController') : null),
  })

  /**
   * 反方向：把对话读回面板。和 bridge 共用同一个服务、同一套「缺了也能跑」的规矩。
   */
  const chat = createChat({
    resolve: () => (typeof ctx.get === 'function' ? ctx.get('sessionController') : null),
  })

  const router = createRouter(store, { bridge, chat, pagesRoot: PAGES_ROOT })
  const handler = createHandler(store, router, { assetsDir: ASSETS, pagesRoot: PAGES_ROOT, uploadRoot: UPLOAD_ROOT })

  /**
   * 面板在哪儿的两条地址。工具拿它告诉用户该开哪个。
   * path 是同源那份，url 是独立端口那份（起来之后才有值）。
   */
  const panel = { path: '/study', url: null, port: null, defaultPort: DEFAULT_PORT, error: null }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/study',
    handler,
  }), 'dsh-study-coach: /study 面板与接口（同源）')

  ctx.effect(() => {
    const state = { stopped: false, server: null }
    startPanelServer(handler)
      .then((server) => {
        if (state.stopped) {
          void server.close()
          return
        }
        state.server = server
        panel.url = server.url
        panel.port = server.port
      })
      .catch((error) => {
        panel.error = String((error && error.message) ?? error)
      })
    return () => {
      state.stopped = true
      const server = state.server
      if (server) void server.close()
    }
  }, 'dsh-study-coach: 面板独立端口')

  ctx.effect(() => {
    // pagesRoot 是拆书拆出来的页图落脚的地方（`pages/<书名>-<hash>/p0007.png`）。
    // study_pages 也渲到这里：跟页面出口 /study/page 用同一个目录，渲完就能点开看。
    // scratchDir 是老名字，留着给别处调用，值一样。故意放在档案目录下、不进工作区。
    const disposers = registerTools(ctx, store, defineTool, {
      panel,
      pagesRoot: PAGES_ROOT,
      scratchDir: PAGES_ROOT,
    })
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 单个工具注销失败不该拦住别的 */
        }
      }
    }
  }, 'dsh-study-coach: 学习档案工具')

  registerPreset(ctx)
}
