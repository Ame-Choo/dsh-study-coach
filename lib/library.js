/**
 * dsh-study-coach — 档案库。
 *
 * 一个学习目标一个档案，档案是 `profiles/<id>/` 里的一个文件夹。
 * 这一层管的是「有哪几个档案、现在用哪个、新建、改名、删掉」，
 * 具体某个档案里的读写还是 lib/store.js 的 Store。
 *
 * 关键一点：Library 把 Store 的接口**原样代理**了（read / write / update /
 * default / path / materialsDir / snapshot），所以在路由和工具那头，
 * 拿到的不管是 Store 还是 Library，代码都不用改——单档案那套测试也照跑。
 *
 * 删档案是软删：整份挪到 `trash/`，不 rm。学生点错一次不该没了一晚上的记录。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { FILES, Store, listPointIds, progressOf } from './store.js'

export const LIBRARY_FILE = 'registry.json'
export const PROFILES_DIR = 'profiles'
export const TRASH_DIR = 'trash'
export const DEFAULT_PROFILE_ID = 'default'
/** 回收站里每个条目自己带的小纸条：恢复时靠它才知道原来的 id。 */
export const TRASH_MANIFEST = 'manifest.json'

function nowIso() {
  return new Date().toISOString()
}

function newId() {
  return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36)
}

function text(value) {
  return String(value ?? '').trim()
}

/** 目录名只留安全字符，档案 id 是内部生成的，这里只是兜底防手改出花样。 */
function safeId(id) {
  const clean = String(id ?? '').trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(clean)) throw new Error('档案 id 不合法: ' + clean)
  return clean
}

/** 读一份 JSON，读不到或者坏了都给 null——回收站里全是历史遗留，不能因为一份坏文件整段不认。 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 老条目只能从目录名 `<id>-<时间戳>` 猜 id：去掉最后一段。
 * id 里本身带 `-` 会猜错——所以新条目一律写 manifest，目录名只是最后的兜底。
 */
function splitEntry(entry) {
  const idx = entry.lastIndexOf('-')
  if (idx <= 0) return { id: entry, at: '' }
  const id = entry.slice(0, idx)
  const ms = parseInt(entry.slice(idx + 1), 36)
  const at = Number.isFinite(ms) && ms > 946684800000 && ms < 4102444800000 ? new Date(ms).toISOString() : ''
  return { id, at }
}

function mtimeIso(dir) {
  try {
    return statSync(dir).mtime.toISOString()
  } catch {
    return ''
  }
}

