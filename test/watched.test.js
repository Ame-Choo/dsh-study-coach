import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { addWatch, watchCount, watchKey, watchedIn } from '../lib/watched.js'
import { createRouter } from '../lib/routes.js'

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-watched-'))
  const store = new Store(root)
  store.ensure()
  const router = createRouter(store, { pagesRoot: join(root, 'pages'), spawnBuild: () => ({ pid: 1 }) })
  return {
    root,
    store,
    call: (method, pathname, body = {}, query = {}) => router({ method, pathname, body, query }),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

test('「看完了」这本账：一条一记、同一条再点只挪时间，各材料分开算', () => {
  assert.equal(watchKey('mat-1', 'F:\\课件\\01.mp4'), 'mat-1|F:\\课件\\01.mp4')
  assert.equal(watchKey('', ''), '?|')

  let doc = { marks: {} }
  doc = addWatch(doc, { materialId: 'mat-1', key: 'a.mp4', title: '01.集合.mp4', pointId: 'M1.1', at: '2026-10-01T00:00:00.000Z' })
  doc = addWatch(doc, { materialId: 'mat-1', key: 'b.mp4', title: '02.逻辑.mp4', at: '2026-10-01T01:00:00.000Z' })
  doc = addWatch(doc, { materialId: 'mat-2', key: 'a.mp4', title: '别的材料里同名的一讲', at: '2026-10-01T02:00:00.000Z' })
  // 同一条再点一次：不是又记一条，是把那条的时间往前挪
  const again = addWatch(doc, { materialId: 'mat-1', key: 'a.mp4', title: '01.集合.mp4', pointId: 'M1.1', at: '2026-10-02T03:00:00.000Z' })

  assert.equal(Object.keys(again.marks).length, 3)
  assert.equal(again.marks['mat-1|a.mp4'].at, '2026-10-02T03:00:00.000Z')
  assert.equal(again.marks['mat-1|a.mp4'].pointId, 'M1.1')
  assert.equal(watchCount(again, 'mat-1'), 2)
  assert.equal(watchCount(again, 'mat-2'), 1)
  assert.equal(watchCount(again, 'mat-3'), 0)
  assert.deepEqual(Object.keys(watchedIn(again, 'mat-1')).sort(), ['a.mp4', 'b.mp4'])
  assert.deepEqual(watchedIn(again, 'mat-nope'), {})
  // 原来那份没被改（store 的 update 靠这点判「变没变」）
  assert.equal(Object.keys(doc.marks).length, 3)
  assert.equal(doc.marks['mat-1|a.mp4'].at, '2026-10-01T00:00:00.000Z')
})

test('写一笔「看完了」：记进账本，并把话递给教练；缺材料或缺条目就直说', async () => {
  const f = fresh()
  try {
    const bad = await f.call('POST', '/study/api/watched', { materialId: 'mat-1' })
    assert.match(bad.body.error.message, /materialId and key required/)

    const res = await f.call('POST', '/study/api/watched', {
      materialId: 'mat-1',
      key: 'F:\\课件\\01.mp4',
      title: '01.集合.mp4',
      pointId: 'M1.1',
      materialTitle: '一轮课程',
    })
    assert.equal(res.body.ok, true)
    assert.equal(res.body.watched['F:\\课件\\01.mp4'].title, '01.集合.mp4')
    assert.equal(res.body.watched['F:\\课件\\01.mp4'].pointId, 'M1.1')
    // 测试里没接投递通道：记是记下了，话没送出去，得如实说
    assert.equal(res.body.pushed, false)
    assert.equal(res.body.pushError, '没有投递通道')
    assert.equal(f.store.read('watched').marks['mat-1|F:\\课件\\01.mp4'].title, '01.集合.mp4')

    // 再点一次：同一条，不增生
    await f.call('POST', '/study/api/watched', { materialId: 'mat-1', key: 'F:\\课件\\01.mp4', title: '01.集合.mp4' })
    assert.equal(Object.keys(f.store.read('watched').marks).length, 1)
  } finally {
    f.done()
  }
})

test('资料图谱那一页拿得到「看完」的账：这条材料的键 → 记录', async () => {
  const f = fresh()
  try {
    const dir = join(f.root, 'course')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '01.集合的概念.mp4'), 'x')
    f.store.update('profile', (p) => ({
      ...p,
      materials: [{ id: 'mat-v', kind: 'video', title: '一轮课程', path: dir, note: '' }],
    }))

    const key = '/study/file?path=' + encodeURIComponent(join(dir, '01.集合的概念.mp4'))
    await f.call('POST', '/study/api/watched', { materialId: 'mat-v', key, title: '01.集合的概念.mp4', at: '2026-10-01T00:00:00.000Z' })

    const tree = await f.call('GET', '/study/api/material/tree', {}, { materialId: 'mat-v' })
    assert.equal(tree.body.ok, true)
    assert.equal(tree.body.basis, 'folder')
    assert.equal(tree.body.watched[key].title, '01.集合的概念.mp4')
    // 别的材料那份账不该串过来
    const other = await f.call('GET', '/study/api/material/tree', {}, { materialId: 'mat-nope' })
    assert.equal(other.body.ok, false)
  } finally {
    f.done()
  }
})
