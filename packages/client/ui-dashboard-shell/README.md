# @deepseek-ai/dsh-client-ui-dashboard-shell

English | [中文](README.zh.md)

Product shell plugin (phase 1 of the Agent-native Dashboard): a dark two-column product frame registered into the runtime's built-in `root` slot at priority `-1` — the lowest rank renders, so this entry shadows the native AppFrame's priority-0 registration and takes over the whole browser surface. The shell is opt-in: the shipped [web-app bundle](../../bundle/web-app/cordis.patch.yml) stays native, and the [dashboard overlay](../../bundle/web-app/dashboard.patch.yml) inserts this shell, sets `ui-layout` to `registerRoot: false`, disables the native chrome (ui-sidebar / ui-settings-* / ui-brand-official / ui-workspace / ui-input-trigger / ui-commands / ui-skill / ui-subagent / ui-reference / ui-jobs / ui-goal / ui-message-feedback / ui-model-selection / ui-permission-presets / ui-agent-preset / ui-settings-plugins / ui-plan / ui-user-questions / ui-trajectory and the conversation-adjacent feature seats), and keeps the low-level services (client-runtime, ui-renderer, ui-theme, locale, ui-settings) plus `ui-conversation` so the Dashboard main region can re-host the real chat surface.

The frame owns Agent selection as component-local state and projects the read-only `useSessions` / `useWorkspaces` standard hooks into the selected Agent's dashboard: stat cards (workspace / session / running counts) and a workspace-grouped Session list. Clicking a Session row opens it through the runtime sessions service; **New session** starts the runtime's shared New Session flow (`workspaces.startSession`), globally or per Workspace.

The frame declares two root-scope child seats and renders them through `renderSlot` with built-in fallbacks, so a future phase can replace either region by registering into the hole:

- `dashboard.sidebar` — the Agent navigation rail (the built-in fallback renders the static roster `coder` / `btender` / `invest` / `video`).
- `dashboard.main` — the selected Agent's dashboard (the built-in fallback renders the stats plus the grouped Session list).

There is no profile plane yet: the Agent roster is static, Sessions are not filtered by Agent, and New Session does not create a Profile atomically — those are later phases.

`DashboardFrameComponentProps` composes the root owner share, the global `useSessions` and `useWorkspaces` hooks, the two child-slot render shares, and the injected `openSession` / `startSession` callbacks. There is no plugin store.

The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; DashboardFrame, the fallbacks, and the grouping projection remain package-internal behind the slot registration.

## Model Experience

None, as the dashboard shell renders the browser session list; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Static Agent roster** — `coder` / `btender` / `invest` / `video` are hard-coded; the future Profile plane keys these ids and derives the roster from `profiles/`.
- **No Agent-to-Session filtering** — every Session is shown under every Agent; per-Agent Session lists arrive with Profile binding.
- **No atomic Profile creation** — New Session only calls `workspaces.startSession()`; Profile plus Session binding is a later phase.
- **No Session actions** — rows only open; rename / fork / archive belong to a later phase.
