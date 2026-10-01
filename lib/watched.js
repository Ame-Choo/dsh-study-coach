/**
 * 「看完了」那颗按钮记的账。
 *
 * 面板在资料图谱上给网课类材料的每一讲配一颗「看完了」——学生上完那一节点一下就记一笔。
 * 这里**只记「他点过」，不碰掌握度**：看完一讲只说明见过了，档位要教练看完作业再推；
 * 面板把这条消息也递给教练（那样教练才会按规矩去记证据、更新两份档案）。
 *
 * 键 = `${materialId}|${那一讲的标识}`（网课用文件路径，书用页码），所以换材料不串。
 */

/** 一条记录在文件里的键。materialId 或 key 缺了也给它一个能看的键，别把两条挤成一条。 */
export function watchKey(materialId, key) {
  return `${String(materialId || '?').trim()}|${String(key || '').trim()}`
}

/** 记一笔，回一份新的文档（不改传进来的那份）。同一条再点一次只把时间往前挪。 */
export function addWatch(doc, { materialId, key, title, pointId, at } = {}) {
  const marks = { ...((doc && doc.marks) || {}) }
  marks[watchKey(materialId, key)] = {
    materialId: String(materialId || ''),
    key: String(key || ''),
    title: String(title || ''),
    pointId: String(pointId || ''),
    at: String(at || ''),
  }
  return { marks }
}

/** 这份材料下所有看过的（键 → 记录）。面板拿它把按钮换成「已看完 · 日期」。 */
export function watchedIn(doc, materialId) {
  const marks = (doc && doc.marks) || {}
  const out = {}
  for (const [k, v] of Object.entries(marks)) {
    if (v && String(v.materialId) === String(materialId)) out[String(v.key)] = v
  }
  return out
}

/** 看过几讲。 */
export function watchCount(doc, materialId) {
  return Object.keys(watchedIn(doc, materialId)).length
}
