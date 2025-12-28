# Feature 7 — Template snippets (JSP patterns, directives, Struts/JSTL helpers)

This document outlines how to implement **snippets** for JSP development, including optional “template” insertion and user-configurable snippet packs.

Snippets are one of the highest-value / lowest-risk features: they don’t require deep parsing, and they dramatically improve ergonomics.

## Goal

In `.jsp` / `.jspf` / `.tag` files, provide quick insertion for common patterns:

- JSP directives (`page`, `taglib`, `include`)
- Scriptlet blocks (`<% %>`, `<%= %>`, `<%! %>`)
- Common servlet implicit objects usage (`request.getParameter(...)`, etc.)
- Common JSTL patterns (`<c:forEach>`, `<c:if>`, `<c:choose>`)
- Optional: legacy frameworks (e.g., Struts 1 tags) snippets (`<html:form>`, `<html:text>`, etc.)

Also support:

- sensible tab stops
- optional placeholders
- scope to JSP language id `jsp`

## Non-goals

- Replacing IntelliSense/validation (snippets are not semantic)
- Automatically “detecting framework” perfectly

## Approach options

### Option A — Static snippets via `contributes.snippets` (recommended)

VS Code supports shipping snippet JSON files through `package.json`:

- `contributes.snippets`: points to a JSON file
- `language`: `jsp`

**Pros**

- Minimal code
- Very stable
- Works offline and on all platforms

**Cons**

- Snippets are fixed at publish time (users can still override via user snippets)

### Option B — Command-driven templates (optional)

Add commands like:

- `jsp.insertPageDirective`
- `jsp.insertTaglibDirective`

This can:

- prompt for values (prefix, uri)
- insert multi-line templates with validation

**Pros**

- Can be interactive (pick prefix/uri)
- Can integrate with Feature 3’s taglib index (autocomplete taglib URIs)

**Cons**

- More code and maintenance
- Commands are more “heavyweight” than snippets

### Option C — User-configurable snippet packs (optional)

Support workspace-defined snippet templates (in addition to normal VS Code user snippets), e.g.:

- `.vscode/jsp-snippets.json`

The extension can:

- load these on startup / watch changes
- register a `CompletionItemProvider` that emits snippet completion items

**Pros**

- Team-shared snippets without asking users to manually install snippet files

**Cons**

- More moving parts than Option A
- Need to design a schema + merging rules

## Recommended plan (phased)

### Milestone 1 — Built-in core snippet set (Option A)

Ship a single snippet file for the `jsp` language id including:

- `jsp-page` → `<%@ page ... %>`
- `jsp-taglib` → `<%@ taglib prefix="${1:prefix}" uri="${2:uri}" %>`
- `jsp-include` → `<%@ include file="${1:/WEB-INF/...}" %>`
- `jsp-scriptlet` → `<%\n\t$0\n%>`
- `jsp-expr` → `<%= ${0:expression} %>`
- `jsp-decl` → `<%!\n\t$0\n%>`

Also include a small set of “common tasks”:

- `jsp-param` → `${param.${1:name}}` (EL)
- `jsp-out` → `${0:out}.print(${1:value});` (scriptlet, optional)

### Milestone 2 — JSTL & Struts snippet packs (still Option A)

Add separate snippet files and optionally make them togglable by configuration (or just ship them).

Examples:

- JSTL:
  - `<c:forEach var="${1:item}" items="${2:items}">\n\t$0\n</c:forEach>`
  - `<c:if test="${1:test}">\n\t$0\n</c:if>`
- Struts 1:
  - `<html:form action="${1:/action}" method="${2:post}">\n\t$0\n</html:form>`

### Milestone 3 — Interactive commands (Option B)

- Provide a command to insert a taglib directive using a quick-pick list.
- If Feature 3 exists, populate quick-pick from discovered taglibs.

### Milestone 4 — Workspace snippet packs (Option C)

- Define a JSON schema and support `.vscode/jsp-snippets.json`
- Watch for changes and refresh completion items

## Snippet design guidelines

- Prefer short prefixes (`jsp-...`, `jstl-...`, `struts-...`) to avoid collisions.
- Use tabstops and placeholders consistently.
- Include descriptions; users discover snippets via the completion UI.
- Avoid “over opinionated” templates; keep defaults safe.

## Configuration (optional)

If you ship large packs, consider settings:

- `jsp.snippets.enableCore` (default true)
- `jsp.snippets.enableJstl` (default true)
- `jsp.snippets.enableStruts1` (default false)

Note: VS Code snippet contributions can’t be conditionally loaded without code. If you need toggles, you’ll likely implement Option B/C or split into separate extensions.

## Acceptance criteria

### Must-have (Milestone 1)

- In a `.jsp` file, typing `jsp-taglib` offers a snippet and inserts a valid `<%@ taglib %>` skeleton with tab stops.
- Scriptlet snippets insert correct delimiters and place cursor in the body.

### Nice-to-have (Milestone 2)

- `c-forEach` (or similar) inserts a correct JSTL block.

### Advanced (Milestone 3/4)

- Command palette: “Insert Taglib Directive” offers quick pick of known taglibs and inserts the selected one.
- Workspace snippet pack is picked up without reloading the window.

## Testing strategy

- Minimal automated testing needed for static snippets.
- For command-driven templates:
  - unit test template generation
  - integration test that command inserts text at cursor

## Implementation notes (repo changes you’ll likely make)

- Add snippet JSON files under a new folder (e.g., `snippets/`)
- Update `package.json`:
  - add a `contributes.snippets` entry for language `jsp`
- Optional: add commands under `contributes.commands` and implement in extension activation code