/** manifest 里的计数优先，没有或者不是数才回去数地图。 */
function countOf(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export class Library {
  constructor(root) {
    this.root = root
    this._stores = new Map()
  }

  profilesDir() {
    return join(this.root, PROFILES_DIR)
  }

  trashDir() {
    return join(this.root, TRASH_DIR)
  }

  registryPath() {
    return join(this.root, LIBRARY_FILE)
  }

  /** 该有的目录和文件都补齐；顺手把老版本的单档案搬进 profiles/default。 */
  ensure() {
    if (!existsSync(this.root)) mkdirSync(this.root, { recursive: true })
    this._migrateLegacy()
    if (!existsSync(this.profilesDir())) mkdirSync(this.profilesDir(), { recursive: true })

    const reg = this.readRegistry()
    let dirty = false
    if (!reg.items.length) {
      const store = new Store(join(this.profilesDir(), DEFAULT_PROFILE_ID))
      store.ensure()
      reg.items.push(this._freshItem(DEFAULT_PROFILE_ID, store))
      reg.active = DEFAULT_PROFILE_ID
      dirty = true
    }
    if (!reg.items.some((item) => item.id === reg.active)) {
      reg.active = reg.items[0].id
      dirty = true
    }
    for (const item of reg.items) {
      if (this.store(item.id).ensure()) dirty = true
    }
    if (dirty) this.writeRegistry(reg)
    return reg
  }

  /** 老版本：profile.json 直接躺在 root 下。搬进子目录，原样不动内容。 */
  _migrateLegacy() {
    const legacyProfile = join(this.root, FILES.profile)
    if (!existsSync(legacyProfile)) return
    if (existsSync(this.profilesDir())) return
    const target = join(this.profilesDir(), DEFAULT_PROFILE_ID)
    mkdirSync(target, { recursive: true })
    for (const name of Object.values(FILES)) {
      const from = join(this.root, name)
      if (!existsSync(from)) continue
      renameSync(from, join(target, name))
    }
    const legacyMaterials = join(this.root, 'materials')
    if (existsSync(legacyMaterials)) renameSync(legacyMaterials, join(target, 'materials'))
    // 根下可能还留着 .bak / .tmp，留在原地，别跟着搬。
  }

  readRegistry() {
    try {
      const parsed = JSON.parse(readFileSync(this.registryPath(), 'utf8'))
      if (parsed && Array.isArray(parsed.items)) {
        return {
          version: 1,
          active: text(parsed.active),
          items: parsed.items.filter((item) => item && item.id),
        }
      }
    } catch {
      /* 第一次跑，或者文件坏了——当空库重建 */
    }
    return { version: 1, active: '', items: [] }
  }

  writeRegistry(registry) {
    const path = this.registryPath()
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8')
    renameSync(tmp, path)
    return registry
  }

  /** 档案里没写过名字就拿学科当名字，够用了。 */
  _freshItem(id, store) {
    const profile = store.read('profile')
    return {
      id,
      title: text(profile?.goal?.subject) || '新的学习目标',
      createdAt: profile?.createdAt || nowIso(),
      updatedAt: profile?.updatedAt || nowIso(),
    }
  }

  store(id) {
    const key = safeId(id)
    if (!this._stores.has(key)) this._stores.set(key, new Store(join(this.profilesDir(), key)))
    return this._stores.get(key)
  }

  activeId() {
    const reg = this.readRegistry()
    return reg.items.some((item) => item.id === reg.active) ? reg.active : (reg.items[0]?.id ?? DEFAULT_PROFILE_ID)
  }

  activeStore() {
    return this.store(this.activeId())
  }

  /** 面板上的档案列表：每个档案一行，带规模与进度，够它画卡片了。 */
  list() {
    const reg = this.readRegistry()
    const active = this.activeId()
    return reg.items.map((item) => {
      const store = this.store(item.id)
      const map = store.read('map')
      const mastery = store.read('mastery')
      const ids = listPointIds(map)
      const profile = store.read('profile')
      return {
        id: item.id,
        title: text(item.title) || '没起名的学习目标',
        subject: text(profile?.goal?.subject),
        outcome: text(profile?.goal?.outcome),
        minutesPerDay: Number(profile?.goal?.minutesPerDay) || 0,
        modules: Array.isArray(map?.modules) ? map.modules.length : 0,
        points: ids.length,
        progress: progressOf(map, mastery, ids),
        createdAt: item.createdAt ?? null,
        updatedAt: item.updatedAt ?? null,
        active: item.id === active,
      }
    })
  }

  create(input = {}) {
    const id = newId()
    const store = this.store(id)
    store.ensure()
    const profile = store.read('profile')
    const subject = text(input.subject ?? input.title)
    profile.goal = {
      subject,
      outcome: text(input.outcome),
      deadline: text(input.deadline),
      minutesPerDay: Number.isFinite(Number(input.minutesPerDay)) ? Number(input.minutesPerDay) : 60,
    }
    store.write('profile', profile)

    const reg = this.readRegistry()
    reg.items.push({
      id,
      title: text(input.title) || subject || '新的学习目标',
      createdAt: profile.createdAt || nowIso(),
      updatedAt: nowIso(),
    })
    reg.active = id
    this.writeRegistry(reg)
    return { id, title: text(input.title) || subject || '新的学习目标', active: true }
  }

  select(id) {
    const key = safeId(id)
    const reg = this.readRegistry()
    if (!reg.items.some((item) => item.id === key)) throw new Error('没有这个档案: ' + key)
    reg.active = key
    this.writeRegistry(reg)
    return key
  }

  rename(id, patch = {}) {
    const key = safeId(id)
    const reg = this.readRegistry()
    const item = reg.items.find((it) => it.id === key)
    if (!item) throw new Error('没有这个档案: ' + key)
    if (patch.title !== undefined) item.title = text(patch.title) || item.title
    item.updatedAt = nowIso()
    this.writeRegistry(reg)
    return item
  }

  /**
   * 删档案。默认软删（整份挪进 trash/），要真删就传 hard。
   * 最后一个档案删不掉——库空了面板就没得看了。
   */
  remove(id, { hard = false } = {}) {
    const key = safeId(id)
    const reg = this.readRegistry()
    const item = reg.items.find((it) => it.id === key)
    if (!item) throw new Error('没有这个档案: ' + key)
    if (reg.items.length <= 1) throw new Error('这是最后一个档案，删了就没得看了；想清空内容用重置')

    const dir = join(this.profilesDir(), key)
    if (existsSync(dir)) {
      if (hard) {
        rmSync(dir, { recursive: true, force: true })
      } else {
        if (!existsSync(this.trashDir())) mkdirSync(this.trashDir(), { recursive: true })
        // 数好规模、留好名字再挪——挪完这一份东西就只躺在回收站里了。
        const profile = readJson(join(dir, FILES.profile))
        const counts = this._countsOf(dir)
        const target = join(this.trashDir(), key + '-' + Date.now().toString(36))
        renameSync(dir, target)
        const manifest = {
          id: key,
          title: text(item.title) || text(profile?.goal?.subject) || key,
          subject: text(profile?.goal?.subject),
          at: nowIso(),
          modules: counts.modules,
          points: counts.points,
        }
        // 纸条写不进去也不能让「删档案」这件事失败，目录名还认得出来。
        try {
          writeFileSync(join(target, TRASH_MANIFEST), JSON.stringify(manifest, null, 2), 'utf8')
        } catch {
          /* 兜底：trash() 会退回从 profile.json / map.json 里读 */
        }
      }
    }
    this._stores.delete(key)
    reg.items = reg.items.filter((it) => it.id !== key)
    if (reg.active === key) reg.active = reg.items[0].id
    this.writeRegistry(reg)
    return { id: key, active: reg.active, remaining: reg.items.length }
  }

  /** 数一个档案目录的规模：几个模块、几个知识点。读不出来就 0，不抛。 */
  _countsOf(dir) {
    const map = readJson(join(dir, FILES.map))
    return {
      modules: Array.isArray(map?.modules) ? map.modules.length : 0,
      points: listPointIds(map).length,
    }
  }

  /**
   * 回收站里有什么。优先读 manifest；老条目没那张纸条就从档案文件里回读，
   * id 只能靠目录名猜。扫不动的那一条不拖垮整张表，单独给个带 error 的项。
   */
  trash() {
    let names = []
    try {
      names = readdirSync(this.trashDir(), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    } catch {
      return [] // 还没删过东西，就是空
    }

    const rows = []
    for (const entry of names) {
      try {
        rows.push(this._trashItem(entry))
      } catch (err) {
        rows.push({ entry, id: '', title: entry, subject: '', at: '', modules: 0, points: 0, error: String((err && err.message) || err) })
      }
    }
    return rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')) || a.entry.localeCompare(b.entry))
  }

  _trashItem(entry) {
    const dir = join(this.trashDir(), entry)
    const manifest = readJson(join(dir, TRASH_MANIFEST))
    const profile = readJson(join(dir, FILES.profile))
    const counts = this._countsOf(dir)
    const guess = splitEntry(entry)
    const fallbackId = guess.id || entry
    return {
      entry,
      id: text(manifest?.id) || text(profile?.id) || fallbackId,
      title: text(manifest?.title) || text(profile?.goal?.subject) || text(profile?.title) || fallbackId,
      subject: text(manifest?.subject) || text(profile?.goal?.subject) || '',
      at: text(manifest?.at) || guess.at || mtimeIso(dir),
      modules: countOf(manifest?.modules, counts.modules),
      points: countOf(manifest?.points, counts.points),
    }
  }

  /**
   * 把回收站里的一条挪回 profiles/，重新登记进名册。
   * 目标 id 被占了就得当场报错——绝不允许覆盖掉现在正在用的档案。
   */
  restore(entry, options = {}) {
    const name = text(entry)
    if (!name || name === '.' || name === '..' || name !== basename(name)) throw new Error('回收站条目名不对: ' + name)
    const src = join(this.trashDir(), name)
    if (!existsSync(src)) throw new Error('回收站里没有这个条目: ' + name)

    const meta = this._trashItem(name)
    const wanted = text(options?.id) || meta.id || name
    let key
    try {
      key = safeId(wanted)
    } catch {
      throw new Error('恢复用的档案 id 不合法: ' + wanted)
    }

    const dest = join(this.profilesDir(), key)
    if (existsSync(dest)) throw new Error('已经有一个叫 ' + key + ' 的档案了，换个 id 或者先把它挪走')

    if (!existsSync(this.profilesDir())) mkdirSync(this.profilesDir(), { recursive: true })
    renameSync(src, dest)
    // 纸条跟着挪进来了，它只属于回收站，别留在正在用的档案里。
    rmSync(join(dest, TRASH_MANIFEST), { force: true })
    this._stores.delete(key)

    const store = new Store(dest)
    store.ensure()
    const profile = store.read('profile')

    const reg = this.readRegistry()
    reg.items.push({
      id: key,
      title: text(meta.title) || text(profile?.goal?.subject) || key,
      createdAt: profile?.createdAt || nowIso(),
      updatedAt: nowIso(),
    })
    if (!reg.items.some((it) => it.id === reg.active)) reg.active = key
    this.writeRegistry(reg)

    return { ok: true, profile: this.list().find((p) => p.id === key) || null }
  }

  /* ── Store 接口代理：路由和工具那头不用区分拿到的是谁 ─────────────────── */

  read(key) {
    return this.activeStore().read(key)
  }

  write(key, value) {
    return this.activeStore().write(key, value)
  }

  update(key, fn) {
    return this.activeStore().update(key, fn)
  }

  default(key) {
    return this.activeStore().default(key)
  }

  path(key) {
    return this.activeStore().path(key)
  }

  materialsDir() {
    return this.activeStore().materialsDir()
  }

  snapshot() {
    const snap = this.activeStore().snapshot()
    const active = this.activeId()
    return {
      ...snap,
      libraryRoot: this.root,
      profileId: active,
      profiles: this.list(),
    }
  }
}
