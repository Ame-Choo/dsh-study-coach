#!/usr/bin/env node
/**
 * 脱离 DSH，直接把面板起起来。
 *
 * 两个用处：
 *   1. 改前端 / 调接口时不用每次重启 DSH —— 面板这半边本来就是现读磁盘的。
 *   2. DSH 进程跑着旧的服务端代码、你又不想现在重启时，临时挂一份新代码给人用。
 *
 * 数据跟 DSH 那份是同一处（~/.dsh/study-coach），别两边同时写。
 *
 *   node scripts/preview.mjs              # 19390 起，占了往后挪
 *   DSH_STUDY_PREVIEW_PORT=20000 node scripts/preview.mjs
 *   DSH_STUDY_ROOT=/tmp/x node scripts/preview.mjs
 *   DSH_STUDY_PREVIEW_CHAT=1 node scripts/preview.mjs   # 配一份示例对话
 *
 * 最后那条是给「想先看看对话页长什么样、又不想重启 DSH」准备的：真跑起来那段对话
 * 是 DSH 的 sessionController 给的，脱开 DSH 没有，就塞一份假的。
 */
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

import { Library } from '../lib/library.js'
import { createRouter } from '../lib/routes.js'
import { createHandler } from '../lib/handler.js'
import { startPanelServer } from '../lib/panel-server.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSETS = join(HERE, '..', 'assets')

const root = process.env.DSH_STUDY_ROOT || join(homedir(), '.dsh', 'study-coach')
const port = Number(process.env.DSH_STUDY_PREVIEW_PORT || 19390)

/**
 * 一份假对话。形状照着 `lib/chat.js` 的 toMessages() 摆，面板那半边分不出来。
 * 只在 `DSH_STUDY_PREVIEW_CHAT=1` 时挂上去。
 */
function demoChat() {
  const t0 = Date.now() - 12 * 60 * 1000
  const session = { sessionId: 'demo-1', title: '学习教练（示例）', updatedAt: t0 + 12 * 60 * 1000, running: false, blank: false }
  const other = { sessionId: 'demo-2', title: '线性代数（示例）', updatedAt: t0, running: false, blank: false }
  const messages = [
    { id: 'd1', seq: 4, role: 'user', text: '这一节的含参讨论没跟上，第九组那段为什么要分 A、B 两个区间？', time: t0 + 60 * 1000 },
    { id: 'd2', seq: 5, role: 'tool', tool: { name: 'read' } },
    { id: 'd3', seq: 6, role: 'result', tool: { name: 'read' } },
    { id: 'd4', seq: 7, role: 'tool', tool: { name: 'study_analysis' } },
    { id: 'd5', seq: 8, role: 'result', tool: { name: 'study_analysis' } },
    {
      id: 'd6',
      seq: 9,
      role: 'bot',
      time: t0 + 3 * 60 * 1000,
      tools: ['read', 'study_analysis'],
      text:
        '分两种情形看，是因为 A 本身是不是空集会改变结论：\n\n' +
        '1. A = ∅ 时，只要 B 满足含条件就成立，此时对参数只有上界约束；\n' +
        '2. A ≠ ∅ 时，还要额外保证 A 的每个元素都落在 B 里，于是多出一个下界约束。\n\n' +
        '把这两种情形的参数范围并起来，才是完整的答案。漏掉第一种，就是最常见的丢解。',
    },
    { id: 'd7', seq: 10, role: 'user', text: '明白了。那种题明天排几道？', time: t0 + 8 * 60 * 1000 },
    { id: 'd8', seq: 11, role: 'bot', time: t0 + 9 * 60 * 1000, tools: [], text: '先排 6 道，都在《1000 题》第一章第九组。做完把错的题号告诉我，我按错因再补。' },
  ]
  const pick = (sessionId) => (sessionId && sessionId === other.sessionId ? other : session)
  return {
    get available() {
      return true
    },
    async sessions() {
      return { ok: true, available: true, error: '', sessions: [session, other] }
    },
    async history({ sessionId = '' } = {}) {
      const chosen = pick(sessionId)
      const kept = chosen.sessionId === session.sessionId ? messages : []
      return { ok: true, available: true, error: '', sessionId: chosen.sessionId, title: chosen.title, cursor: 0, messages: kept }
    },
  }
}

const library = new Library(root)
library.ensure()

const deps = process.env.DSH_STUDY_PREVIEW_CHAT ? { chat: demoChat() } : {}
const handler = createHandler(library, createRouter(library, deps), { assetsDir: ASSETS })
const server = await startPanelServer(handler, { port })

console.log('[study-coach] 预览地址 ' + server.url)
console.log('[study-coach] 数据目录 ' + root)
if (deps.chat) console.log('[study-coach] 对话通道：示例数据（不是真的 DSH 会话）')
console.log('[study-coach] 跟 DSH 里那份是同一处，两边别同时写；按 Ctrl+C 关掉')

const stop = () => {
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
