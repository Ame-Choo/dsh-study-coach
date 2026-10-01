/**
 * dsh-study-coach — 数据层：档案文件夹本身。
 *
 * 一个学习目标一个档案，档案就是一个文件夹，里面全是人能直接打开手改的 JSON。
 * 不引数据库，不上锁，只保证：读坏了不炸、写下去是整份、每次改动留时间戳。
 *
 * 这一层只管「盘上有什么」：常量表、各种空档案的默认形状、读写 JSON 的 Store。
 * 领域函数分别住在 map.js（地图 / 掌握度 / 错题 / 档案 / 能力 / 任务视图）、
 * analysis.js（材料分析 / 页级索引）、notice.js（指引与留言），那三个都 import 这里。
 *
 * 只有一个例外：Store.snapshot() 要调 progressByGroup 和 abilityReport。
 * 按「下层不 import 上层」本该由调用方补这两行汇总，但 store.snapshot() 是十几个
 * 调用方都在吃的入口，改签名不值当，所以这里 import 它们 —— 代价是一个只经过
 * Store.snapshot() 这一条边的环。加载顺序安全：map.js 求值期只用到本文件导出的
 * 常量和空档案工厂，不碰 Store；这两个绑定在函数体里才被读。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import { progressByGroup, abilityReport } from './map.js'

/** 掌握度状态档位，从低到高。顺序有意义，别重排。 */
export const STAGES = ['没接触过', '见过', '能跟做', '能独立做', '熟练稳定', '能讲明白']

/**
 * 升到这几档之前，该单元下至少要有几条「真做过」的证据。
 *
 * 档位是教练填的，但「够不够格升」不该只由教练说了算：自评说一百遍「我熟练了」
 * 也换不来一条做题记录。所以这几档设一道硬闸门，见 `lib/tools.js` 的 `study_record`。
 * 「能跟做」及以下不设门——那几档本来就只是「见过/跟着走过」，本来就该允许自评。
 */
export const STAGE_NEEDS = { 能独立做: 1, 熟练稳定: 2, 能讲明白: 3 }

/** 算「真做过」的证据类型：做题、作业照片。自评、上课、复习都不算。 */
export const WORK_KINDS = ['quiz', 'photo']

/** 材料分析里「读到什么程度」。 */
export const COVERAGE = ['整本通读', '部分通读', '只翻目录']

/** 章节难度。 */
export const DIFFICULTY = ['基础', '中等', '难']

/**
 * 页级归类里「这一页算什么」。顺序有意义：面板按这个顺序排图例、上色。
 * 目录和答案不占知识点，其余都能挂到地图的最小单元上。
 */
export const PAGE_KINDS = ['讲解', '例题', '习题', '目录', '答案', '其他']

/**
 * 材料的类别。`ai` 是「AI 出题」——教练现场生成的练习卷，落在书架里跟教辅平级，
 * 只是没有对应的本机文件（path 为空、正文走 ai/ 目录下那份 md）。
 */
export const MATERIAL_KINDS = ['book', 'video', 'notes', 'past', 'ai', 'other']

/** 面板上的中文叫法。键跟 MATERIAL_KINDS 对齐，`other` 兜底。 */
export const MATERIAL_KIND_LABELS = {
  book: '教辅',
  video: '网课',
  notes: '讲义',
  past: '真题',
  ai: 'AI 出题',
  other: '其他',
}

/**
 * 错题状态，从低到高：还没订正完 → 错因和订正都写了 → 隔几天重做同类题做对了。
 * 顺序有意义，别重排。
 */
export const MISTAKE_STATUS = ['待验证', '已订正', '已复做对']

/** 一个档案固定就这几个文件。 */
export const FILES = {
  profile: 'profile.json',
  map: 'map.json',
  mastery: 'mastery.json',
  tasks: 'tasks.json',
  guide: 'guide.json',
  inbox: 'inbox.json',
  analysis: 'analysis.json',
  toolbox: 'toolbox.json',
  memory: 'memory.json',
  student: 'student.json',
}

/**
 * 关于这个学生的判断分几类。
 *
 * 跟 mastery 是**两层东西**：mastery 里每条 evidence 是「哪一次、什么表现」，
 * 是流水（L1）；这里一条是「这个人是怎么回事」的**结论**（L2），必须挂着几条
 * 流水才成立。分开存是因为两边的寿命不一样——流水一直涨，结论要能被推翻重写。
 */
export const FACT_KINDS = ['习惯', '强项', '弱项', '偏好', '背景']


