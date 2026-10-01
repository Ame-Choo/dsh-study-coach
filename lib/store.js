/**
 * dsh-study-coach — 数据层：档案文件夹本身。
 *
 * 一个学习目标一个档案，档案就是一个文件夹，里面全是人能直接打开手改的 JSON。
 * 不引数据库，不上锁，只保证：读坏了不炸、写下去是整份、每次改动留时间戳。
 *
 * 这一层只管「盘上有什么」：读写 JSON 的 Store。各份档案的形状（常量表、空档案
 * 工厂、nowIso）在 schema.js；领域函数分别住在 map.js（地图 / 掌握度 / 错题 /
 * 档案 / 能力 / 任务视图）、analysis.js（材料分析 / 页级索引）、notice.js
 * （指引与留言）。
 *
 * 依赖方向是单向的：schema.js（纯资料）← store.js（盘上读写）← map.js /
 * analysis.js / notice.js（领域函数）。唯一一条往上的边是 Store.snapshot() 要
 * map.js 的 progressByGroup 和 abilityReport；map.js 自己只从 schema.js 拿
 * 常量和空档案工厂，不再回头找这一层，所以这张图上没有环。
 *
 * 末尾那行 `export * from './schema.js'` 是故意的，不是偷懒：lib/library.js、
 * lib/routes.js、lib/tools.js 那一圈和一堆测试一直是从 ./store.js 取常量的，
 * 转出去它们就一行都不用动。但转出只把名字转出去、不带进本文件的作用域，所以
 * 上面该 import 的还得 import 一份。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import { STAGES, FILES, nowIso, emptyProfile, emptyMap, emptyMastery, emptyTasks, emptyGuide, emptyInbox, emptyAnalysis, emptyToolbox, emptyMemory, emptyStudent } from './schema.js'
import { progressByGroup, abilityReport } from './map.js'

/* 档案文件夹里那几个子目录的名字。只给 Store 自己用，不往外发。 */
const MATERIALS_DIR = 'materials'

/**
 * 档案仓库。root 就是档案文件夹；多目标以后要做，就是把 root 从单目录换成
 * 一个父目录下的多个子目录，接口不用动。
 */
export class Store {
  constructor(root) {
    this.root = root
  }

  /** 该建的目录建起来，缺的文件补默认值，返回是否新建了 root。 */
  ensure() {
    const fresh = !existsSync(this.root)
    if (fresh) mkdirSync(this.root, { recursive: true })
    const matDir = join(this.root, MATERIALS_DIR)
    if (!existsSync(matDir)) mkdirSync(matDir, { recursive: true })
    for (const key of Object.keys(FILES)) {
      const p = this.path(key)
      if (!existsSync(p)) this.write(key, this.default(key))
    }
    return fresh
  }

  default(key) {
    if (key === 'profile') return emptyProfile()
    if (key === 'map') return emptyMap()
    if (key === 'mastery') return emptyMastery()
    if (key === 'tasks') return emptyTasks()
    if (key === 'guide') return emptyGuide()
    if (key === 'inbox') return emptyInbox()
    if (key === 'analysis') return emptyAnalysis()
    if (key === 'toolbox') return emptyToolbox()
    if (key === 'memory') return emptyMemory()
    if (key === 'student') return emptyStudent()
    throw new Error('unknown file: ' + key)
  }

  path(key) {
    const name = FILES[key]
    if (!name) throw new Error('unknown file: ' + key)
    return join(this.root, name)
  }

  materialsDir() {
    return join(this.root, MATERIALS_DIR)
  }

  /** 读一份；坏了或者不在了就返回默认值，不抛。 */
  read(key) {
    try {
      const raw = readFileSync(this.path(key), 'utf8')
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return this.default(key)
      return parsed
    } catch {
      return this.default(key)
    }
  }

  /** 整份写下去，先落临时文件再改名，避免写一半断电留个半截 JSON。 */
  write(key, value) {
    const target = this.path(key)
    const tmp = target + '.tmp'
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, target)
    return value
  }

  /** 改一份：读出当前值，交给 fn，写回。fn 里就地改或者返回新对象都行。 */
  update(key, fn) {
    const current = this.read(key)
    const next = fn(current) ?? current
    if (next && typeof next === 'object' && !next.updatedAt && key !== 'map' && key !== 'mastery') {
      next.updatedAt = nowIso()
    }
    return this.write(key, next)
  }

  /** 面板要一眼看全，这里一次把几份都端出去。 */
  snapshot() {
    const map = this.read('map')
    const mastery = this.read('mastery')
    const profile = this.read('profile')
    const tasks = this.read('tasks')
    return {
      root: this.root,
      profile,
      map,
      mastery,
      tasks,
      guide: this.read('guide'),
      inbox: this.read('inbox'),
      analysis: this.read('analysis'),
      /* 关于这个学生的判断（L2）。落盘是原样的引用，谁用谁去 mastery 里兑证据。 */
      student: this.read('student'),
      /* 大类、模块各带一个百分比，面板上「某大类 60%」那种就靠它。 */
      progress: progressByGroup(map, mastery),
      /* 顶上那张「这人现在什么水平」的卡，数据都在这儿，话由教练写。 */
      ability: abilityReport(profile, map, mastery, tasks),
      stage: STAGES,
      at: nowIso(),
    }
  }
}

export * from './schema.js'
