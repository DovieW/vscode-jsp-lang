# JSP Scope Reset Plan (Rollback + Core Completeness)

Date: 2026-02-02

## Summary
This plan refocuses the extension on “full JSP editor support” by rolling back non-core tooling (profiling + Java debug adapter hooks) and completing missing editor-centric functionality (EL support + pragmatic project configuration). It keeps the language server and taglib intelligence, but avoids expanding into IDE/profiling territory.

## Goals
- Keep JSP editing **first-class** in VS Code (HTML/CSS + JSP semantics + taglibs).
- Reduce scope creep by removing profiling and debug adapter extras.
- Add missing editor features: **Expression Language (EL)** support and **project configuration**.

## Non-goals
- Full Java type resolution/classpath integration for scriptlets.
- IDE-level debugging/profiling features inside this extension.

## Rollback scope (Milestone A)
**Remove the following as “non-core”**:
- Profiling subsystem (`src/profiling/**`, commands, view, webview, settings).
- Java debug extras (`src/debug/**` stack-frame rewrite + breakpoint translation), settings, and activation events.

**How to identify commits to revert**:
- Use path-limited history (e.g., `git log -- src/profiling src/debug package.json`) to find commit ranges.
- Prefer `git revert` of those ranges to preserve history and minimize risk.
- If a commit mixes core/editor changes with profiling/debug, manually back out only the relevant hunks.

**Clean‑up checklist**:
- Remove imports/registrations in `src/extension.ts`.
- Remove commands/views/activation events/config in `package.json`.
- Remove tests and fixtures tied to profiling/debug.
- Update README/FEATURES/FEASIBILITY to reflect the tighter scope.

## Core completeness (Milestone B)
### 1) EL support (lightweight, tolerant)
- Add EL region extraction for `${...}` / `#{...}` (similar to `extractJavaRegions`).
- Provide completions for EL implicit objects: `pageScope`, `requestScope`, `sessionScope`, `applicationScope`, `param`, `paramValues`, `header`, `headerValues`, `cookie`, `initParam`.
- Provide basic hover information (static descriptions).
- Ensure HTML/CSS diagnostics ignore EL contents to avoid false positives.

### 2) Project configuration (Feature 9, simplified)
- Add `jsp.webRoots` setting with sane defaults.
- Add include resolve strategy: `relative | webRoot | both`.
- Add a “Diagnose configuration” command that prints resolved roots, taglib globs, and include strategy to the output channel.
- Keep taglib config lightweight and avoid full build-system modeling.

### 3) Scriptlets (keep simple)
- Maintain existing implicit object completions.
- Keep **optional** Java syntax diagnostics, but no classpath or type resolution.

## Quality & tests (Milestone C)
- Add fixture tests for EL parsing/completions.
- Add tests for include resolution using the new config.
- Ensure taglib diagnostics and HTML/CSS behaviors remain unchanged after rollback.

## Milestones & sequence
1. **Milestone A (Rollback):** revert profiling/debug extras and clean config/docs.
2. **Milestone B (EL + config):** implement EL support + configuration diagnostics.
3. **Milestone C (Tests + polish):** tests, regression checks, and docs updates.

## Acceptance criteria
- Extension no longer registers profiling/debug commands or views.
- JSP files get EL completions/hover without breaking HTML/CSS diagnostics.
- Include/taglib resolution can be fixed via settings (no code changes required).
- Existing taglib features still work after rollback.

## Risks & mitigations
- **Risk:** Removing debug extras disappoints some users.
  - **Mitigation:** Document them as optional future add-ons.
- **Risk:** EL parsing is imperfect.
  - **Mitigation:** Keep it tolerant and low-noise; avoid aggressive diagnostics.
