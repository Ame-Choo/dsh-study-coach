/**
 * 「学习教练」agent 预设的定义。
 *
 * DSH 0.2.0-rc.2 里，预设不再是 `~/.dsh/.agent-presets/<slug>/` 那种目录（那是老机制的残留），
 * 而是 host 平面 `agentPresets` 注册表里的一条声明。声明有两条路：
 *   1. 在某个 bundle 的 cordis.patch.yml 里 insert 一行 `@deepseek-ai/dsh-agent-preset`；
 *   2. 直接调 `ctx.agentPresets.register(definition)`（`@deepseek-ai/dsh-agent-preset` 内部就干这个）。
 *
 * 这里走第 2 条：包名 `@deepseek-ai/dsh-agent-preset` 在 profile 的 node_modules 里解析不到，
 * 写进 patch 会让 loader 直接报错；而 `register` 拿到的 `plugins` 由预设注册表自己 mount，
 * 解析基准是注册表所在的 asar，`@deepseek-ai/dsh-*` 那些包名一个都不会缺。
 *
 * `plugins` 抄的是 DSH 自带的 `standard` 预设（@deepseek-ai/dsh-web-app/presets/standard.patch.yml），
 * 只把 persona 换成学习教练，这样工具目录跟用户当前用的预设完全一致，不会因为少一行而挂载失败。
 */

import { fileURLToPath } from 'node:url'

/**
 * 随插件一起发的 skill 根目录，结构是 `skills/<name>/SKILL.md`。
 * 挂给 skill-filesystem 的 customSkillDirs，进这个模式就多一份《学习教练工作法》可以按需加载，
 * 不用把整篇方法论塞进常驻的 persona。
 */
const SKILLS_DIR = fileURLToPath(new URL('../skills', import.meta.url))

/** 学习教练的人设，写进 persona 的 prefix。 */
const PERSONA_PREFIX = [
  '你是这位学生的专属学习教练，现在跑在学习教练模式下。',
  '',
  '每次开口先调一次 study_report：它给你学习目标、知识地图、掌握度、今天的任务、材料清单、面板顶部提示（guide），以及学生在面板上留的言（inboxItems）。有留言就先处理，处理完调 study_inbox 并传 action=read 清掉。',
  '面板对学生是只读的：学习目标、材料清单、知识地图这三样只能由你在对话里写进去，用 study_goal / study_material / study_map。别让学生自己去面板上填。',
  '知识地图一开始是草稿。你先根据学生丢来的教辅、讲义和网课目录（目录可能只是个文件夹，文件名自己解析）画一版，念给学生过一遍，学生认可了再调 study_map 传 action=confirm。学生没看过的地图不许定稿。',
  '掌握度只认证据：自评、摸底题结果、作业照片、上过的课。一次只推进一档，note 里写清哪天、哪份材料、什么表现。',
  '排计划要卡住学生说的每天分钟数，任务落到具体材料上（看第几讲、做哪几页、配几道题）。',
  '用中文、短句、傲娇鲸鱼娘的口吻说话。',
].join('\n');

const PLAN_MODE_SECTION = `You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.

Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.

The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.

Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.

Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.

When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.`;

/** 预设 id，列表里和会话记录里都用它。 */
export const PRESET_ID = 'study-coach';

