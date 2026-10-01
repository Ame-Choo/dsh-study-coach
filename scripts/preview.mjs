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

const library = new Library(root)
library.ensure()

const handler = createHandler(library, createRouter(library), { assetsDir: ASSETS })
const server = await startPanelServer(handler, { port })

console.log('[study-coach] 预览地址 ' + server.url)
console.log('[study-coach] 数据目录 ' + root)
console.log('[study-coach] 跟 DSH 里那份是同一处，两边别同时写；按 Ctrl+C 关掉')

const stop = () => {
  void server.close().then(() => process.exit(0))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