/**
 * 记忆卡的间隔阶梯，单位是分钟：10 分钟、1 小时、9 小时、1 天、2 天、6 天、31 天。
 *
 * 这就是艾宾浩斯那条曲线最常用的那组复现点。**顺序有意义**：一段一段往后走，
 * 「忘了」打回第一步，「模糊」退一级。走完最后一级就毕业，不再排期。
 */
export const CARD_STEPS = [10, 60, 540, 1440, 2880, 8640, 44640]

/** 一张卡是什么东西。分这个是为了能按类型筛（单词和公式的复习节奏不一样）。 */
export const CARD_KINDS = ['单词', '公式', '定义', '其他']

/** 自评四档。顺序有意义：越靠后记得越牢，排得越远。 */
export const CARD_GRADES = ['忘了', '模糊', '记住', '秒答']

/** 一次专注允许的分钟数。太短没意义，太长不是番茄钟了。 */
export const FOCUS_MIN = 1
export const FOCUS_MAX = 180

const MATERIALS_DIR = 'materials'

export function nowIso() {
  return new Date().toISOString()
}

/** 空档案的默认形状。缺字段的地方一律从这里兜底。 */
export function emptyProfile() {
  return {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    goal: { subject: '', outcome: '', deadline: '', minutesPerDay: 60 },
    materials: [],
    tools: [],
    /* 教练对「这人现在整体什么水平」写下的判词，面板顶上那条就显示它。 */
    ability: { text: '', level: '', updatedAt: null },
  }
}

export function emptyMap() {
  return { version: 1, revision: 0, status: 'draft', confirmedAt: null, modules: [] }
}

export function emptyMastery() {
  return { version: 1, points: {} }
}

export function emptyTasks() {
  return { version: 1, days: {} }
}

/** 教练写在面板顶上的一句话指引：现在该回对话里干什么。 */
export function emptyGuide() {
  return { version: 1, text: '', kind: '', at: null }
}

/** 学生在面板上留给教练的话，等对话那边来读。 */
export function emptyInbox() {
  return { version: 1, items: [] }
}

/** 材料通读之后的分析：整份材料怎么用、每章干什么。 */
export function emptyAnalysis() {
  return { version: 1, byMaterial: {} }
}

/**
 * 工具栏目：番茄钟和清单。
 *
 * 番茄钟的状态**以绝对时刻为准**（`endsAt`），不是「还剩几秒」——
 * 面板关掉、页面刷新、DSH 重启都不影响它，回来一看该走到哪儿就是哪儿。
 * 所以「这一轮结束了没有」是读的时候顺手结算的（`settleFocus`），
 * 不靠任何定时器。
 */
export function emptyToolbox() {
  return {
    version: 1,
    focus: {
      workMinutes: 25,
      breakMinutes: 5,
      longBreakMinutes: 15,
      roundsPerLong: 4,
      running: false,
      /* 这一轮结束的时刻，ISO；没在跑就是 null */
      endsAt: null,
      /* 这一轮什么时候开始的，用来算日志 */
      startedAt: null,
      /* 这一轮在做什么：清单条目的 id 和它的文字（文字是快照，条目删了日志还看得懂） */
      taskId: '',
      label: '',
      /* 今天背了几个番茄、累计多少分钟；日期一变就清零 */
      today: '',
      todayMinutes: 0,
      todayRounds: 0,
      /* 已经走完的轮次，最近的在后面 */
      log: [],
    },
    todos: { items: [] },
  }
}

/**
 * 记忆卡：要背的东西一张一张摊开，按艾宾浩斯那条阶梯排什么时候再看一遍。
 *
 * 跟 mastery 是两套账：mastery 记的是「这个知识点会不会做题」，memory 记的是
 * 「这条公式背没背下来」。一张卡可以挂到某个单元上（`pointId`），但挂不挂都不
 * 影响它自己那份排期——背下来和会做是两件事。
 */
export function emptyMemory() {
  return {
    version: 1,
    /* 卡片数组；每张卡的形状见 lib/memory.js 的 normalizeCard() */
    cards: [],
  }
}

/**
 * 关于这个学生的判断（L2）。
 *
 * 刻意跟 mastery 那份流水分开存：流水是「发生过什么」，这里存的是
 * 「所以我判断他是怎么回事」。每一条都挂证据，没证据的判断不许落盘——
 * 这条规矩写在 lib/student.js 里，拦得住才行，写在提示词里拦不住。
 */
export function emptyStudent() {
  return {
    version: 1,
    /* 事实数组；每条的形状见 lib/student.js 的 normalizeFact() */
    facts: [],
  }
}

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
