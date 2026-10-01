/**
 * 面板 → 对话 的那条线。
 *
 * 面板是浏览器里的一个页面，它说什么我本来听不见——它只能往 inbox.json 里写字，
 * 得等学生下回在对话里开口，我才会翻到。这条线要解决的就是这一步：
 * 把面板上的话当成一条真正的用户消息投进会话，我立刻就会被叫起来。
 *
 * host 的 sessionController.prompt() 就是干这个的：
 *   prompt({ requestId, sessionId, mode: 'queue' | 'steer', content: [{ type: 'text', text }] }, signal)
 * 「挑哪个会话」是这里唯一的判断：先挑**学习模式**（agentPreset === study-coach）的那个——
 * DSH 里还有编程会话，学生从面板说出去的话不该掉进那些里面；宿主不发会话投影时才退回
 * 「最近那个非子 agent 会话」。判据跟读对话那条线共用 lib/session-preset.js。
 *
 * 全程不抛：拿不到 service、找不到会话、投递被拒，都回 { ok: false, error }，
 * 让上层接着把话存进 inbox，别因为一条通道断了把学生的留言也丢了。
 */

import { learningSessions } from './session-preset.js'

const MODES = ['queue', 'steer']
const DEFAULT_TIMEOUT = 8000

let seq = 0

function requestId() {
  seq += 1
  return 'study-panel-' + Date.now().toString(36) + '-' + seq.toString(36)
}

function messageOf(error) {
  if (!error) return '不知道哪儿错了'
  if (typeof error.message === 'string' && error.message) return error.message
  return String(error)
}

/** 给远程调用加个上限：卡住的话面板就转圈到天荒地老。 */
function deadline(ms) {
  const wait = Number(ms) > 0 ? Number(ms) : DEFAULT_TIMEOUT
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return AbortSignal.timeout(wait)
    } catch {
      /* 老 node 不认就退回去，没有 signal 也能跑 */
    }
  }
  return undefined
}

/**
 * 挑一个该收面板消息的会话：学习模式里最新的那个，排除子 agent。
 * list() 本来就按活动时间倒着排，所以取第一个就够；`prefer` 是上一回投过的会话，
 * 它还在清单里就接着用它（学生换了会话时面板会显式传 id，不走这儿）。
 *
 * @returns {Promise<{ sessionId: string, filtered: boolean }>} filtered 为 false 表示这台宿主
 *   不发会话投影、这次是按「最近那个」兜的底。
 */
async function pickSession(controller, prefer = '') {
  if (typeof controller.list !== 'function') return { sessionId: '', filtered: false }
  const value = await controller.list({}, deadline(5000))
  const items = Array.isArray(value && value.items) ? value.items : []
  const { items: kept, filtered } = learningSessions(items)
  const wanted = String(prefer || '')
  const hit = wanted ? kept.find((s) => String(s.sessionId) === wanted) : null
  const chosen = hit || kept[0]
  return { sessionId: chosen ? String(chosen.sessionId) : '', filtered }
}

/**
 * @param {{ resolve?: () => any }} options
 *   resolve 每次现取 sessionController。插件 apply 的时候这个服务可能还没注册，
 *   所以不能在这一刻把它抓死；懒取一次的成本可以忽略。
 */
export function createBridge(options = {}) {
  const resolve = typeof options.resolve === 'function' ? options.resolve : () => options.controller
  let preferred = ''
  /** preferred 是不是从会话清单里挑出来的。工具随手 remember() 记下的那个不算——
   *  它可能是个编程会话（学习工具在别的预设下也调得到），还得回清单核一遍。 */
  let preferredFromList = false

  const controllerOf = () => {
    try {
      const value = resolve()
      return value && typeof value === 'object' ? value : null
    } catch {
      return null
    }
  }

  return {
    /** 服务在不在。不在就说明这台 DSH 没有投递通道，面板只能存留言。 */
    get available() {
      const controller = controllerOf()
      return Boolean(controller && typeof controller.prompt === 'function')
    },

    /** 上一次投成功的会话，面板下一句默认还投给它。 */
    get sessionId() {
      return preferred
    },

    /** 工具跑的时候如果拿得到当前会话，顺手记下来，比每回 list() 挑更准。 */
    remember(sessionId) {
      const value = String(sessionId || '').trim()
      if (value) {
        preferred = value
        preferredFromList = false
      }
      return preferred
    },

    /**
     * 把一段话投进会话。
     * @param {string} text
     * @param {{ sessionId?: string, mode?: 'queue' | 'steer', timeoutMs?: number }} [options]
     * @returns {Promise<{ ok: boolean, sessionId?: string, error?: string }>}
     */
    async send(text, options = {}) {
      const body = String(text ?? '').trim()
      if (!body) return { ok: false, error: '没写东西，没投出去' }

      const controller = controllerOf()
      if (!controller || typeof controller.prompt !== 'function') {
        return { ok: false, error: '这台 DSH 没有 sessionController，话只能先存着' }
      }

      let sessionId = String(options.sessionId || '').trim()
      let filtered = false
      if (!sessionId && preferred && preferredFromList) {
        // 上一回就是从清单里挑的，接着用，不再问一遍（面板正常走的是显式传 id 那条）。
        sessionId = preferred
      } else if (!sessionId) {
        let picked
        try {
          picked = await pickSession(controller, preferred)
        } catch (error) {
          return { ok: false, error: '挑会话失败：' + messageOf(error) }
        }
        sessionId = picked.sessionId
        filtered = picked.filtered
      }
      if (!sessionId) {
        return { ok: false, error: filtered ? '没有「学习教练」模式的对话，这句话先存着' : '没找到能收话的会话' }
      }

      const mode = MODES.includes(options.mode) ? options.mode : 'queue'
      try {
        await controller.prompt(
          {
            requestId: requestId(),
            sessionId,
            mode,
            content: [{ type: 'text', text: body }],
          },
          deadline(options.timeoutMs),
        )
        preferred = sessionId
        preferredFromList = true
        return { ok: true, sessionId }
      } catch (error) {
        return { ok: false, sessionId, error: messageOf(error) }
      }
    },
  }
}
