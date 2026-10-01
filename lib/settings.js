/**
 * dsh-study-coach — 插件自己的设置。
 *
 * 跟学习档案是两码事，别混一起：
 *   · 档案（profiles/<id>/*.json）是「这一个学习目标学到哪了」，一个目标一份；
 *   · 这份（档案库根下的 settings.json）是「这台机器上这个插件怎么跑」，全局一份。
 * 所以它不归 Library 管，也不进 FILES 那张表——切换学习目标不该把端口和自启改掉。
 *
 * 读宽容、写严格，这是故意的：
 *   · read 一律读得下去，盘上那份被人手改成乱码也不该拦住插件启动；
 *   · 但面板和工具递进来的**新值**必须逐项过关才落盘。静默吞掉非法值最坑——
 *     存的是 99999，面板上显示的还是旧端口，人以为存上了。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { DEFAULT_PORT } from './panel-server.js'

export const SETTINGS_FILE = 'settings.json'
export const PORT_MIN = 1024
export const PORT_MAX = 65535

/**
 * 全新的一份。默认值只写在这一处——别在 index.js 或面板里再抄一遍 19388，
 * 那种抄法上一轮审计里刚在拆图目录上栽过一次。
 */
export function emptySettings() {
  return {
    version: 1,
    panel: {
      /* 插件一加载就把独立端口那个面板服务起起来。关掉之后，内嵌浏览器要自己点「启动」。 */
      autoStart: true,
      /* 首选端口。被占就从它往后试 PORT_TRIES 个，面板上显示的永远是真正Listen上的那个。 */
      port: DEFAULT_PORT,
    },
  }
}

function coercePort(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < PORT_MIN || n > PORT_MAX) return DEFAULT_PORT
  return n
}

/** 盘上读回来的东西一律先过这儿：缺项补默认、类型不对退回默认、多出来的字段丢掉。 */
export function normalizeSettings(raw) {
  const base = emptySettings()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const panel = raw.panel && typeof raw.panel === 'object' && !Array.isArray(raw.panel) ? raw.panel : {}
  return {
    version: 1,
    panel: {
      autoStart: typeof panel.autoStart === 'boolean' ? panel.autoStart : base.panel.autoStart,
      port: coercePort(panel.port),
    },
  }
}

export function settingsPath(root) {
  return join(root, SETTINGS_FILE)
}

/** 读一份；不在、坏了、被手改成乱七八糟，都退回默认值，不抛。 */
export function readSettings(root) {
  try {
    return normalizeSettings(JSON.parse(readFileSync(settingsPath(root), 'utf8')))
  } catch {
    return emptySettings()
  }
}

function show(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/**
 * 校验一份**新值**（不是盘上那份）。不合格直接抛，说清哪一项不对。
 * 返回只含认识且通过的那几项，用来往现有设置上盖。
 */
export function validateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置要是一个对象')
  const panel = patch.panel
  if (panel === undefined) return {}
  if (!panel || typeof panel !== 'object' || Array.isArray(panel)) throw new Error('设置里的 panel 要是一个对象')
  const out = {}
  if (panel.autoStart !== undefined) {
    if (typeof panel.autoStart !== 'boolean') {
      throw new Error(`panel.autoStart 只能是 true / false，收到「${show(panel.autoStart)}」`)
    }
    out.autoStart = panel.autoStart
  }
  if (panel.port !== undefined) {
    const n = Number(panel.port)
    if (!Number.isInteger(n) || n < PORT_MIN || n > PORT_MAX) {
      throw new Error(`panel.port 要是 ${PORT_MIN}—${PORT_MAX} 之间的整数，收到「${show(panel.port)}」`)
    }
    out.port = n
  }
  return { panel: out }
}

/** 整份写下去，先落临时文件再改名，跟 Store.write 一个路子。 */
export function writeSettings(root, value) {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  const target = settingsPath(root)
  const tmp = target + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, target)
  return value
}

/** 只改传进来的那几项，其余保持原样；写完把整份返回。非法值在这里抛出去。 */
export function patchSettings(root, patch = {}) {
  const current = readSettings(root)
  const clean = validateSettings(patch)
  return writeSettings(root, {
    version: 1,
    panel: { ...current.panel, ...(clean.panel || {}) },
  })
}
