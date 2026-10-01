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
 * 面板服务本身也能开关：设置页 /study/settings 与 GET|POST /study/api/panel 走的是
 * lib/panel-server.js 的 createPanelControl。端口与「加载时自动启动」落在档案库根下的
 * settings.json（见 lib/settings.js）——那是「这台机器上这个插件怎么跑」，跟学习档案无关。
 * 同源那条 /study 一直在，独立端口那条才是可以关掉的那个（内嵌浏览器要它）。
 *
 * 注册 21 个模型面向的工具，清单以 lib/tools.js 里 buildTools() 返回的那个数组为唯一依据：
 *   study_report / study_goal / study_map / study_record / study_mistakes / study_plan /
 *   study_material / study_analysis / study_book / study_archive / study_ability /
 *   study_student / study_library / study_files / study_pages / study_tool_level /
 *   study_focus / study_todo / study_card / study_guide / study_inbox，
 * 让教练在对话里就能读写档案、给面板留话、收面板上的留言。
 *
 * 再把「学习教练」agent 预设登记进 host 的 agentPresets 注册表（见 lib/preset.js），
 * 这样 Web 上新建会话的模式列表里会多一个「学习教练」。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineTool } from '@deepseek-ai/dsh-tools'

import { Library } from './lib/library.js'
import { createRouter } from './lib/routes.js'
import { createBridge } from './lib/bridge.js'
import { createChat } from './lib/chat.js'
import { createEvents } from './lib/events.js'
import { createHandler } from './lib/handler.js'
import { createMemes } from './lib/memes.js'
import { DEFAULT_PORT, createPanelControl } from './lib/panel-server.js'
import { PAGES_DIR, UPLOADS_DIR, dataRoot } from './lib/paths.js'
import { patchSettings, readSettings } from './lib/settings.js'
import { registerTools } from './lib/tools.js'
import { registerPreset } from './lib/preset.js'

/** Plugin identity for cordis.yml rows. */
export const name = 'dsh-study-coach'

/** Services required before mounting. */
export const inject = ['webServer', 'tools']

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, 'assets')

/** 档案放哪儿。想换地方就设 DSH_STUDY_ROOT。真值在 lib/paths.js，别处别自己读环境变量。 */
export const DATA_ROOT = dataRoot()

/**
 * 拆出来的页图和网页上传的原件，都放档案库根下，**不动用户自己的文件夹**。
 * 页图单独开一条只读出口（/study/page），因为它不归任何一份登记过的材料管。
 */
export const PAGES_ROOT = join(DATA_ROOT, PAGES_DIR)
export const UPLOAD_ROOT = join(DATA_ROOT, UPLOADS_DIR)

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

  /**
   * 面板的广播通道。浏览器会把后台标签页里的定时器压慢甚至冻住，
   * 「新消息得手动刷新」就是这么来的——改成服务端推给前端。
   */
  const events = createEvents()

  /**
   * 表情包图库（只读）。面板里 `[表情: 描述]` 要真出图，而 dsh-meme 的图片接口
   * 挂在 DSH 自己 origin 上、`webServer` 又不给端口，所以自己去盘上读它的 index.db。
   */
  const memes = createMemes()
  ctx.effect(() => () => events.stop(), 'dsh-study-coach: 广播通道（SSE）')

  /* 这台机器上这个插件怎么跑（端口 / 自启）。跟学习档案无关，所以不归 Library 管。 */
  let panelSettings = readSettings(DATA_ROOT)

  /**
   * 面板服务控制器。以前这里是直接把 startPanelServer() 写在 effect 里——够用，
   * 因为那时不打算让人事后动它。既然设置页要给出「启动 / 停止 / 重启」和实时状态，
   * 就得有这么个能问能开的对象（幂等与并发合流都在它里面）。
   *
   * handler 用一层转发：router 又要拿到这个控制器（设置接口走它），先有鸡还是先有蛋。
   * 转发在真正被调用时早就赋好值了。
   */
  let panelHandler = null
  const panelControl = createPanelControl({
    handler: (req, res) => panelHandler(req, res),
    port: panelSettings.panel.port,
  })

  const router = createRouter(store, {
    bridge,
    chat,
    events,
    memes,
    pagesRoot: PAGES_ROOT,
    /**
     * 设置页与客户端那半边都打 /study/api/panel，落地就在这儿。
     * save 是同步抛错的那种：值不合法要回 400 并说清哪一项，不能静默存下去。
     */
    panel: {
      info: () => panelControl.info(),
      start: (port) => panelControl.start(port),
      stop: () => panelControl.stop(),
      restart: (port) => panelControl.restart(port),
      settings: () => panelSettings,
      save: (patch) => {
        panelSettings = patchSettings(DATA_ROOT, patch)
        return panelSettings
      },
    },
  })
  const handler = createHandler(store, router, { assetsDir: ASSETS, pagesRoot: PAGES_ROOT, uploadRoot: UPLOAD_ROOT })
  panelHandler = handler

  /**
   * 面板在哪儿的两条地址。工具拿它告诉用户该开哪个。
   * path 是同源那份；url / port 是独立端口那份，用 getter 现问，因为随时可能被关掉或换端口。
   */
  const panel = {
    path: '/study',
    defaultPort: DEFAULT_PORT,
    get url() {
      return panelControl.info().url
    },
    get port() {
      return panelControl.info().port
    },
    get running() {
      return panelControl.info().running
    },
    get error() {
      return panelControl.info().error
    },
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/study',
    handler,
  }), 'dsh-study-coach: /study 面板与接口（同源）')

  ctx.effect(() => {
    /* 关掉自启就不起：内嵌浏览器要用的时候，人去设置页点「启动」。 */
    if (panelSettings.panel.autoStart) void panelControl.start()
    return () => {
      void panelControl.stop()
    }
  }, 'dsh-study-coach: 面板独立端口')

  ctx.effect(() => {
    // study_pages 把页图渲到 pagesRoot，跟页面出口 /study/page 是同一个目录，渲完就能点开看。
    // `scratchDir` 那个老名字已经删了：谁也没在用，留着只会让人以为有两套目录。
    const disposers = registerTools(ctx, store, defineTool, {
      panel,
      pagesRoot: PAGES_ROOT,
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