/** 给 host `agentPresets.register` 的 PresetDefinition。 */
export function buildPreset() {
  const win = process.platform === 'win32';
  return {
    id: PRESET_ID,
    name: '学习教练',
    description: '对话里问清目标、解析教辅与网课目录、生成知识地图、排每日任务，配 /study 面板。',
    order: 2,
    plugins: [
      {
        id: 'persona',
        name: '@deepseek-ai/dsh-persona',
        config: { suffix: 'Your working directory is {{cwd}}.', prefix: PERSONA_PREFIX },
      },
      { id: 'agent-instructions', name: '@deepseek-ai/dsh-agent-instructions', config: { maxBytes: 65536 } },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: win },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: !win },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'tool-fs-search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } },
      { id: 'tool-jobs', name: '@deepseek-ai/dsh-tool-jobs' },
      { id: 'skill-filesystem', name: '@deepseek-ai/dsh-skill-filesystem', config: { customSkillDirs: [SKILLS_DIR] } },
      { id: 'tool-skill', name: '@deepseek-ai/dsh-tool-skill' },
      { id: 'command-goal', name: '@deepseek-ai/dsh-command-goal' },
      { id: 'tool-goal', name: '@deepseek-ai/dsh-tool-goal' },
      {
        id: 'planning',
        name: 'cordis:group',
        group: true,
        isolate: { planMode: true },
        config: [
          { id: 'plan-mode', name: '@deepseek-ai/dsh-plan-mode', config: { section: PLAN_MODE_SECTION } },
        ],
      },
      {
        id: 'compaction',
        name: 'cordis:group',
        group: true,
        isolate: { compaction: true, toolResultPruner: true },
        config: [
          { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic' },
          { id: 'command-compact', name: '@deepseek-ai/dsh-command-compact' },
          {
            id: 'tool-result-pruner',
            name: '@deepseek-ai/dsh-compaction-tool-result-pruner',
            config: { thresholdChars: 8192, headChars: 4096, tailChars: 1024 },
          },
        ],
      },
      {
        id: 'delegation',
        name: 'cordis:group',
        group: true,
        isolate: { workflowEngine: true },
        config: [
          { id: 'tool-subagent-control', name: '@deepseek-ai/dsh-tool-subagent-control' },
          { id: 'tool-subagent-list-agents', name: '@deepseek-ai/dsh-tool-subagent-control/list-agents' },
          {
            id: 'tool-subagent',
            name: '@deepseek-ai/dsh-tool-subagent',
            config: {
              provider: 'spawn',
              toolName: 'subagent',
              modelSelectionSettings: true,
              backgroundMode: 'continuable',
            },
          },
          {
            id: 'tool-subagent-fork',
            name: '@deepseek-ai/dsh-tool-subagent',
            config: { provider: 'fork', toolName: 'subagent_fork', backgroundMode: 'continuable' },
          },
          {
            id: 'tool-subagent-codex',
            name: '@deepseek-ai/dsh-tool-subagent',
            disabled: true,
            config: {
              provider: 'codex',
              toolName: 'subagent_codex',
              backgroundMode: 'one-shot',
              maxDepth: 'provider-managed',
            },
          },
          {
            id: 'tool-subagent-claude-code',
            name: '@deepseek-ai/dsh-tool-subagent',
            disabled: true,
            config: {
              provider: 'claude-code',
              toolName: 'subagent_claude_code',
              backgroundMode: 'one-shot',
              maxDepth: 'provider-managed',
            },
          },
          { id: 'workflow-ptc', name: '@deepseek-ai/dsh-workflow-ptc', config: { provider: 'spawn' } },
          { id: 'tool-workflow', name: '@deepseek-ai/dsh-tool-workflow' },
          {
            id: 'tool-ralph',
            name: '@deepseek-ai/dsh-tool-ralph',
            disabled: true,
            config: { subagentProvider: 'spawn', maxRounds: 64 },
          },
        ],
      },
      { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' },
      { id: 'tool-todo', name: '@deepseek-ai/dsh-tool-todo', config: { allowParallelInProgress: true } },
      { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: true, searchTimeoutMs: 60000 } },
      { id: 'present', name: '@deepseek-ai/dsh-tool-present' },
      { id: 'tool-plugin-manager', name: '@deepseek-ai/dsh-plugin-manager/tools', disabled: true },
    ],
  };
}

/**
 * 把预设登记进 host 注册表。`agentPresets` 不在（比如 TUI 那种没有 web-app bundle 的场面）就安静跳过，
 * 面板和工具照常工作，不能因为预设登记不上就整个插件不加载。
 * @returns 清理函数
 */
export function registerPreset(ctx, { preset } = {}) {
  const definition = preset ?? buildPreset();

  const mount = (scoped) => {
    const presets =
      scoped.agentPresets ?? (typeof scoped.get === 'function' ? scoped.get('agentPresets') : null);
    if (!presets || typeof presets.register !== 'function') return () => {};

    return scoped.effect(() => {
      let dispose = null;
      let dead = false;
      const pending = Promise.resolve()
        .then(() => presets.register(definition))
        .then(
          (d) => {
            if (dead) void d();
            else dispose = d;
          },
          (err) => {
            console.error('[dsh-study-coach] 预设登记失败：', err);
          },
        );
      return () => {
        dead = true;
        void pending;
        if (dispose) void dispose();
      };
    }, 'dsh-study-coach: 学习教练预设');
  };

  // 服务没到位时要等：agentPresets 由 web-app bundle 提供，加载顺序不保证在插件前面。
  if (typeof ctx.inject === 'function') return ctx.inject(['agentPresets'], mount);
  return mount(ctx);
}
