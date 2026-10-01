/**
 * 插件设置（settings.json）与面板服务开关。
 *
 * 三块分开测：
 *   · lib/settings.js —— 读宽容、写严格；
 *   · createPanelControl —— 起 / 停 / 重启、端口被占往后挪、幂等；
 *   · GET|POST /study/api/panel —— 前端只认这一种形状。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import { createHandler } from '../lib/handler.js'
import { DEFAULT_PORT, createPanelControl } from '../lib/panel-server.js'
import {
  PORT_MAX,
  PORT_MIN,
  emptySettings,
  normalizeSettings,
  patchSettings,
  readSettings,
  settingsPath,
  validateSettings,
  writeSettings,
} from '../lib/settings.js'

const ASSETS = join(import.meta.dirname, '..', 'assets')

function tmp() {
  return mkdtempSync(join(tmpdir(), 'study-settings-'))
}

function fixture(panel) {
  const root = tmp()
  const store = new Store(root)
  store.ensure()
  const router = createRouter(store, panel ? { panel } : {})
  const handler = createHandler(store, router, { assetsDir: ASSETS })
  return { root, store, handler, router }
}

/* ── lib/settings.js ──────────────────────────────────────────────────── */

test('设置：不在就回默认值，坏成什么样都不抛', () => {
  const root = tmp()
  try {
    assert.deepEqual(readSettings(root), emptySettings())
    assert.equal(readSettings(root).panel.port, DEFAULT_PORT)
    assert.equal(readSettings(root).panel.autoStart, true)

    // 半截 JSON
    writeFileSync(settingsPath(root), '{ "panel": { "port":', 'utf8')
    assert.deepEqual(readSettings(root), emptySettings())

    // 顶层不是对象
    writeFileSync(settingsPath(root), '"nope"', 'utf8')
    assert.deepEqual(readSettings(root), emptySettings())

    // 合法 JSON 但字段全乱：认得的项退回默认，不认得的丢掉
    writeFileSync(
      settingsPath(root),
      JSON.stringify({ version: 99, panel: { autoStart: 'yes', port: 99999 }, extra: 1 }),
      'utf8',
    )
    assert.deepEqual(readSettings(root), emptySettings())
    assert.deepEqual(normalizeSettings({ panel: { autoStart: false, port: PORT_MIN } }).panel, {
      autoStart: false,
      port: PORT_MIN,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('设置：写进来的是新值，错了就得说清哪一项不对', () => {
  const root = tmp()
  try {
    // 只传认识的那几项，其余保持原样
    writeSettings(root, { version: 1, panel: { autoStart: false, port: 19400 } })
    const after = patchSettings(root, { panel: { port: 19500 } })
    assert.deepEqual(after.panel, { autoStart: false, port: 19500 })
    assert.deepEqual(readSettings(root).panel, { autoStart: false, port: 19500 })

    // 落盘的是 JSON，临时文件不留
    assert.deepEqual(JSON.parse(readFileSync(settingsPath(root), 'utf8')).panel.port, 19500)

    // 面板上就是两个字面量控件，字符串数字也得收
    assert.deepEqual(validateSettings({ panel: { port: '19401', autoStart: true } }).panel, {
      port: 19401,
      autoStart: true,
    })

    // 不认识的一律抛，别静默吞
    assert.throws(() => validateSettings({ panel: { port: PORT_MIN - 1 } }), /panel\.port 要是 1024—65535/)
    assert.throws(() => validateSettings({ panel: { port: PORT_MAX + 1 } }), /panel\.port/)
    assert.throws(() => validateSettings({ panel: { port: 19.5 } }), /panel\.port/)
    assert.throws(() => validateSettings({ panel: { port: 'x' } }), /收到「x」/)
    assert.throws(() => validateSettings({ panel: { autoStart: 'true' } }), /panel\.autoStart 只能是 true \/ false/)
    assert.throws(() => validateSettings({ panel: 'nope' }), /设置里的 panel 要是一个对象/)
    assert.throws(() => validateSettings(null), /设置要是一个对象/)
    // 抛了就不能落盘：盘上还是刚才那份
    assert.equal(readSettings(root).panel.port, 19500)

    // 不提 panel 就当没改，别顺手把别的项清掉
    assert.deepEqual(validateSettings({}), {})
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/* ── createPanelControl ───────────────────────────────────────────────── */

test('面板控制器：起得来、问得出状态、能停能重启，重复调用不出第二个服务', async () => {
  const { handler } = fixture()
  const control = createPanelControl({ handler, port: 0 })
  try {
    const off = control.info()
    assert.equal(off.running, false)
    assert.equal(off.port, null)
    assert.equal(off.url, null)
    assert.equal(off.preferred, 0)
    assert.equal(off.hintUrl, 'http://127.0.0.1:0/study')
    assert.equal(off.error, null)

    const first = await control.start()
    assert.equal(first.running, true)
    assert.equal(typeof first.port, 'number')
    assert.equal(first.url, `http://127.0.0.1:${first.port}/study`)
    assert.equal((await fetch(first.url)).status, 200)

    // 已经开着：再 start 一次不该换端口、也不该多听一个
    const again = await control.start()
    assert.equal(again.port, first.port)

    // 并发 start 合流到同一次
    await control.stop()
    const [a, b] = await Promise.all([control.start(), control.start()])
    assert.equal(a.port, b.port)
    assert.equal(control.info().running, true)

    // 重启：关掉再开（首选端口填的是 0 = 随便挑一个，所以端口号不必跟上次一样）
    const restarted = await control.restart()
    assert.equal(restarted.running, true)
    assert.equal(typeof restarted.port, 'number')
    assert.equal((await fetch(restarted.url)).status, 200)

    // 停止之后端口真的空了，状态跟着变
    await control.stop()
    assert.equal(control.info().running, false)
    assert.equal(control.info().url, null)
    await assert.rejects(() => fetch(first.url))
  } finally {
    await control.stop()
  }
})

test('面板控制器：首选端口被占就往后挪，info() 报的是真正听上的那个', async () => {
  const { handler } = fixture()
  const blocker = createPanelControl({ handler, port: 0 })
  const control = createPanelControl({ handler, port: 0 })
  try {
    const taken = await blocker.start()
    const moved = await control.start(taken.port)
    assert.ok(moved.port > taken.port, `期望大于 ${taken.port}，实际 ${moved.port}`)
    assert.equal(moved.preferred, taken.port, '首选端口是用户写下的那个，不是挪过去的那个')
    assert.equal(control.info().hintUrl, `http://127.0.0.1:${taken.port}/study`)
  } finally {
    await control.stop()
    await blocker.stop()
  }
})

/* ── GET|POST /study/api/panel ────────────────────────────────────────── */

test('面板接口：没接控制器就说清「开不了」，不装成能用', async () => {
  const { router } = fixture()
  const get = router({ method: 'GET', pathname: '/study/api/panel' })
  assert.equal(get.code, 200)
  assert.equal(get.body.supported, false)
  assert.equal(get.body.running, false)
  assert.equal(get.body.settings, null)
  assert.match(get.body.note, /没接面板服务控制器/)

  // POST 的 handler 是 async，handle() 还回来的是 promise
  const post = await router({ method: 'POST', pathname: '/study/api/panel', body: { action: 'start' } })
  assert.equal(post.code, 400)
  assert.match(post.body.error.message, /没有面板服务控制器/)
})

test('面板接口：状态、开关、存端口，回的形状前端只解析一种', async () => {
  const { root, handler } = fixture()
  const control = createPanelControl({ handler, port: 0 })
  let settings = { version: 1, panel: { autoStart: true, port: 0 } }
  const calls = []
  const panel = {
    info: () => control.info(),
    start: (port) => {
      calls.push(['start', port])
      if (port != null) settings.panel.port = port
      return control.start(settings.panel.port)
    },
    stop: () => {
      calls.push(['stop'])
      return control.stop()
    },
    restart: (port) => {
      calls.push(['restart', port])
      if (port != null) settings.panel.port = port
      return control.restart(settings.panel.port)
    },
    settings: () => settings,
    save: (patch) => {
      settings = patchSettings(root, patch)
      return settings
    },
  }
  const store = new Store(root)
  store.ensure()
  const route = createRouter(store, { panel })
  try {
    const off = await route({ method: 'GET', pathname: '/study/api/panel' })
    assert.equal(off.body.supported, true)
    assert.equal(off.body.running, false)
    assert.equal(off.body.settings.panel.autoStart, true)

    const started = await route({ method: 'POST', pathname: '/study/api/panel', body: { action: 'start' } })
    assert.equal(started.code, 200)
    assert.equal(started.body.running, true)
    assert.equal(typeof started.body.port, 'number')
    // 起的时候带上设置里那个端口（这里是 0 = 随便挑一个），不是 undefined
    assert.deepEqual(calls.at(-1), ['start', 0])

    // 改端口但不重启：得提醒「现在听的还是旧端口」
    const port = started.body.port
    const saved = await route({ method: 'POST', pathname: '/study/api/panel', body: { port: port + 1, autoStart: false } })
    assert.equal(saved.body.saved, true)
    assert.equal(saved.body.settings.panel.port, port + 1)
    assert.equal(saved.body.settings.panel.autoStart, false)
    assert.match(saved.body.note, new RegExp(`现在还在 ${port} 上`))

    // 重启：会带上刚存进去那个端口
    const restarted = await route({ method: 'POST', pathname: '/study/api/panel', body: { action: 'restart' } })
    assert.deepEqual(calls.at(-1), ['restart', port + 1])
    assert.equal(restarted.body.note, '', '重启过就不该再唠叨端口的事')
    assert.equal(restarted.body.settings.panel.port, port + 1)

    // 停
    const stopped = await route({ method: 'POST', pathname: '/study/api/panel', body: { action: 'stop' } })
    assert.equal(stopped.body.running, false)

    // 乱的 action / 非法端口都得挡住
    const nuke = await route({ method: 'POST', pathname: '/study/api/panel', body: { action: 'nuke' } })
    assert.equal(nuke.code, 400)
    assert.match(nuke.body.error.message, /action 只能是 start \/ stop \/ restart/)
    const badPort = await route({ method: 'POST', pathname: '/study/api/panel', body: { port: 80 } })
    assert.equal(badPort.code, 400)
    assert.match(badPort.body.error.message, /panel\.port 要是 1024—65535/)
    assert.equal(readSettings(root).panel.port, port + 1, '被挡住的那次不能落盘')
  } finally {
    await control.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test('独立端口那半端得出面板页面，静态资源也端得出来', async () => {
  const { root, handler } = fixture()
  const control = createPanelControl({ handler, port: 0 })
  try {
    const started = await control.start()
    assert.equal(started.url, `http://127.0.0.1:${started.port}/study`)

    // 壳子在服务端就写好了，卡片是 panel.js 在浏览器里画的（渲染那部分 panel.test.js 管）
    const page = await fetch(`${started.url}/today`)
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /<title>学习教练<\/title>/)
    assert.match(html, /src="\/study\/assets\/panel.js"/)

    const js = await fetch(`${started.url}/assets/panel.js`)
    assert.equal(js.status, 200)
    assert.match(js.headers.get('content-type') ?? '', /javascript/)

    assert.equal(readSettings(root).panel.autoStart, true)
  } finally {
    await control.stop()
    rmSync(root, { recursive: true, force: true })
  }
})
