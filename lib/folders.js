/**
 * dsh-study-coach — 资料文件夹（书架上的分组）。
 *
 * 书架上登记的材料一多就成一长条，找一份得从头翻到尾。文件夹是**纯收纳**：
 * 谁进哪个夹子，跟「这份材料是教辅还是网课」「拆到第几页」「归了哪些单元」
 * 都没有关系——那些还是照旧按 kind / 进度画，别把两件事揉在一起。
 *
 * 存在哪儿：`profile.folders`，每条 `{ id, title, at }`。材料那头的字段是
 * `material.folder`，存的是**文件夹 id**，空串 / 缺字段 = 未分组（书架末尾那一摞）。
 * 存 id 不存名字：改个名不该牵动每份材料。
 *
 * 为什么要单独一层：路由（面板）和工具（对话）两边都要建夹子、改名、挪材料，
 * 各自写一遍迟早对不齐（一边 trim 了名字一边没 trim，就会出现两个「教辅」）。
 * 所以规矩都写在这儿，两边都调它。
 */
import { uniqueId } from './ids.js'

/** 材料那个字段的空值：没归到任何文件夹。 */
export const UNGROUPED = ''

/**
 * 教练自己产出的东西默认进这个夹子（AI 出的卷子、复盘、计划）。
 *
 * 学生嘴里的「一本通」和我给他出的卷子在书架上从来不平等——一个是买来的、
 * 一个是今天现做的。默认分开，但只是默认：他想挪到别处就挪。
 */
export const COACH_FOLDER = '教练产出'

/** 按 kind 默认落哪个夹子；没列到的就是未分组。 */
export const DEFAULT_FOLDER_BY_KIND = { ai: COACH_FOLDER }

/** 文件夹名最长多少字。太长的名字会把书架那一行撑爆，剪掉多余的空白就够了。 */
const MAX_TITLE = 24

function cleanTitle(raw) {
  return String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE)
}

/** 档案里的文件夹清单，去脏之后的只读副本。 */
export function normalizeFolders(profile) {
  const list = profile && Array.isArray(profile.folders) ? profile.folders : []
  const seen = new Set()
  const out = []
  for (const f of list) {
    if (!f || !f.id) continue
    const id = String(f.id)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ id, title: cleanTitle(f.title) || '未命名', at: f.at || null })
  }
  return out
}

/** 按 id 找；找不到再按名字找（名字是给对话那头的我用的，id 是面板用的）。 */
export function findFolder(profile, key) {
  const raw = String(key == null ? '' : key).trim()
  if (!raw) return null
  const list = normalizeFolders(profile)
  return list.find((f) => f.id === raw) || list.find((f) => f.title === cleanTitle(raw)) || null
}

/** 名字 → id，没有就建一个。空名字回空串（= 未分组），不建。 */
export function ensureFolder(profile, title) {
  const name = cleanTitle(title)
  if (!name) return UNGROUPED
  if (!Array.isArray(profile.folders)) profile.folders = []
  const hit = findFolder(profile, name)
  if (hit) return hit.id
  const id = uniqueId('fld-', profile.folders)
  profile.folders.push({ id, title: name, at: new Date().toISOString() })
  return id
}

/**
 * 「文件夹名或 id」→ id。认不出来又不许新建就回空串。
 * 面板传 id、对话里传名字，两边都从这儿过。
 */
export function folderIdFor(profile, key, { create = true } = {}) {
  const raw = String(key == null ? '' : key).trim()
  if (!raw) return UNGROUPED
  const hit = findFolder(profile, raw)
  if (hit) return hit.id
  return create ? ensureFolder(profile, raw) : UNGROUPED
}

/** 新建一个夹子。重名直接报错——不然书架上会冒出两个同名分组。 */
export function addFolder(profile, title) {
  const name = cleanTitle(title)
  if (!name) throw new Error('文件夹得有个名字')
  if (findFolder(profile, name)) throw new Error(`已经有「${name}」这个文件夹了`)
  const id = ensureFolder(profile, name)
  return { id, folders: normalizeFolders(profile) }
}

export function renameFolder(profile, id, title) {
  const name = cleanTitle(title)
  if (!name) throw new Error('文件夹得有个名字')
  const hit = findFolder(profile, id)
  if (!hit) throw new Error(`没有这个文件夹「${String(id)}」`)
  const clash = findFolder(profile, name)
  if (clash && clash.id !== hit.id) throw new Error(`已经有「${name}」这个文件夹了`)
  profile.folders = normalizeFolders(profile).map((f) => (f.id === hit.id ? { ...f, title: name } : f))
  return { id: hit.id, folders: normalizeFolders(profile) }
}

/** 删夹子**不删材料**：里头的材料退回未分组，书架末尾还找得到。 */
export function removeFolder(profile, id) {
  const hit = findFolder(profile, id)
  if (!hit) throw new Error(`没有这个文件夹「${String(id)}」`)
  profile.folders = normalizeFolders(profile).filter((f) => f.id !== hit.id)
  let moved = 0
  for (const m of Array.isArray(profile.materials) ? profile.materials : []) {
    if (m && String(m.folder || '') === hit.id) {
      m.folder = UNGROUPED
      moved += 1
    }
  }
  return { id: hit.id, moved, folders: normalizeFolders(profile) }
}

/** 把若干份材料挪进某个夹子（folder 空串 = 退回未分组）。缺 id 的材料直接报错。 */
export function moveMaterials(profile, ids, folder) {
  const list = (Array.isArray(ids) ? ids : [ids]).map((x) => String(x == null ? '' : x).trim()).filter(Boolean)
  if (!list.length) throw new Error('要挪哪几份？给 id')
  let target = UNGROUPED
  if (String(folder == null ? '' : folder).trim()) {
    const hit = findFolder(profile, folder)
    if (!hit) throw new Error(`没有这个文件夹「${String(folder).trim()}」——先在面板上建一个，或者写个新名字让我建`)
    target = hit.id
  }
  const materials = Array.isArray(profile.materials) ? profile.materials : []
  const moved = []
  for (const id of list) {
    const mat = materials.find((m) => m && String(m.id) === id)
    if (!mat) throw new Error(`没有材料「${id}」`)
    mat.folder = target
    moved.push(id)
  }
  return { moved, folder: target, folders: normalizeFolders(profile) }
}

/** 登记新材料时定它落哪儿：显式给了就听显式的，否则按 kind 走默认（AI 出的进「教练产出」）。 */
export function folderForNew(profile, { folder, kind } = {}) {
  if (String(folder == null ? '' : folder).trim()) return folderIdFor(profile, folder)
  const byKind = DEFAULT_FOLDER_BY_KIND[String(kind || '')]
  return byKind ? ensureFolder(profile, byKind) : UNGROUPED
}

/** 面板要的分组视图：文件夹按建立顺序，未分组的兜在最后，一份都不掉。 */
export function groupMaterials(profile) {
  const folders = normalizeFolders(profile)
  const materials = Array.isArray(profile.materials) ? profile.materials : []
  const groups = folders.map((f) => ({
    id: f.id,
    title: f.title,
    items: materials.filter((m) => m && String(m.folder || '') === f.id).map((m) => String(m.id)),
  }))
  const loose = materials.filter((m) => m && !findFolder(profile, String(m.folder || ''))).map((m) => String(m.id))
  return { folders: groups, ungrouped: loose }
}
