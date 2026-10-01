/**
 * 面板 → 对话 的那条线。
 *
 * 面板是浏览器里的一个页面，它说什么我本来听不见——它只能往 inbox.json 里写字，
 * 得等学生下回在对话里开口，我才会翻到。这条线要解决的就是这一步：
 * 把面板上的话当成一条真正的用户消息投进会话，我立刻就会被叫起来。
 *
 * host 的 sessionController.prompt() 就是干这个的：
 *   prompt({ requestId, sessionId, mode: 'queue' | 'steer', content: [{ type: 'text', text }] }, signal)
 * 「挑哪个会话」是这里唯一的判断：list() 按活动时间排，取第一个不是子 agent 的。
 *
 * 全程不抛：拿不到 service、找不到会话、投递被拒，都回 { ok: false, error }，
 * 让上层接着把话存进 inbox，别因为一条通道断了把学生的留言也丢了。
 */

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
 * 挑一个该收面板消息的会话：最新还在活动的那个，排除子 agent。
 * list() 本来就按活动时间倒着排，所以取第一个就够。
 */
async function pickSession(controller) {
  if (typeof controller.list !== 'function') return ''
  const value = await controller.list({}, deadline(5000))
  const items = Array.isArray(value && value.items) ? value.items : []
  const hit = items.find((s) => s && s.sessionId && !s.parentSessionId && s.origin !== 'subagent')
  return hit ? String(hit.sessionId) : ''
}

/**
 * @param {{ resolve?: () => any }} options
 *   resolve 每次现取 sessionController。插件 apply 的时候这个服务可能还没注册，
 *   所以不能在这一刻把它抓死；懒取一次的成本可以忽略。
 */
export function createBridge(options = {}) {
  const resolve = typeof options.resolve === 'function' ? options.resolve : () => options.controller
  let preferred = ''

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
      if (value) preferred = value
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

      let sessionId = String(options.sessionId || preferred || '').trim()
      if (!sessionId) {
        try {
          sessionId = await pickSession(controller)
        } catch (error) {
          return { ok: false, error: '挑会话失败：' + messageOf(error) }
        }
      }
      if (!sessionId) return { ok: false, error: '没找到能收话的会话' }

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
        return { ok: true, sessionId }
      } catch (error) {
        return { ok: false, sessionId, error: messageOf(error) }
      }
    },
  }
}
