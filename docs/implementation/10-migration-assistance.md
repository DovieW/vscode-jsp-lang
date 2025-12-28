# Feature 10 — Migration assistance tooling (modernization help)

This document describes how to build tooling that helps teams modernize legacy JSP codebases—especially those using:

- heavy scriptlets (`<% ... %>`, `<%= ... %>`, `<%! ... %>`)
- older frameworks/taglibs (e.g., Struts 1.x)

Migration assistance is about **guidance + safe automations**, not “magically convert your app”.

## Goal

Provide users with:

- **detections** (find legacy patterns)
- **reports** (where and how severe)
- **quick fixes** (only when safe)
- optional **workspace-wide refactoring helpers** (conservative)

## Non-goals

- Full automatic conversion of scriptlets to MVC controllers
- Full Struts 1 → Struts 2 / Spring MVC conversions
- Guaranteeing behavioral equivalence

## What we can do safely vs unsafely

### Safe-ish automation (good candidates for quick fixes)

- Replace trivial scriptlet expressions with EL when the output is direct:
  - `<%= request.getParameter("x") %>` → `${param.x}` (only when pattern matches exactly)
  - `<%= session.getAttribute("user") %>` → `${sessionScope.user}` (exact match)

- Convert simple `out.print(...)` patterns to `${...}` only when the argument is a recognized implicit object access pattern.

- Add diagnostics and quick fixes that *do not change runtime behavior*:
  - add a comment marker like `// TODO migrate` (optional)
  - add a suppression directive/config (e.g., “ignore this file”) — purely tooling

### Advisory only (do not auto-fix)

- Multi-line scriptlets with control flow (`if/for/while`), DB calls, or side effects
- Any scriptlet that mutates state (`session.setAttribute`, `request.setAttribute`, writes headers)
- Any conversion involving taglibs where semantics depend on the app/framework

## Core capabilities

### 1) Detection rules

Build detections as a set of rules (can share infrastructure with Feature 6 linting):

#### Scriptlet detections

- `migration/scriptlet-present`
- `migration/scriptlet-large` (N lines)
- `migration/scriptlet-complexity` (heuristics: nested braces, `if/for/while/switch`, `try/catch`)
- `migration/scriptlet-side-effects` (heuristics: `setAttribute`, `sendRedirect`, `getWriter`, `commit`, etc.)

#### Struts / legacy taglib detections

- `migration/taglib-struts1`
  - triggers on `<%@ taglib %>` URIs/prefixes that match Struts TLDs (configurable list)
- `migration/struts-tag-usage`
  - triggers on `<html:...>` / `<logic:...>` usage when mapped to a Struts taglib

#### General JSP modernization hints

- `migration/jsp-include-overuse` (many includes; best-effort)
- `migration/inline-style-script` (encourage separation; optional)

### 2) Report generation

Provide a command:

- `JSP: Generate Migration Report`

Output formats:

- Markdown summary (recommended)
- JSON for CI dashboards

Suggested report content:

- files scanned
- per-file counts of scriptlets/tags
- top offenders
- rule breakdown

### 3) Quick fixes (code actions)

Offer code actions only when the rule can produce a safe edit:

- “Convert to EL (param)” for exact `<%= request.getParameter("x") %>`
- “Convert to EL (scope attribute)” for exact `getAttribute("name")`

Each code action must:

- have a clear title (“Convert to EL: ${param.x}”)
- show what it will do
- be conservative about matching

### 4) Workspace refactoring helpers (optional)

Add a command like:

- `JSP: Apply Safe Modernizations (Workspace)`

This should:

- only apply transformations with very high confidence
- show a preview list before applying
- integrate with VS Code’s WorkspaceEdit / undo

## UX in VS Code

### Diagnostics

- Use hint/info severity by default
- Offer “Disable this rule” / “Ignore this file” quick actions

### Views

- “Migration” tree view:
  - by file
  - by rule
  - by severity

### Configuration knobs

- `jsp.migration.enabled` (default true)
- `jsp.migration.rules` (severity mapping)
- `jsp.migration.ignoreGlobs` (files/folders)
- `jsp.migration.struts.uris` (known URIs)
- `jsp.migration.scriptlets.maxLines`, `maxCount`

## Implementation approach

### Parsing strategy

Start with tolerant extraction (already needed for Features 2/6):

- find ranges for `<% ... %>`, `<%= ... %>`, `<%! ... %>`
- find taglib directives and tag usages

For “safe quick fixes”, use strict regex patterns applied to **the inner scriptlet text**.

### Confidence levels

Each rule should declare a confidence:

- `high`: can offer auto-fix
- `medium`: show hint only
- `low`: advisory in report only

This keeps code actions from becoming dangerous.

## Milestones

### Milestone 1 — Detection + report

- Implement key detections (scriptlets + Struts taglib usage)
- Generate Markdown report

### Milestone 2 — Safe quick fixes

- Add 2–3 high-confidence scriptlet-to-EL conversions
- Add suppress/ignore quick fixes

### Milestone 3 — Migration view

- Tree view summarizing findings
- Jump-to-location

### Milestone 4 — Workspace “apply safe”

- Preview + apply batch safe transformations

## Acceptance criteria

- Running “Generate Migration Report” produces a readable Markdown summary with top offending files
- Scriptlet presence hints appear without overwhelming noise
- At least one safe conversion quick-fix works correctly and preserves file formatting

## Testing strategy

- Unit tests:
  - rule matchers on fixture JSP strings
  - quick-fix edit generation

- Integration tests:
  - open a fixture workspace, run the report command, verify output file content
  - apply a quick fix and verify resulting document text

## Risks

- Over-promising conversions will erode trust—keep automations conservative.
- Struts detection via URIs can miss custom setups—make URI list configurable.
- Some teams *must* keep scriptlets; ensure rules can be disabled per workspace.
