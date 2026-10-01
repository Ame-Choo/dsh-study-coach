/**
 * 表情包图库那条线：`lib/memes.js` 与 `/study/api/meme`。
 *
 * 面板里 `[表情: 描述]` 要出图。dsh-meme 的图片接口挂在 DSH 自己的 origin 上（面板那条独立端口
 * 够不着），`webServer` 又不给端口，所以这一份自己去读它盘上的 `index.db`。
 * 测试用真的 SQLite（`node:sqlite`）造包：认图要准，读不动的库、越界的 path、非图片后缀、
 * 没有的图都只能是「当没这张」，不能把面板带崩。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createHandler } from '../lib/handler.js'
import { createMemes, defaultPackRoots, foldMemeText } from '../lib/memes.js'
import { createRouter } from '../lib/routes.js'
import { Store } from '../lib/store.js'

let DatabaseSync = null
try {
  ;({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite'))
} catch {
  /* 老 Node 上没有 node:sqlite：下面那些造包的用例直接 skip，实现里也会认「没图库」 */
}
const withSqlite = (name, fn) => (DatabaseSync ? test(name, fn) : test.skip(name, fn))

const CAPTION = '得意闭眼拳头，好耶，小鲸鱼娘很满意'

/** 一个包 + 一个读不动的包。图片是真的两个字节串，够验字节有没有原样发出去。 */
function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), 'study-memes-'))
  const pack = join(root, 'alpha')
  mkdirSync(join(pack, 'memes', 'happy'), { recursive: true })
  writeFileSync(join(pack, 'memes', 'happy', 'deyi.jpg'), Buffer.from('JPEG-DEYI'))
  writeFileSync(join(pack, 'memes', 'happy', 'angry.png'), Buffer.from('PNG-ANGRY'))
  const db = new DatabaseSync(join(pack, 'index.db'))
  db.exec(
    'CREATE TABLE memes ( path TEXT PRIMARY KEY, tag TEXT NOT NULL, file_name TEXT NOT NULL, file_hash TEXT, ' +
      "caption TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '', mtime REAL, captioned_at REAL )",
  )
  const ins = db.prepare('INSERT INTO memes (path, tag, file_name, caption, keywords) VALUES (?, ?, ?, ?, ?)')
  ins.run('memes/happy/deyi.jpg', 'happy', 'deyi.jpg', CAPTION, '得意 好耶 小鲸鱼 拳头')
  ins.run('memes/happy/angry.png', 'happy', 'angry.png', 'Q版柴郡表情愤怒', '柴郡 生气 愤怒')
  /* 不是图片：认了也没法发 */
  ins.run('memes/happy/clip.mp4', 'happy', 'clip.mp4', '视频不算图', '视频')
  /* 越界的路径：档案是别人写的，不能全信 */
  ins.run('../escape.jpg', 'happy', 'escape.jpg', '越界的路径', '越界')
  db.close()
  /* 一个 index.db 不是 sqlite 的包：当它没有，别把别的包一起拖下水 */
  mkdirSync(join(root, 'broken'), { recursive: true })
  writeFileSync(join(root, 'broken', 'index.db'), '这不是 sqlite')
  return root
}

function fresh(extra = {}) {
  const root = makeRoot()
  return { root, memes: createMemes({ roots: [root], ...extra }) }
}

test('描述折成能比的形状：空白、标点、大小写都不算数', () => {
  assert.equal(foldMemeText(' 得意， 闭眼 拳头！'), '得意闭眼拳头')
  assert.equal(foldMemeText('ABC-Def_02'), 'abcdef02')
  assert.equal(foldMemeText(null), '')
})

test('图库根：用户包在 .dsh/meme-packs，内置包按 profile 扫 dsh-meme 包里那份', () => {
  const home = mkdtempSync(join(tmpdir(), 'study-memes-home-'))
  const profiles = join(home, '.dsh', 'profiles')
  mkdirSync(join(profiles, 'desktop', 'node_modules', 'dsh-meme', 'memes'), { recursive: true })
  const roots = defaultPackRoots({ home, dshHome: join(home, '.dsh') })
  assert.deepEqual(roots, [
    join(home, '.dsh', 'meme-packs'),
    join(profiles, 'desktop', 'node_modules', 'dsh-meme', 'memes'),
  ])
  /* DSH_MEME_HOME 说了算——它跟 DSH_HOME 不是一回事 */
  const moved = defaultPackRoots({ home, dshHome: join(home, '.dsh'), env: { DSH_MEME_HOME: 'D:\\图库' } })
  assert.equal(moved[0], join('D:\\图库', '.dsh', 'meme-packs'))
  rmSync(home, { recursive: true, force: true })
})

