# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-08-05
- Primary product surfaces: change-log workbench, local Archive viewer, Agent Job Center, independent Technical QA workspace
- Evidence reviewed: `README.md`, `src/App.tsx`, `src/App.css`, `src/agentJobs/AgentJobCenter.tsx`, `docs/assets/readme/archive-diff-workbench.png`, and the approved Technical QA PRD/test specification in the immutable handoff packet

## Brand
- Personality: quiet, precise, technical, and trustworthy; optimized for repeated desktop work rather than promotion
- Trust signals: explicit state, source citations, scoped capabilities, stable layouts, and sanitized errors
- Avoid: marketing layouts, oversized headings, decorative cards, rounded pill-heavy UI, one-color screens, and hidden automation

## Product goals
- Goals: make Y3 diagnostic and archive workflows fast to scan; make Technical QA a first-class top-level workspace; keep evidence, runtime state, and terminal outcomes understandable
- Non-goals: a landing page, a general chat client, project-directory access, code patching, saving, publishing, BYOK, or model/provider selection
- Success signals: users can switch modules without losing work, ask ECA or Lua questions, follow incremental answers, inspect citations, and recover clearly from unavailable/refusal/error states

## Personas and jobs
- Primary personas: Y3 map makers, gameplay scripters, technical support staff, and maintainers diagnosing editor/Lua behavior
- User jobs: inspect archive data, submit bounded service tasks, ask a technical question, compare the answer with cited sources, and refine an ambiguous question
- Key contexts of use: Windows Electron desktop, long sessions, dense technical data, occasional narrow laptop windows, and slow or unavailable service connections

## Information architecture
- Primary navigation: one compact top-level segmented control with `变动日志`, `本地 Archive`, `Agent 任务`, and `技术问答`
- Core routes/screens: existing three workspaces plus the independent Technical QA workspace
- Content hierarchy: module navigation first; Technical QA thread/history rail second; active conversation and answer evidence third; composer remains a stable final action area

## Design principles
- Preserve context: switching modules must not destroy loaded archive or active QA state.
- Show system truth: distinguish connecting, retrieving, streaming, completed, follow-up, refusal, cancelled, protocol failure, and unavailable states.
- Evidence stays inspectable: citations are adjacent to the answer and include authority, locator, and Y3 2.0 scope.
- Bound the product: fixed Y3 2.0 scope and two domain modes are visible; forbidden project capabilities are absent, not merely disabled.
- Tradeoffs: prefer dense desktop ergonomics and clear boundaries over conversational ornament; collapse secondary history before compressing answer readability.

## Visual language
- Color: reuse existing graphite and paper tokens; use restrained semantic green/amber/red/blue accents only for status and evidence authority
- Typography: Noto Sans SC for UI/content and JetBrains Mono for identifiers, cursors, source locators, and compact metadata
- Spacing/layout rhythm: 4/8/12/16/24 px rhythm; stable header and composer; scroll conversation content independently
- Shape/radius/elevation: square to 6 px radii, thin borders, minimal elevation, no cards nested inside cards
- Motion: short state transitions only; no decorative animation; honor reduced motion
- Imagery/iconography: use the existing Ant Design icon set for familiar actions; no decorative illustrations in the operational workspace

## Components
- Existing components to reuse: app shell, Ant Design segmented controls, buttons, alerts, tooltips, tags, typography, and theme provider
- New/changed components: Technical QA workspace, thread rail, turn transcript, runtime status strip, citation list, domain segmented control, composer, cancel/retry actions, and health banner
- Variants and states: empty, connecting, ready, submitting, retrieving, streaming, answer, follow-up, refusal, cancelled, error, protocol error, and unavailable
- Token/component ownership: global shell tokens stay in `src/App.css`; Technical QA-specific styles stay with the `src/technicalQa` module

## Accessibility
- Target standard: practical WCAG 2.1 AA for contrast, keyboard use, semantics, and status announcements
- Keyboard/focus behavior: all navigation and actions are reachable; composer supports submit without trapping multiline entry; focus returns predictably after submit/cancel
- Contrast/readability: body text and citations must remain readable in both themes; status is never encoded by color alone
- Screen-reader semantics: conversation uses labelled regions; streaming/status updates use restrained live regions; citation buttons expose source titles
- Reduced motion and sensory considerations: disable nonessential transitions under `prefers-reduced-motion`

## Responsive behavior
- Supported breakpoints/devices: desktop-first from 1280 px, compact desktop/tablet down to 760 px, narrow layout below 760 px
- Layout adaptations: desktop uses history rail plus conversation; compact layouts reduce the rail width; narrow layouts turn history into a bounded top section and keep the composer full width
- Touch/hover differences: primary commands retain visible labels on touch widths; hover is supplemental only

## Interaction states
- Loading: show the current phase and preserve prior turns
- Empty: place the composer in the active workspace with concise domain prompts, not a marketing card
- Error: show sanitized retry guidance without provider, endpoint, filesystem, or credential detail
- Success: settle streamed text into a terminal answer and reveal validated citations
- Disabled: disable submit only for empty input, active submission constraints, or service unavailability; explain the state near the control
- Offline/slow network: preserve draft and history, show health degradation, use bounded polling, and allow cancellation while a turn is active

## Content voice
- Tone: direct, technical, calm, and specific
- Terminology: `技术问答`, `Y3 2.0`, `ECA / 编辑器`, `Lua / y3-lualib`, `引用来源`, `需要补充`, `证据不足`
- Microcopy rules: state what happened and the next valid action; never mention hidden reasoning, provider internals, raw errors, or unsupported future capabilities

## Implementation constraints
- Framework/styling system: React 19, TypeScript, Ant Design 6, existing icon package, plain CSS
- Design-token constraints: extend existing CSS variables and both tone scopes; do not add a new theme layer or dependency
- Performance constraints: bounded polling, stable list keys, independent scroll regions, and no full-workspace rerender from each unrelated shell state change
- Compatibility constraints: Electron and browser transports share public DTOs; QA uses header-only `X-QA-Session`; existing module keep-alive semantics remain intact
- Test/screenshot expectations: unit tests cover transport/reducer/controller/render states; full type/lint/test/build gates; browser screenshots at desktop and narrow widths must show no overlap or clipping

## Open questions
- [ ] None blocking G003; future uploaded-diagnosis and MCP surfaces belong to later Ultragoal stories and must not be prebuilt here.
