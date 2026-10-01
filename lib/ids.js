/**
 * 档案里那些「前缀 + 时间戳」的 id 怎么发。
 *
 * 原来发号都是 `前缀 + Date.now().toString(36)`，只到毫秒——同一毫秒里连发两个就撞。
 * 撞了不只是看着难看：删材料是按 id 过滤的，两份撞了之后删一份会把另一份一起删掉；
 * 证据、卡片、待办同理。所以发号前先看一眼已经有哪些，撞上就往后挪。
 */

/**
 * `prefix` 形如 `mat-` / `MAT`；`taken` 是已经存在的条目数组，只看每条的 `id`。
 * 没撞就直接给时间戳那版，撞了才追加 `-2`、`-3`……
 *
 * `ms` 只为测试留口子（要钉死「同一毫秒」这件事），平时别传。
 */
export function uniqueId(prefix, taken, ms) {
  const base = prefix + (ms === undefined ? Date.now() : ms).toString(36)
  const used = new Set((Array.isArray(taken) ? taken : []).map((x) => (x && x.id) || '').filter(Boolean))
  if (!used.has(base)) return base
  for (let i = 2; ; i += 1) {
    const id = `${base}-${i}`
    if (!used.has(id)) return id
  }
}
