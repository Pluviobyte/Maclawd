# Claude active subscription quota

## References checked on 2026-09-10

- Official Agent SDK npm `@anthropic-ai/claude-agent-sdk@0.3.267`: `SDKControlGetUsageRequest` / `SDKControlGetUsageResponse`. The API is explicitly experimental. `skip_behaviors` avoids scanning recent transcripts for an unrelated behavioral report.
- [vibe-usage-app](https://github.com/vibe-cafe/vibe-usage-app/tree/34d50754e0504b4a33b87d1f7927d462f30cb98e): latest main and stable v0.5.10 match. Checked ClaudeUsageProbe, ClaudeUsageCache and RateLimitCoordinator, and merged fixes #32/#34/#35.
- [Pending upstream #40](https://github.com/vibe-cafe/vibe-usage-app/pull/40): process-local empty-string override for `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, since settings.env can reintroduce it after spawn. Adopted independently and validated against the installed official CLI; the user settings file is not edited.
- [OpenUsage](https://github.com/robinebers/openusage/tree/70dea9a8fa21ed205aa9ad625b416a1e7792d5a1), latest stable v0.7.11: ClaudeAuthStore and ClaudeProvider confirm server quota units and failure/backoff concerns. We use the official process instead of accessing OAuth credentials directly.
- vibe-usage CLI main `850f27dcf1db511b8c48a7ec93a27f77d1b35437`, stable v0.10.21: local token log synchronization is separate from account quota collection.

## Reader and collector

`claude-quota.js` discovers the user CLI before the newest Desktop-managed binary, deduplicating symlink aliases. An explicit `MACLAWD_CLAUDE_BIN` override is exclusive, including when missing, so isolated runtimes never fall through to a different installation. `CLAUDE_CONFIG_DIR` is preserved.

The child has no tools, MCP servers, plugins, hooks or session persistence. It exchanges only initialize and get_usage control requests, never a user prompt. The official process owns credentials and refresh-token rotation. stdout is bounded; stderr and raw errors never enter runtime responses. Cancellation/timeout terminates the owned process group. Each candidate has at most eight seconds within a shared 25-second budget.

Only recognized numeric five-hour and weekly subscription windows are recorded. Null, malformed or missing limits never become zero. Reset timestamps are converted from ISO-8601 to epoch milliseconds. Probe session cost is not written over real-session cost. Optional response extensions are ignored.

The collector deduplicates in-flight requests, caches success for 60 seconds, supports five-minute background polling, and backs failures off to 15 minutes. Even forced refreshes respect failure backoff. Errors preserve lastSuccessAt. Stop/disable prevents late results from persisting. A definitive non-subscription response has a separate unavailable callback so it can remove only the Claude account snapshot.

## Stage 1 validation

Nine targeted tests cover units and plans, null/malformed values, isolated startup arguments, CLI/Desktop discovery, a real fixture subprocess exchanging split JSON lines, timeouts/abort/output bounds, fallback time budgets, cache/backoff, and late-result cancellation. A live read using the implementation succeeded against official Claude Code 2.1.260 without sending a prompt. No account details or raw responses are included in this document.

## Stage 2 runtime and UI

The existing `/api/quota` read schedules a cached Claude refresh without delaying the response. `serve` starts background polling, and shutdown/collection switches stop the worker. Status is exposed as `claude` with sanitized failure messages. A recently successful live read remains authoritative over cached terminal statusline windows for five minutes; statusline context/cost still flows, and its limits are accepted again when the active collector fails or becomes stale.

A definitive non-subscription answer removes only Claude's quota source. Transient failures preserve both old limits and their actual acquisition time. The native panel decodes refresh/error state independently of statusline availability, and settings now explain automatic fetching instead of asking users to start a conversation.

Integration tests exercise the real HTTP server, persistent quota store, switch cancellation/restart, custom-statusline coexistence and the compiled Swift decoder. Test binaries and temporary profiles are isolated from real credentials.