withSqlite('按描述认图：先精确，再包含，再关键词；非图片与越界的不算数', () => {
  const { root, memes } = fresh()
  /* 逐字抄回来的那句（标点/空格不同也算） */
  assert.equal(memes.image(CAPTION).body.toString(), 'JPEG-DEYI')
  assert.equal(memes.image('得意闭眼拳头 好耶 小鲸鱼娘很满意').caption, CAPTION)
  /* 描述是这一张、外面还裹了别的话——反向包含 */
  assert.equal(memes.image('上面那张 Q版柴郡表情愤怒 就挺好').pack, 'alpha')
  /* 只给了关键词 */
  assert.equal(memes.image('柴郡 生气').caption, 'Q版柴郡表情愤怒')
  /* 视频行、越界行压根不该进索引 */
  assert.deepEqual(memes.info().packs, ['alpha'])
  assert.equal(memes.info().count, 2)
  assert.equal(memes.image('视频不算图'), null)
  assert.equal(memes.image('越界的路径'), null)
  /* 没见过的一张 */
  assert.equal(memes.image('紫色独角兽在天上飞'), null)
  /* 太短的不猜 */
  assert.equal(memes.image('好'), null)
  /* 读不动的那个包不影响这个包 */
  assert.equal(memes.info().sqlite, true)
  rmSync(root, { recursive: true, force: true })
})

withSqlite('图没了就是 null（顺手掀掉缓存），索引本身缓存一会儿', () => {
  const { root, memes } = fresh()
  assert.equal(memes.info().count, 2)
  /* 加一个新包：缓存期内不该看见它，reset() 之后才认 */
  const later = join(root, 'beta')
  mkdirSync(join(later, 'memes'), { recursive: true })
  const db = new DatabaseSync(join(later, 'index.db'))
  db.exec("CREATE TABLE memes ( path TEXT PRIMARY KEY, caption TEXT NOT NULL DEFAULT '', keywords TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '' )")
  db.prepare('INSERT INTO memes (path, caption, keywords, file_name) VALUES (?, ?, ?, ?)').run('memes/new.png', '新的', '新', 'new.png')
  db.close()
  assert.equal(memes.info().count, 2)
  memes.reset()
  assert.equal(memes.info().count, 3)
  /* 图被删了：找不到字节就回 null，缓存也掀了（另一张还在，那条不受影响） */
  rmSync(join(root, 'alpha', 'memes', 'happy', 'deyi.jpg'))
  assert.equal(memes.image(CAPTION), null)
  assert.equal(memes.image('Q版柴郡表情愤怒').body.toString(), 'PNG-ANGRY')
  rmSync(root, { recursive: true, force: true })
})

withSqlite('图库根不存在 / 路径直接给错：认成「没图库」，不抛', () => {
  const memes = createMemes({ roots: [join(tmpdir(), 'study-memes-nope-' + Date.now())] })
  assert.equal(memes.info().count, 0)
  assert.deepEqual(memes.info().packs, [])
  assert.equal(memes.find('随便什么'), null)
  assert.equal(memes.image('随便什么'), null)
})

withSqlite('HTTP：/study/api/meme 把字节原样发出去，找不到 404，没接图库 503', async () => {
  const { root, memes } = fresh()
  const store = new Store(mkdtempSync(join(tmpdir(), 'study-memes-store-')))
  const assets = fileURLToPath(new URL('../assets', import.meta.url))
  const served = createHandler(store, createRouter(store, { memes }), { assetsDir: assets })
  const bare = createHandler(store, createRouter(store, {}), { assetsDir: assets })

  /** 起一个只服务一次的服务器：`fetch` 完把正文读进来再关，省得连接悬着。 */
  async function get(handler, path) {
    const server = createServer((req, res) => {
      void handler(req, res)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`)
      const text = await res.text()
      return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), text }
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }

  try {
    const hit = await get(served, `/study/api/meme?q=${encodeURIComponent(CAPTION)}`)
    assert.equal(hit.status, 200)
    assert.equal(hit.type, 'image/jpeg')
    assert.equal(hit.cache, 'public, max-age=86400')
    assert.equal(hit.text, 'JPEG-DEYI')

    const miss = await get(served, `/study/api/meme?q=${encodeURIComponent('紫色独角兽在天上飞')}`)
    assert.equal(miss.status, 404)
    assert.match(miss.text, /图库里没有这一张/)

    const empty = await get(served, '/study/api/meme')
    assert.equal(empty.status, 400)
    assert.match(empty.text, /要一张图得给描述/)

    /* 这个进程没接图库（缺 deps.memes）：说清楚，别让面板一直转圈 */
    const none = await get(bare, '/study/api/meme?q=%E9%9A%8F%E4%BE%BF')
    assert.equal(none.status, 503)
    assert.match(none.text, /没接表情包图库/)

    const info = JSON.parse((await get(served, '/study/api/meme/info')).text)
    assert.equal(info.ok, true)
    assert.equal(info.count, 2)
    assert.deepEqual(info.packs, ['alpha'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
