/** Chinese UI strings — the source of truth for the key set (DECISIONS §16).
 *  Values must stay byte-identical to the previously hardcoded literals so the
 *  zh-selector E2E suite and recorded behaviour don't shift. */

export const zh = {
  // ---- TokenGate -----------------------------------------------------------
  "gate.subtitle": "轻量科研演化地图 · 输入访问令牌打开工作站",
  "gate.token.placeholder": "访问令牌（Bearer token）",
  "gate.open": "打开",
  "gate.opening": "打开…",
  "gate.err.network": "无法连接服务器",
  "gate.note":
    "令牌只保存在页面内存中，刷新后需要重新输入；不会写入 Cookie、localStorage 或 URL。 本应用不需要任何模型 API Key。",

  // ---- EmptyProjects (App.tsx) ----------------------------------------------
  "empty.enter.or.create": "进入一个已有项目，或新建一个：",
  "empty.none": "还没有可用的项目——先创建第一个项目吧。",
  "empty.enter.btn": "进入「{name}」（v{rev}）",
  "empty.name.label": "项目名（1–100）",
  "empty.name.placeholder": "如：富锂锰基正极的循环衰减机制",
  "empty.objective.label": "研究目标（1–4000）",
  "empty.objective.placeholder": "你要回答什么问题？",
  "empty.create.err": "创建项目失败（请检查网络/令牌）",
  "empty.create": "创建项目",
  "empty.creating": "创建中…",
  "empty.refresh": "刷新项目列表",
  "empty.refreshing": "刷新中…",
  "empty.note":
    "项目数据保存在本服务器（SQLite 卷）。创建与编辑走同一条提交协议， 写操作都带令牌名身份（actor），不可伪造。",

  // ---- TopBar ---------------------------------------------------------------
  "topbar.switch.project": "切换项目",
  "topbar.new.project": "+ 项目",
  "topbar.new.project.title": "创建项目",
  "topbar.search.placeholder": "搜索标题/摘要/标签/观察/结论（中文子串可用）",
  "topbar.search.head": "搜索结果（点击 = 展开祖先并定位，不隐藏主树）",
  "topbar.search.count": " · 共 {n}",
  "topbar.search.loading": "检索中…",
  "topbar.search.empty": "无匹配（折叠不影响搜索覆盖）",
  "topbar.new.route": "+ 一级路线",
  "topbar.more.title": "更多：项目设置 / 适应当前图 / 近期变化 / 导出 / AI 接入",
  "topbar.menu.project.settings": "项目设置",
  "topbar.menu.fit": "适应当前图",
  "topbar.menu.show.archived": "显示已归档节点",
  "topbar.menu.hide.archived": "隐藏已归档节点 ✓",
  "topbar.menu.recent": "近期变化 ▾",
  "topbar.menu.no.commits": "暂无提交",
  "topbar.menu.export": "导出",
  "topbar.menu.export.title": "下载完整项目 JSON（含归档与历史）",
  "topbar.menu.ai": "AI 接入说明",
  "topbar.menu.lang.to_en": "切换为 English",
  "topbar.menu.lang.to_zh": "切换为 中文",
  "topbar.refresh": "刷新",
  "topbar.refresh.title": "手动检查记录是否变化",
  "topbar.actor": "身份: {actor}",
  "topbar.actor.title": "本次会话的访问者身份（由令牌决定，不可伪造）",
  "topbar.conn.version": " · v{v}",
  "topbar.conn.project": " · 项目 v{v}",
  "topbar.exit": "退出",
  "topbar.exit.title": "退出（清空页面内存中的令牌，需重新输入）",

  // ---- formatters (used across screens) -------------------------------------
  "common.first.level.node": "一级节点",
} as const;

export type DictKey = keyof typeof zh;
