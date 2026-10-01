/**
 * 表情包图库：把面板里的 `[表情: <描述>]` 换成真图。
 *
 * 起因：面板的对话页把消息整段当纯文本画，教练发出去的表情包（`send_meme` 在 Web 模式
 * 只回一行 `[表情: 描述]`，提示词里明说了「不要加网址」）就原样躺在气泡里，
 * 学生看到一串方括号，不是图。
 *
 * 图从哪来：**不跟 dsh-meme 的 `/dsh-memes-api` 要**。那条接口挂在 DSH 自己的 origin 上，
 * 面板那条独立端口的 origin 够不着（实测 19388 上 404），而 `webServer` 服务只给
 * `register` / `tapIndex`，**不暴露端口**，拼不出 `http://127.0.0.1:<port>`。
 * 所以直接读盘：dsh-meme 把每个包放在一个目录里，`index.db`（SQLite）的 `memes` 表里
 * `caption` 就是描述、`path` 就是图（相对包目录），图片文件就在包目录底下。
 *
 * 这一份只读、认不出来就返回 null；面板拿不到图就照旧画那串方括号文字，不会白屏。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'

const require = createRequire(import.meta.url)

/** 认得的图片后缀。别的（视频、json）一律当没这张。 */
export const MEME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

let sqliteTried = false
let sqlite = null

/** `node:sqlite` 22.5 起才有。老 Node 上取不到就认「这台机器没有图库」，别把插件带崩。 */
function loadSqlite() {
  if (!sqliteTried) {
    sqliteTried = true
    try {
      sqlite = require('node:sqlite')
    } catch {
      sqlite = null
    }
  }
  return sqlite
}

function listDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/**
 * dsh-meme 把图库放哪儿（照它的 `memes.js` 口径）：
 *   · 用户包 → `<DSH_MEME_HOME || home>/.dsh/meme-packs/<包 id>/`
 *   · 内置包 → `<dsh-meme 包>/memes/<包 id>/`（随 profiles 装下来的那份，含 dafeiyu-001）
 * 内置包不在我们的依赖里，只能按 profile 目录扫——扫不到就是没有，不影响自己装的包。
 */
export function defaultPackRoots({ home = homedir(), dshHome = process.env.DSH_HOME || '', env = process.env } = {}) {
  const roots = [join(env.DSH_MEME_HOME || home, '.dsh', 'meme-packs')]
  const profiles = join(dshHome || join(home, '.dsh'), 'profiles')
  for (const name of listDirs(profiles)) roots.push(join(profiles, name, 'node_modules', 'dsh-meme', 'memes'))
  return roots
}

/** 折成能比的形状：去空白、去标点、统一小写。描述里的全半角/标点差异不该影响认图。 */
export function foldMemeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、！？；：,.!?;:'"“”‘’（）()【】\[\]《》<>~～\-—_·]/g, '')
}

function readPackRows(dbFile) {
  const lib = loadSqlite()
  if (!lib || typeof lib.DatabaseSync !== 'function') return []
  let db = null
  try {
    db = new lib.DatabaseSync(dbFile, { readOnly: true })
    const rows = db.prepare('SELECT path, caption, keywords, file_name FROM memes').all()
    return Array.isArray(rows) ? rows : []
  } catch {
    /* 库读不动（锁着、版本怪、不是 sqlite）就当这个包没有 */
    return []
  } finally {
    try {
      if (db) db.close()
    } catch {
      /* 关不掉就算了 */
    }
  }
}

/**
 * @param {object} [options]
 * @param {string[]} [options.roots]   直接指定图库根（测试用；不给就按 dsh-meme 的口径找）
 * @param {string} [options.home]      用户的 home（默认 `os.homedir()`）
 * @param {string} [options.dshHome]   `~/.dsh` 的位置（默认读 `DSH_HOME`）
 * @param {number} [options.ttlMs]     索引缓存多久（默认 5 分钟；图库不常变）
 * @param {() => number} [options.now]
 */
export function createMemes({ roots = null, home, dshHome, env, ttlMs = 5 * 60 * 1000, now = Date.now } = {}) {
  let cache = null

  function packRoots() {
    return Array.isArray(roots) && roots.length ? roots : defaultPackRoots({ home, dshHome, env })
  }

  /** 把盘上所有包的 `memes` 表摊成一张表。读不动、图没了都只是少几行，不抛。 */
  function load() {
    if (cache && now() - cache.at < ttlMs) return cache.rows
    const rows = []
    for (const root of packRoots()) {
      for (const pack of listDirs(root)) {
        const packDir = resolve(join(root, pack))
        const dbFile = join(packDir, 'index.db')
        if (!existsSync(dbFile)) continue
        for (const raw of readPackRows(dbFile)) {
          const rel = String((raw && raw.path) || '')
          if (!rel) continue
          const file = resolve(join(packDir, rel))
          /* 表里的 path 是包自己的相对路径。别让它越出包目录——档案是别人写的，不能全信。 */
          if (file !== packDir && !file.startsWith(packDir + sep)) continue
          const type = MEME_TYPES[extname(file).toLowerCase()]
          if (!type) continue
          const caption = String((raw && raw.caption) || '')
          rows.push({
            pack,
            file,
            type,
            caption,
            fold: foldMemeText(caption),
            words: foldMemeText(raw && raw.keywords),
            name: foldMemeText(raw && raw.file_name),
          })
        }
      }
    }
    cache = { at: now(), rows }
    return rows
  }

  /**
   * 按描述找一行。教练发出去的那串描述是从候选清单里逐字抄的，所以先试精确，
   * 再试「折过之后一样」，然后才退到包含与关键词；认不出来就 null。
   */
  function find(desc) {
    const folded = foldMemeText(desc)
    if (folded.length < 2) return null
    const rows = load()
    if (!rows.length) return null
    for (const row of rows) if (row.fold && row.fold === folded) return row
    let best = null
    for (const row of rows) {
      if (!row.fold) continue
      const inside = row.fold.includes(folded) || (row.fold.length >= 4 && folded.includes(row.fold))
      if (!inside) continue
      /* 挑最短的那个：包含匹配下短的是「更像它自己」的那张，别一上来给最啰嗦的一条 */
      if (!best || row.fold.length < best.fold.length) best = row
    }
    if (best) return best
    const asked = String(desc ?? '')
      .split(/[\s,，、。;；]+/)
      .map((word) => foldMemeText(word))
      .filter((word) => word.length >= 2)
    if (!asked.length) return null
    for (const row of rows) {
      if (asked.every((word) => row.words.includes(word) || row.fold.includes(word) || row.name.includes(word))) return row
    }
    return null
  }

  /** 找图 + 读字节。返回 null 让路由自己回 404。 */
  function image(desc) {
    const row = find(desc)
    if (!row) return null
    try {
      const stat = statSync(row.file)
      if (!stat.isFile()) return null
      return { type: row.type, body: readFileSync(row.file), caption: row.caption, pack: row.pack, bytes: stat.size }
    } catch {
      /* 图被删了/挪走了：把缓存掀了，下次重读一遍 */
      cache = null
      return null
    }
  }

  /** 给自己和测试看的口径：有几个根、几个包、几张图、SQLite 有没有。 */
  function info() {
    const rows = load()
    return {
      roots: packRoots(),
      packs: [...new Set(rows.map((row) => row.pack))],
      count: rows.length,
      sqlite: Boolean(loadSqlite()),
    }
  }

  return { find, image, info, reset: () => { cache = null } }
}
