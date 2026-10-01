/**
 * 「学习教练」预设定义的自检：结构、id 唯一、平台开关、人设里该说的话。
 * 这些错要等重启 DSH 之后才会暴露（预设挂载失败 = 模式列表里没有这个名字），所以先在这儿拦住。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PRESET_ID, buildPreset, registerPreset } from '../lib/preset.js'

/** 把所有层级的子行摊平。 */
function flatten(list, out = []) {
  for (const row of list) {
    out.push(row)
    if (row.group === true) flatten(row.config, out)
  }
  return out
}

test('预设的基本字段齐了', () => {
  const def = buildPreset()
  assert.equal(def.id, PRESET_ID)
  assert.equal(def.id, 'study-coach')
  assert.equal(def.name, '学习教练')
  assert.equal(typeof def.description, 'string')
  assert.ok(def.description.length > 0, '描述不能空')
  assert.equal(typeof def.order, 'number')
  assert.ok(Array.isArray(def.plugins) && def.plugins.length > 0)
})

test('子行 id 不重复，每行都有 name，group 的 config 是行数组', () => {
  const rows = []
  for (const row of buildPreset().plugins) {
    rows.push(row)
    assert.equal(typeof row.name, 'string')
    assert.ok(row.name.length > 0, `空心 name：${JSON.stringify(row)}`)
    assert.equal(typeof row.id, 'string')
    if (row.group === true) {
      assert.ok(Array.isArray(row.config), `group ${row.id} 的 config 得是行数组`)
      for (const child of row.config) {
        assert.equal(typeof child.name, 'string')
        assert.ok(child.name.length > 0, `group ${row.id} 里有空心 name`)
      }
    }
  }
  const ids = rows.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length, `顶层 id 重复：${ids.join(',')}`)

  const all = flatten(buildPreset().plugins)
  const allIds = all.map((r) => r.id)
  assert.equal(new Set(allIds).size, allIds.length, `含子行在内 id 重复：${allIds.join(',')}`)
  assert.ok(all.length > 15, `行数看着不对：${all.length}`)
})

test('平台开关：本机只留一个 shell 工具，删掉的那几个仍显式 disabled', () => {
  const win = process.platform === 'win32'
  const byId = Object.fromEntries(flatten(buildPreset().plugins).map((r) => [r.id, r]))
  assert.equal(byId['tool-bash'].disabled, win)
  assert.equal(byId['tool-pwsh'].disabled, !win)
  assert.equal(byId['tool-ralph'].disabled, true)
  assert.equal(byId['tool-plugin-manager'].disabled, true)
})

test('人设交代了先读档案、面板只读、地图要学生过目', () => {
  const persona = buildPreset().plugins.find((r) => r.id === 'persona')
  assert.ok(persona, '没有 persona 行')
  assert.match(persona.config.prefix, /学习教练/)
  assert.match(persona.config.prefix, /study_report/)
  assert.match(persona.config.prefix, /study_inbox/)
  assert.match(persona.config.prefix, /只读/)
  assert.match(persona.config.prefix, /action=confirm/)
  assert.match(persona.config.suffix, /\{\{cwd\}\}/)
})

test('人设点名了那份 skill，而且名字跟 SKILL.md 的 frontmatter 对得上', () => {
  // 这条是拿空会话探针试出来的：persona 原来一个字都没提 skill，新开的会话
  // 只能靠 skill 目录里那行 description 自己认领，认不着就只剩六行 persona +
  // 工具描述可用——第 2 节怎么拆页、第 5 节的升档硬闸门、第 6 节一节好课的骨架
  // 全丢。所以 persona 必须点名，而且点名的名字必须是 skill 真名。
  const persona = buildPreset().plugins.find((r) => r.id === 'persona')
  const prefix = persona.config.prefix
  assert.match(prefix, /study-coach/, 'persona 没点名那份 skill')
  assert.match(prefix, /加载 skill|加载.*skill/i, 'persona 要明说「去加载」，不能只提个名字')

  const dirs = (flatten(buildPreset().plugins).find((r) => r.id === 'skill-filesystem').config || {})
    .customSkillDirs
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(join(dirs[0], 'study-coach', 'SKILL.md'), 'utf8'))
  const name = /^name:\s*(\S+)\s*$/m.exec(front[1])[1]
  assert.ok(prefix.includes(name), `persona 点名的 skill 名跟 frontmatter 的 name（${name}）对不上`)
})

test('没有 agentPresets 服务时安静跳过，不抛', () => {
  const cleanups = []
  const ctx = {
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') cleanups.push(d)
      return () => {}
    },
    get() {
      return undefined
    },
  }
  const off = registerPreset(ctx)
  assert.equal(typeof off, 'function')
  for (const c of cleanups) c()
})

test('有 agentPresets 时把定义递过去，清理时叫它撤', async () => {
  const seen = []
  let revoked = false
  const cleanups = []
  const ctx = {
    effect(fn) {
      const d = fn()
      if (typeof d === 'function') cleanups.push(d)
      return () => {}
    },
    agentPresets: {
      async register(definition) {
        seen.push(definition)
        return async () => {
          revoked = true
        }
      },
    },
  }
  registerPreset(ctx)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(seen.length, 1)
  assert.equal(seen[0].id, 'study-coach')
  assert.equal(seen[0].name, '学习教练')

  for (const c of cleanups) c()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(revoked, true, '注销时没把预设撤掉')
})

test('skill 目录跟着包走，SKILL.md 的 frontmatter 合规', () => {
  const rows = flatten(buildPreset().plugins)
  const row = rows.find((r) => r.id === 'skill-filesystem')
  assert.ok(row, 'preset 里没有 skill-filesystem 行')
  const dirs = (row.config && row.config.customSkillDirs) || []
  assert.equal(dirs.length, 1, 'customSkillDirs 应该正好指向包内的 skills 目录')
  assert.ok(existsSync(dirs[0]), `skills 目录不存在：${dirs[0]}`)

  const file = join(dirs[0], 'study-coach', 'SKILL.md')
  assert.ok(existsSync(file), `SKILL.md 不存在：${file}`)
  const text = readFileSync(file, 'utf8')
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  assert.ok(front, 'SKILL.md 缺 frontmatter')
  assert.match(front[1], /^name:\s*study-coach\s*$/m, 'frontmatter 的 name 要是 kebab-case 的 study-coach')
  assert.match(front[1], /^description:\s*\S/m, 'frontmatter 要有 description')
})
