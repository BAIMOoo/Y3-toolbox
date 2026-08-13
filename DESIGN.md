# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-08-13
- Primary product surfaces: change-log workbench, local Archive viewer, Agent Job Center, independent Technical QA workspace, dedicated Feedback workspace
- Evidence reviewed: `README.md`, `src/App.tsx`, `src/App.css`, `src/agentJobs/AgentJobCenter.tsx`, `docs/assets/readme/archive-diff-workbench.png`, the approved Technical QA handoff packet, and `.omx/plans/prd-user-feedback.md` plus `.omx/plans/test-spec-user-feedback.md`

## Brand
- Personality: quiet, precise, technical, and trustworthy; optimized for repeated desktop work rather than promotion
- Trust signals: explicit state, source citations, scoped capabilities, stable layouts, and sanitized errors
- Avoid: marketing layouts, oversized headings, decorative cards, rounded pill-heavy UI, one-color screens, and hidden automation

## Product goals
- Goals: make Y3 diagnostic and archive workflows fast to scan; make Technical QA and Feedback distinct first-class workspaces; give users a clear anonymous channel for actionable Bugs and Feature Requests; keep evidence, runtime state, and terminal outcomes understandable
- Non-goals: a landing page, a general chat client, project-directory access, automatic diagnostics, feedback status tracking or history, reply promises, code patching, saving, publishing, BYOK, or model/provider selection
- Success signals: users can switch modules without losing work, submit a structured anonymous Bug or Feature Request, retain a feedback draft after retryable failure, and receive a clear acknowledgement without a tracking identifier

## Personas and jobs
- Primary personas: Y3 map makers, gameplay scripters, technical support staff, and maintainers diagnosing editor/Lua behavior
- User jobs: inspect archive data, submit bounded service tasks, ask a technical question, report a reproducible product problem, and describe a desired improvement with its scenario and value
- Key contexts of use: Windows Electron desktop, long sessions, dense technical data, occasional narrow laptop windows, and slow or unavailable service connections

## Information architecture
- Primary navigation: one compact top-level segmented control with `变动日志`, `本地 Archive`, `Agent 任务`, and `技术问答`; `反馈` is a persistent utility action immediately left of the theme switch
- Core routes/screens: the existing workspaces, the independent Technical QA workspace, and a dedicated form-first Feedback workspace
- Content hierarchy: module navigation first; the active workspace second; Feedback starts with type as the first question, then asks only for a title and one primary description before an optional progressive-disclosure section for diagnostics, contact, attachments, and disclosed metadata

## Design principles
- Preserve context: switching modules must not destroy loaded archive or active QA state.
- Show system truth: distinguish connecting, retrieving, streaming, completed, follow-up, refusal, cancelled, protocol failure, and unavailable states.
- Evidence stays inspectable: citations are adjacent to the answer and include authority, locator, and Y3 2.0 scope.
- Bound the product: fixed Y3 2.0 scope and two domain modes are visible; forbidden project capabilities are absent, not merely disabled.
- Keep Feedback distinct: reuse shell and narrow validation patterns, but never Technical QA conversation state, wording, history, or routes.
- Make privacy inspectable: show the exact bounded client metadata and attachment review warning before submission; collect no paths, project contents, credentials, or device fingerprint.
- Minimize feedback effort: require only the information needed to understand the report; keep diagnostic structure available as optional progressive disclosure instead of presenting a long mandatory questionnaire.
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
- New/changed components: Technical QA workspace components plus a Feedback workspace, Bug/Feature Request selector, structured field groups, Bug attachment picker/list, privacy disclosure strip, submit action, and acknowledgement state
- Variants and states: empty, ready, validating, uploading, submitting, success, rate-limited, unavailable, retryable error, and non-retryable validation error; Feedback success is acknowledgement-only and exposes no backend ID, Admin URL, status, or history affordance
- Token/component ownership: global shell tokens stay in `src/App.css`; Technical QA styles stay in `src/technicalQa`; Feedback state, components, and styles stay in a separate `src/feedback` module

## Accessibility
- Target standard: practical WCAG 2.1 AA for contrast, keyboard use, semantics, and status announcements
- Keyboard/focus behavior: all navigation and actions are reachable; composers and feedback text areas support expected multiline entry; validation focuses or identifies the first invalid field; attachment removal and submit remain keyboard operable
- Contrast/readability: body text and citations must remain readable in both themes; status is never encoded by color alone
- Screen-reader semantics: conversation uses labelled regions; streaming/status and Feedback submission results use restrained live regions; feedback field errors are programmatically associated; citation and attachment-removal buttons expose descriptive labels
- Reduced motion and sensory considerations: disable nonessential transitions under `prefers-reduced-motion`

## Responsive behavior
- Supported breakpoints/devices: desktop-first from 1280 px, compact desktop/tablet down to 760 px, narrow layout below 760 px
- Layout adaptations: desktop Technical QA uses history rail plus conversation; compact layouts reduce the rail width; Feedback uses a stable one-column form with bounded readable width, while narrow layouts stack type controls, metadata, attachments, and actions without horizontal clipping
- Touch/hover differences: primary commands retain visible labels on touch widths; hover is supplemental only

## Interaction states
- Loading: show the current phase and preserve prior turns or feedback draft data
- Empty: place the active tool or form directly in its workspace, not in a marketing card
- Error: show sanitized retry guidance without provider, endpoint, filesystem, credential, or storage detail; retryable Feedback failures preserve entered text and selected attachments
- Success: settle streamed QA text into a terminal answer; Feedback shows only a concise acknowledgement and clears the submitted draft without exposing a trackable identifier
- Disabled: disable submit only for invalid input, an active submission, or service unavailability; explain the reason next to the action
- Offline/slow network: preserve QA history and Feedback draft state, show health degradation, use bounded polling where applicable, and avoid false success after ambiguous failures

## Content voice
- Tone: direct, technical, calm, and specific
- Terminology: `技术问答`, `反馈`, `Bug`, `功能需求`, `Y3 2.0`, `ECA / 编辑器`, `Lua / y3-lualib`, `引用来源`, `需要补充`, `证据不足`
- Microcopy rules: state what happened and the next valid action; Feedback copy identifies Y3 Toolbox as the primary intake scope and says Y3 Editor reports are recorded without promising timely handling; never mention hidden reasoning, provider internals, raw errors, backend feedback IDs, reply promises, tracking status, or unsupported future capabilities

## Implementation constraints
- Framework/styling system: React 19, TypeScript, Ant Design 6, existing icon package, plain CSS
- Design-token constraints: extend existing CSS variables and both tone scopes; do not add a new theme layer or dependency
- Performance constraints: bounded polling, stable list keys, independent scroll regions, and no full-workspace rerender from each unrelated shell state change
- Compatibility constraints: Electron and browser transports share public DTOs; QA and Feedback use separate route/header/IPC boundaries; existing module keep-alive semantics remain intact; cross-repository Feedback DTOs use schema-versioned independent definitions verified by deterministic fixtures
- Test/screenshot expectations: unit tests cover transport/state/validation/render states; full type/lint/test/build gates; Feedback screenshots at desktop and narrow widths must show the form, privacy disclosure, attachment controls, errors, and actions without overlap or clipping

## Open questions
- [ ] None blocking Feedback V1; user-visible status tracking, replies, automatic diagnostics, and Admin mutations require separate product approval.
