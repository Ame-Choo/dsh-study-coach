/**
 * 21 个 study_* 工具，挂在「学习教练」预设的作用域里（见 lib/preset.js 的 plugins 里那一行）。
 *
 * 为什么不跟别的半边一起放 index.js：工具是**模型每一轮都看得见**的东西，
 * 挂在插件自己的 ctx 上（host 平面）就是全局注册——普通会话、别的预设的会话，
 * 工具目录里都会多出 21 个 study_*。工具目录决定模型会想到什么，不是「不用就看不见」的仓储货。
 * 挪进预设这一行之后，注册用的 ctx 带的是预设作用域（`dsh-agent-preset-registry` 挂载子插件时
 * `createScope()` + 子插件继承预设作用域），只有这个预设的会话看得见它们。
 *
 * 这条路子的依据（都在 DSH 0.2.0-rc.2 的包里，抄在这里免得下回再翻）：
 *   · `@deepseek-ai/dsh-agent-preset-registry` README:「Plugin registrations inherit the preset scope,
 *     and the Agent scope's parent link controls visibility」——预设 plugins 里的一行，注册出来的东西
 *     天然只属于这个预设；
 *   · `@deepseek-ai/dsh-tools` README:`ctx.tools.restrict()` 只能给一个 agent **减**工具、
 *     不能给别人加，所以「只让教练会话看见」只能靠**注册作用域**，没有别的口子；
 *   · `@deepseek-ai/dsh-scope`：「The registration context determines both visibility and ownership」。
 *
 * 依赖的 store / defineTool / panel 由 host 半边用服务 `studyCoachHost` 递过来：这一行是独立
 * import 的模块，拿不到 index.js 里的闭包，而 store 必须是**同一个** Library 实例
 * （两份实例就是两份内存缓存，面板刚写的任务工具读不到）。服务是按名字全局可见的，
 * 跨分支也读得到（跟 `agentPresets` 那条路一样），不用挂到 root 上。
 */

/** 这一行在预设 plugins 里的 id（见 lib/preset.js）。 */
export const name = 'dsh-study-coach/tools'

/** 等 host 半边的家什和工具服务都到位再注册。 */
export const inject = ['tools', 'studyCoachHost']

/**
 * 注册 21 个工具。注册用的就是这一行自己的 ctx ⇒ 落在预设作用域里。
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  /*
   * 非严格读：这一行的 ctx 在注册表那条分支上，跟提供服务的插件是兄弟分支，
   * 严格模式会额外过一道「提供者 fiber 此刻是活的吗」，跨分支没必要卡这一道。
   */
  const host = ctx.get('studyCoachHost', false)
  if (!host || typeof host.registerTools !== 'function') {
    /* 不为难自己：说清楚是哪半边没到位，别安安静静地少掉 21 个工具。 */
    console.error('[dsh-study-coach] 预设这一行拿不到 studyCoachHost，21 个 study_* 工具没注册上')
    return
  }

  return ctx.effect(() => {
    const disposers = host.registerTools(ctx, host.store, host.defineTool, {
      panel: host.panel,
      pagesRoot: host.pagesRoot,
    })
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 单个工具注销失败不该拦住别的 */
        }
      }
    }
  }, 'dsh-study-coach: 学习档案工具（只在学习教练会话里）')
}
