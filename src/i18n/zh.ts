const zh = {
  // Header
  "app.title": "Claude Agent Starter",
  "app.subtitle": "基于 EdgeOne Makers 运行，支持沙箱工具、会话记忆和可观测性",

  // Empty state
  "empty.title": "Claude Agent Starter",
  "empty.hint": "我是运行在 EdgeOne 上的 Claude 助手。我可以调用沙箱工具、持久化会话记忆，并帮助你进行调试、文件管理、代码执行和网页浏览。",
  "empty.features": "沙箱工具 · 会话记忆 · 可观测性",

  // Chat input
  "chat.placeholder": "输入消息...  ⏎ 发送 · Shift+⏎ 换行",
  "chat.hint": "由 Claude Agent SDK + EdgeOne Makers 驱动 · 仅供演示",

  // Preset questions
  "preset.1": "使用终端命令检查当前系统时间和操作系统版本。",
  "preset.2": "创建 /tmp/fib.py，写入计算斐波那契数列前 10 项的 Python 代码并执行，将结果打印出来。",
  "preset.4": "访问 https://edgeone.ai 并总结页面内容。",
  "preset.screenshotEdgeOne": "截取 edgeone.ai 的网页图片。",
  "preset.skill.sandboxAlgorithms": "计算斐波那契数列前 20 个，并给出执行结果。",

  // Skill indicators
  "skill.sandboxAlgorithms": "沙箱算法执行",

  // Tool indicators
  "tool.commands": "命令行",
  "tool.files": "文件",
  "tool.codeRunner": "代码运行",
  "tool.browser": "浏览器",

  // Web search activity (in-bubble chip)
  "webSearch.error.wsaMissing": "搜索不可用，需配置 WSA API Key",
  "webSearch.error.wsaCta": "获取 Key",

  // Debug panel
  "debug.title": "Trace",
  "debug.events": "事件",
  "debug.clear": "清除",
  "debug.empty": "等待 SSE 事件...",
  "debug.emptyHint": "发送消息后，所有原始后端数据将在此处显示。",

  // Status & errors
  "status.error": "请求失败，请检查后端服务是否正常运行。",
  "status.stopped": "⏹ *已停止生成*",
  "status.backendError": "后端中止请求失败，服务器可能仍在运行。",

  // Language toggle
  "lang.switch": "English",

  // Sidebar
  "sidebar.label": "会话列表",
  "sidebar.title": "会话",
  "sidebar.newChat": "新建聊天",
  "sidebar.loading": "正在加载会话...",
  "sidebar.loadMore": "加载更多",
  "sidebar.loadingMore": "加载中...",
  "sidebar.emptyTitle": "暂无会话",
  "sidebar.emptyHint": "点击「新建聊天」开始第一段对话。",
  "sidebar.delete": "删除会话",
  "sidebar.deleteConfirm": "确定要永久删除这个会话吗？此操作不可恢复。",

  // Aria labels (button hover/screen-reader)
  "aria.send": "发送",
  "aria.clearHistory": "清除历史",
  "aria.stopGeneration": "停止生成",
} as const;

export default zh;
