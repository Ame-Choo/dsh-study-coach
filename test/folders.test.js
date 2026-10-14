/**
 * 资料文件夹：书架上的分组。
 *
 * 分两层测：
 *   1) lib/folders.js 那份纯逻辑（建 / 改名 / 删 / 挪 / 默认落哪儿）；
 *   2) 路由那一层（面板真的会点的那几条），外加「AI 出的卷自动进教练产出」。
 *
 * 用法：node --test test/folders.test.js
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../lib/store.js'
import { createRouter } from '../lib/routes.js'
import {
  COACH_FOLDER,
  addFolder,
  ensureFolder,
  folderForNew,
  groupMaterials,
  moveMaterials,
  normalizeFolders,
  removeFolder,
  renameFolder,
} from '../lib/folders.js'

function fresh() {
  const root = mkdtempSync(join(tmpdir(), 'study-folders-'))
  const store = new Store(root)
  store.ensure()
  const router = createRouter(store, { pagesRoot: join(root, 'pages') })
  return {
    root,
    store,
    call: (method, pathname, body) => router({ method, pathname, body, query: {} }),
    done: () => rmSync(root, { recursive: true, force: true }),
  }
}

function seed(store, materials) {
  store.update('profile', (p) => {
    p.materials = materials.map((m) => ({ note: '', addedAt: '2026-01-01T00:00:00.000Z', ...m }))
    return p
  })
}

test('空档案里就有 folders 这个字段', () => {
  const f = fresh()
  try {
    assert.deepEqual(f.store.read('profile').folders, [])
  } finally {
    f.done()
  }
})

test('建文件夹：重名报错，名字两头的空白剪掉', () => {
  const profile = { materials: [] }
  const { id } = addFolder(profile, '  必修一  ')
  assert.equal(normalizeFolders(profile)[0].title, '必修一')
  assert.throws(() => addFolder(profile, '必修一'), /已经有/)
  assert.equal(ensureFolder(profile, '必修一'), id)
})

test('改名：认 id 也认名字；跟别的夹子重名报错', () => {
  const profile = { materials: [] }
  const a = addFolder(profile, 'A').id
  addFolder(profile, 'B')
  renameFolder(profile, a, 'A2')
  assert.equal(normalizeFolders(profile).find((f) => f.id === a).title, 'A2')
  assert.throws(() => renameFolder(profile, a, 'B'), /已经有/)
  assert.throws(() => renameFolder(profile, 'fld-none', 'C'), /没有这个文件夹/)
})

test('删文件夹不删材料：里头的退回未分组', () => {
  const profile = { materials: [{ id: 'm1', folder: '' }, { id: 'm2', folder: '' }] }
  const a = addFolder(profile, 'A').id
  const b = addFolder(profile, 'B').id
  moveMaterials(profile, ['m1'], a)
  moveMaterials(profile, ['m2'], b)
  const out = removeFolder(profile, a)
  assert.equal(out.moved, 1)
  assert.equal(profile.materials.find((m) => m.id === 'm1').folder, '')
  assert.equal(profile.materials.find((m) => m.id === 'm2').folder, b)
  assert.equal(normalizeFolders(profile).length, 1)
})

test('挪材料：给 id 或名字都行，空串退回未分组，认不出的夹子报错', () => {
  const profile = { materials: [{ id: 'm1', folder: '' }] }
  const a = addFolder(profile, 'A').id
  moveMaterials(profile, ['m1'], 'A')
  assert.equal(profile.materials[0].folder, a)
  moveMaterials(profile, 'm1', '')
  assert.equal(profile.materials[0].folder, '')
  assert.throws(() => moveMaterials(profile, ['m1'], '不存在的夹子'), /没有这个文件夹/)
  assert.throws(() => moveMaterials(profile, ['不存在的材料'], a), /没有材料/)
})

test('新登记落哪儿：AI 出的卷进「教练产出」，其余未分组，显式给了听显式的', () => {
  const profile = { materials: [] }
  const ai = folderForNew(profile, { kind: 'ai' })
  assert.equal(normalizeFolders(profile).find((f) => f.id === ai).title, COACH_FOLDER)
  assert.equal(folderForNew(profile, { kind: 'book' }), '')
  const mine = folderForNew(profile, { kind: 'book', folder: '我自己建的' })
  assert.equal(normalizeFolders(profile).find((f) => f.id === mine).title, '我自己建的')
})

test('分组视图：每份材料只出现一次，没归组的兜在 ungrouped 里', () => {
  const profile = { materials: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] }
  const a = addFolder(profile, 'A').id
  moveMaterials(profile, ['m1', 'm2'], a)
  const g = groupMaterials(profile)
  assert.deepEqual(g.folders[0].items, ['m1', 'm2'])
  assert.deepEqual(g.ungrouped, ['m3'])
})

test('路由：建 / 改名 / 删 / 挪，以及书架接口把文件夹带上', async () => {
  const f = fresh()
  try {
    seed(f.store, [{ id: 'mat-1', kind: 'book', title: '一本通' }])

    const made = await f.call('POST', '/study/api/folders', { action: 'add', title: '必修一' })
    assert.equal(made.code, 200)
    const fid = made.body.folders[0].id
    assert.equal(made.body.folders[0].title, '必修一')

    const listed = await f.call('GET', '/study/api/folders')
    assert.equal(listed.body.folders.length, 1)

    const moved = await f.call('POST', '/study/api/materials/folder', { id: 'mat-1', folder: '必修一' })
    assert.equal(moved.code, 200)
    assert.deepEqual(moved.body.groups.folders[0].items, ['mat-1'])

    // 书名 → 认名字；写个新名字会现建一个
    const moved2 = await f.call('POST', '/study/api/materials/folder', { id: 'mat-1', folder: '新夹子' })
    assert.equal(moved2.body.folders.length, 2)

    const back = await f.call('POST', '/study/api/materials/folder', { id: 'mat-1', folder: '' })
    assert.deepEqual(back.body.groups.ungrouped, ['mat-1'])

    const renamed = await f.call('POST', '/study/api/folders', { action: 'rename', id: fid, title: '必修一上' })
    assert.equal(renamed.body.folders.find((x) => x.id === fid).title, '必修一上')

    const dropped = await f.call('POST', '/study/api/folders', { action: 'remove', id: fid })
    assert.equal(dropped.code, 200)
    assert.equal(dropped.body.folders.length, 1)

    const shelf = await f.call('GET', '/study/api/materials')
    assert.equal(shelf.body.materials.length, 1)
    assert.ok(Array.isArray(shelf.body.folders))
    assert.equal(typeof shelf.body.materials[0].folder, 'string')
  } finally {
    f.done()
  }
})

test('路由：重名 / 缺 id / 瞎 action 都回 400，别默默吞掉', async () => {
  const f = fresh()
  try {
    await f.call('POST', '/study/api/folders', { action: 'add', title: 'A' })
    const dup = await f.call('POST', '/study/api/folders', { action: 'add', title: 'A' })
    assert.equal(dup.code, 400)
    const noId = await f.call('POST', '/study/api/materials/folder', { folder: 'A' })
    assert.equal(noId.code, 400)
    const weird = await f.call('POST', '/study/api/folders', { action: '翻转', id: 'x' })
    assert.equal(weird.code, 400)
  } finally {
    f.done()
  }
})

test('路由：登记 kind=ai 的材料，自动落进「教练产出」', async () => {
  const f = fresh()
  try {
    const out = await f.call('POST', '/study/api/materials', { kind: 'ai', title: '随堂小测' })
    assert.equal(out.code, 200)
    const folders = out.body.folders
    assert.equal(folders.length, 1)
    assert.equal(folders[0].title, COACH_FOLDER)
    assert.equal(out.body.material.folder, folders[0].id)
  } finally {
    f.done()
  }
})
