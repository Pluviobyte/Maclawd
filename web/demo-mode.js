/**
 * 演示模式：把 `/api/*` 接到浏览器里跑的一份运行时上。
 *
 * 这个文件**只在静态演示站生效**——本地运行时的 web/pet.html 不会加载它。
 * 这一点是刻意的：如果本地面板在服务挂掉时悄悄回落到演示数据，
 * 用户会以为自己在看自己的数据，那比页面直接报错糟得多。
 *
 * 关键决定：状态部分**跑真的 state-engine + orchestrator**（它们零依赖，
 * 能直接在浏览器里跑），而不是手写一份「差不多」的假逻辑。
 * 假逻辑迟早和真引擎跑偏，那时演示站展示的就是一个不存在的产品。
 * 用量部分才是合成的——那是数据，不是行为。
 */
(function () {
  const demo = window.MaclawdDemo;
  const Engine = window.MaclawdEngine;
  if (!demo) return;

  // ---------- 设置：只活在这个标签页里 ----------
  const settings = { ...demo.settings };

  // ---------- 真引擎 ----------
  let engine = null, orchestrator = null;
  if (Engine) {
    engine = Engine.createStateEngine();
    orchestrator = Engine.createOrchestrator({ actions: demo.actions });
    // 开场就摆一个「多会话在争」的局面，否则打开页面只看得到 idle，
    // 而仲裁表——这个面板最想说明的东西——会是空的。
    const t = Date.now();
    engine.observeEvent({ type: 'SessionStart', sessionId: 'demo-a' }, t - 30_000);
    engine.observeEvent({ type: 'SessionStart', sessionId: 'demo-b' }, t - 28_000);
    engine.observeEvent({ type: 'UserPromptSubmit', sessionId: 'demo-a' }, t - 22_000);
    engine.observeEvent({ type: 'PreToolUse', sessionId: 'demo-a', toolName: 'Read' }, t - 10_000);
    engine.observeEvent({ type: 'SubagentStart', sessionId: 'demo-b', agentId: 'a1' }, t - 7000);
    engine.observeEvent({ type: 'SubagentStart', sessionId: 'demo-b', agentId: 'a2' }, t - 4000);
  }

  function stateResponse() {
    if (!engine || !orchestrator) return demo.stateResponse();
    const now = Date.now();
    // 与本地服务同一条推进路径：喂速率 → 推进时钟 → 交给 orchestrator 选动作。
    engine.setEnergy(settings.petEnergy ? 0.58 : 1);
    engine.observeRate(settings.recordUsage ? 47_300 : 0, now);
    const state = engine.tick(now);
    return {
      demo: true,
      state,
      plan: orchestrator.plan(state.actionId, {
        variant: state.variant,
        reduced: settings.reducedMotion,
      }),
      energyEnabled: settings.petEnergy,
      debug: engine.debug(),
    };
  }

  // ---------- 路由 ----------
  const json = (body) => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

  function parse(url) {
    const u = new URL(url, location.origin);
    return { path: u.pathname, query: Object.fromEntries(u.searchParams) };
  }

  function handle(path, query, init) {
    const method = (init?.method || 'GET').toUpperCase();
    let body = {};
    if (init?.body) { try { body = JSON.parse(init.body); } catch { body = {}; } }

    if (path === '/api/summary') return demo.summaryResponse(query);
    if (path === '/api/state') return stateResponse();
    if (path === '/api/live') return demo.live();
    if (path === '/api/actions') return { actions: demo.actions };
    if (path === '/api/tools') return demo.tools();
    if (path === '/api/hooks') {
      // 安装/卸载在演示站上没有对象可写——照实返回当前状态，不假装成功。
      return demo.hooks();
    }
    if (path === '/api/lan') return demo.lan();
    if (path === '/api/permissions') return demo.permissions();
    if (path === '/api/settings') {
      if (method === 'POST') Object.assign(settings, body);
      return { settings, demo: true };
    }
    if (path === '/api/event') {
      // 交给真引擎处理，所以按钮在演示站的效果就是它在本机的效果。
      if (engine) engine.observeEvent({ sessionId: 'demo-a', ...body }, Date.now());
      return stateResponse();
    }
    // 这些会改本机文件系统，演示站上没有对应实体，明确拒绝而不是假装成功。
    if (path === '/api/reset' || path === '/api/scan'
      || path === '/api/update-prices' || path === '/api/open') {
      return { ok: false, demo: true, error: '演示站没有本机数据可操作' };
    }
    return null;
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const { path, query } = parse(url);
    if (!path.startsWith('/api/')) return nativeFetch(input, init);
    const payload = handle(path, query, init ?? (input instanceof Request ? input : null));
    if (payload === null) return nativeFetch(input, init);
    return Promise.resolve(json(payload));
  };

  // ---------- 横幅 ----------
  // 必须显眼且不可关闭：任何人看到这些数字，都得同时看到「这是编的」。
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'note');
    bar.style.cssText = 'position:sticky;top:0;z-index:9999;padding:9px 16px;'
      + 'font:500 13px/1.5 ui-sans-serif,-apple-system,"PingFang SC",sans-serif;'
      + 'background:#2b2113;color:#f4d58a;border-bottom:1px solid #6b4f1d;'
      + 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';
    bar.innerHTML = '<b>演示数据</b><span style="opacity:.85">'
      + '页面上的用量、项目名与成本全部是合成的，不是任何人的真实数据。'
      + '桌宠状态由真实的仲裁引擎在你浏览器里实时计算——事件按钮是真的。'
      + '</span><a href="https://github.com/Pluviobyte/Maclawd" '
      + 'style="margin-left:auto;color:#ffd479">源码 →</a>';
    document.body.prepend(bar);
  });
})();
