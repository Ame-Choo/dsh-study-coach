/**
 * dsh-study-coach — DSH 那一半（设置左侧的「学习教练」一栏；「内置插件」页里也有一个同名页签）。
 *
 * 这是一个「客户端 bundle」：不是普通 ESM 模块，而是宿主在浏览器里执行的一段脚本。
 * 壳子（window.__ModuleLoader__.load）跟 dsh-talk / dsh-client-ui-settings-plugins 一致，
 * 照抄那个形状，别自己发明：
 *   · require 只能取平台种子表里的模块（react / react/jsx-runtime / cordis / 静态 UI 库），
 *     外加 package.json 里 dsh.client.inject 列出来的那几个包；
 *   · 只导出 apply / inject / name，宿主按这三个接线。
 *
 * 这个页签干三件事（都在同一源下，fetch 打 /study/api/panel 不经跨域）：
 *   1. 面板服务的开关：启动 / 停止 / 重启——「web 端启动键」；
 *   2. 首选端口与「加载时自启」，写进 settings.json；
 *   3. 跳转入口：打开网页面板，以及今天 / 地图 / 能力 … 每一页直达。
 *
 * 样式一律用 --dsw-alias-* 那套主题 token（明暗主题各一份），
 * **不要**用插件自己面板的 --ink/--card：那是另一套配色体系，在这里拿不到值。
 */
window.__ModuleLoader__.load({
  id: 'dsh-study-coach',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')

    const NS = 'settings.study-coach'
    const name = 'dsh-study-coach'

    const API = '/study/api/panel'
    const PAGES = [
      { label: '主页', path: '/study' },
      { label: '今天', path: '/study/today' },
      { label: '知识地图', path: '/study/map' },
      { label: '能力', path: '/study/ability' },
      { label: '档案', path: '/study/library' },
      { label: '资料', path: '/study/materials' },
      { label: '工具', path: '/study/toolbox' },
      { label: '对话', path: '/study/coach' },
    ]

    function installStyles() {
      const tagId = 'dsh-study-coach/settings.css'
      if (typeof document === 'undefined') return () => {}
      const selector = 'style[data-plugin-css=' + JSON.stringify(tagId) + ']'
      if (document.querySelector(selector) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = name
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        if (tag.parentNode) tag.parentNode.removeChild(tag)
      }
    }

    const CSS = `
.sc-root { display: flex; flex-direction: column; gap: 14px; max-width: 760px; color: var(--dsw-alias-label-primary); }
.sc-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sc-title { margin: 0; font-size: 18px; font-weight: 600; }
.sc-sub { margin: 0; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.sc-badge { border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); padding: 1px 9px; font-size: 12px; line-height: 20px; }
.sc-badge.ok { color: var(--dsw-alias-state-success-primary); border-color: currentColor; }
.sc-badge.off { color: var(--dsw-alias-state-idle-primary); }
.sc-badge.bad { color: var(--dsw-alias-state-error-primary); border-color: currentColor; }
.sc-card { border: .5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.sc-card > h3 { margin: 0; font-size: 14px; font-weight: 600; }
.sc-note { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.sc-note.warn { color: var(--dsw-alias-state-warn-primary); }
.sc-note.bad { color: var(--dsw-alias-state-error-primary); }
.sc-addr { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--dsw-alias-label-primary); word-break: break-all; }
.sc-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.sc-btn { font: inherit; font-size: 13px; min-height: 30px; padding: 0 12px; border-radius: 8px; cursor: pointer; border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.sc-btn:hover:not(:disabled) { border-color: var(--dsw-alias-brand-primary); }
.sc-btn:disabled { opacity: .45; cursor: default; }
.sc-btn.primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.sc-btn.link { border: 0; background: 0 0; padding: 0 4px; color: var(--dsw-alias-brand-primary); text-decoration: underline; }
.sc-field { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.sc-field input[type="number"] { font: inherit; font-size: 13px; width: 88px; min-height: 30px; padding: 0 8px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.sc-chips { display: flex; gap: 6px; flex-wrap: wrap; }
`

    /** 面板接口只在这一处收口：别的组件别自己 fetch。 */
    async function call(method, body) {
      const res = await fetch(API, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const data = await res.json().catch(() => null)
      if (!data || data.ok !== true) throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`)
      return data
    }

    function open(url) {
      if (!url) return
      /* 面板是独立 origin，DSH 自己那个内嵌浏览器开不了 DSH 的 origin——所以一律走外部的浏览器。 */
      window.open(url, '_blank', 'noopener')
    }

    /**
     * 页签本体。props 由 slots.register 的 inject 送进来（有 t 的话优先用它，
     * 但没有也不依赖 locale——这一页没有需要翻译的东西）。
     */
    function StudyCoachTab() {
      const h = React.createElement
      const [state, setState] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [port, setPort] = React.useState('')
      const [autoStart, setAutoStart] = React.useState(true)

      const load = React.useCallback(async () => {
        try {
          const data = await call('GET')
          setState(data)
          setError('')
          setPort(String((data.settings && data.settings.panel && data.settings.panel.port) ?? ''))
          setAutoStart(Boolean(data.settings && data.settings.panel && data.settings.panel.autoStart))
        } catch (err) {
          setError(String((err && err.message) || err))
        }
      }, [])

      React.useEffect(() => {
        void load()
      }, [load])

      const act = async (what, body) => {
        setBusy(what)
        try {
          const data = await call('POST', body || { action: what })
          setState(data)
          setError('')
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy('')
        }
      }

      const running = Boolean(state && state.running)
      const supported = state ? state.supported !== false : true
      /* 跑着就用实际监听的那个；没跑就用「首选端口」拼一个出来，别让人对着空地址发呆。 */
      const base = (state && (state.url || state.hintUrl)) || ''
      const panelUrl = base ? base.replace(/\/+$/, '') : ''

      const badge = !state
        ? h('span', { className: 'sc-badge off' }, error ? '读不到' : '读取中')
        : !supported
          ? h('span', { className: 'sc-badge bad' }, '不可用')
          : running
            ? h('span', { className: 'sc-badge ok' }, '运行中')
            : h('span', { className: 'sc-badge off' }, '已停止')

      return h(
        'div',
        { className: 'sc-root', 'data-dsh-study-coach-settings': '' },
        h(
          'div',
          { className: 'sc-head' },
          h('h2', { className: 'sc-title' }, '学习教练'),
          badge,
          state && state.port ? h('span', { className: 'sc-addr' }, `127.0.0.1:${state.port}`) : null,
        ),
        h('p', { className: 'sc-sub' }, '学习档案在本机：知识地图、今日任务、错题本、艾宾浩斯记忆卡，都在网页面板里。'),

        /* ── 跳转入口 ── */
        h(
          'div',
          { className: 'sc-card' },
          h('h3', null, '网页面板'),
          h('p', { className: 'sc-note' }, running ? '面板开着，直接进。' : '面板现在没开——点下面「启动」，或者在浏览器里打开这个地址。'),
          panelUrl ? h('div', { className: 'sc-addr' }, panelUrl) : null,
          h(
            'div',
            { className: 'sc-row' },
            h('button', { type: 'button', className: 'sc-btn primary', disabled: !panelUrl, onClick: () => open(panelUrl) }, '打开网页面板'),
            running
              ? null
              : h('button', { type: 'button', className: 'sc-btn', disabled: !supported || busy !== '', onClick: () => act('start') }, busy === 'start' ? '启动中…' : '启动'),
          ),
          h(
            'div',
            { className: 'sc-chips' },
            PAGES.map((page) =>
              h(
                'button',
                {
                  key: page.path,
                  type: 'button',
                  className: 'sc-btn link',
                  disabled: !panelUrl,
                  onClick: () => open(panelUrl.replace(/\/study$/, '') + page.path),
                },
                page.label,
              ),
            ),
          ),
        ),

        /* ── 开关 ── */
        h(
          'div',
          { className: 'sc-card' },
          h('h3', null, '面板服务'),
          h('p', { className: 'sc-note' }, '这条是插件自己起在 127.0.0.1 上的独立端口，专给 DSH 内嵌浏览器用（它不许开 DSH 自身的 origin）。DSH 同源那条 /study 一直在，关不掉。'),
          h(
            'div',
            { className: 'sc-row' },
            h('button', { type: 'button', className: 'sc-btn', disabled: !supported || running || busy !== '', onClick: () => act('start') }, busy === 'start' ? '启动中…' : '启动'),
            h('button', { type: 'button', className: 'sc-btn', disabled: !supported || !running || busy !== '', onClick: () => act('stop') }, busy === 'stop' ? '停止中…' : '停止'),
            h('button', { type: 'button', className: 'sc-btn', disabled: !supported || busy !== '', onClick: () => act('restart') }, busy === 'restart' ? '重启中…' : '重启'),
          ),
          supported ? null : h('p', { className: 'sc-note warn' }, '当前进程里没有面板服务控制器：看得见状态，但开不了也关不了。'),
          error ? h('p', { className: 'sc-note bad' }, error) : null,
          state && state.error ? h('p', { className: 'sc-note bad' }, state.error) : null,
          state && state.note ? h('p', { className: 'sc-note warn' }, state.note) : null,
        ),

        /* ── 设置 ── */
        h(
          'div',
          { className: 'sc-card' },
          h('h3', null, '启动设置'),
          h(
            'div',
            { className: 'sc-row' },
            h('label', { className: 'sc-field' }, '首选端口', h('input', { type: 'number', min: 1024, max: 65535, value: port, onChange: (event) => setPort(event.target.value) })),
            h(
              'label',
              { className: 'sc-field' },
              h('input', { type: 'checkbox', checked: autoStart, onChange: (event) => setAutoStart(event.target.checked) }),
              'DSH 启动时自动开',
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'sc-btn',
                disabled: !supported || busy !== '',
                onClick: () => act('save', { port: Number(port), autoStart }),
              },
              busy === 'save' ? '保存中…' : '保存',
            ),
            running
              ? h('button', { type: 'button', className: 'sc-btn', disabled: !supported || busy !== '', onClick: () => act('restart') }, '存并重启')
              : null,
          ),
          h('p', { className: 'sc-note' }, '端口 1024—65535。被占了会自动往后试几个，面板上显示的永远是真正听上的那个。'),
        ),
      )
    }

    const inject = ['slots']

    /**
     * 挂一处座位。slots.inject 是「等这个座位被声明出来再挂」——设置那边的座位是
     * 那个页面挂载时才声明的，所以回调会在声明提交之后补跑一次，不用自己轮询。
     * slot 必须等于座位名，id / order 照 slots.ts 的契约给。
     */
    function mount(slots, slot, order, component) {
      slots.inject(slot, () =>
        slots.register({ name: slot, id: 'study-coach', order, label: '学习教练' }, component),
      )
    }

    async function apply(ctx) {
      ctx.effect(() => installStyles(), 'dsh-study-coach: stylesheet')
      const slots = ctx.get('slots') || ctx.slots
      if (!slots) return
      /*
       * 挂两处，各挂各的，谁挂不上都不影响另一个：
       *   · settings.section     —— 设置左边自己一栏「学习教练」，跟「表情包」「智能体预设」同层。
       *                             插件自己的页不该埋在「内置插件」里面——那正是「找不到」的原因。
       *   · settings.plugins.tab —— 顺手也在「内置插件」页里留一个页签，习惯从那儿找的人也有路。
       */
      mount(slots, 'settings.section', 32, StudyCoachTab)
      mount(slots, 'settings.plugins.tab', 60, StudyCoachTab)
    }

    exports.NS = NS
    exports.PAGES = PAGES
    exports.StudyCoachTab = StudyCoachTab
    exports.apply = apply
    exports.inject = inject
    exports.name = name
    return module.exports
  },
})
