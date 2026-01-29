# Feature 3 — Taglibs & framework JSP tags (Struts/JSTL/custom tags)

This document outlines how to add **framework/custom tag library intelligence** to JSP editing:

- Resolve `<%@ taglib %>` directives
- Provide completions for tag names like `<html:form>` and `<logic:equals>`
- Provide attribute completions/validation for those tags

> Important: “Struts tags” are not magic; they’re typically defined via **TLD files** (Tag Library Descriptors). A good implementation focuses on robust **TLD discovery + parsing + indexing**.

## Goal

In `.jsp` files:

- When a user types `<html:` offer tag name completions based on imported taglibs
- When a user is inside `<html:form ...>` offer attribute name completions
- Validate unknown tag/attribute names when the relevant taglib is imported
- Optional: complete *attribute values* when the TLD provides enums (rare) or when there’s a known constrained set

## Non-goals (for Feature 3)

- Full Java-bean/property inference for attribute values (e.g., `property="..."` from bean types)
  - This depends on Feature 2’s Java semantic model and is a separate milestone.
- Runtime validation (server/container execution)
- Debugger integration

## What we’re building (conceptually)

A **taglib index** that answers:

- Which prefixes are in scope in this JSP? (`html`, `logic`, `c`, etc.)
- For a given prefix, what tags exist?
- For a given tag, what attributes are allowed?

Then we expose that via:

- completion provider (tags/attributes)
- diagnostics (unknown prefix/tag/attribute)
- optional hover (from TLD docs)

## Implementation options

### Option A — In-extension providers (no LSP)

Implement completion + diagnostics directly in the VS Code extension host.

**Pros**

- Faster to prototype
- No server packaging

**Cons**

- Harder to scale (performance + architecture) once Feature 2/4 are also LSP-based

### Option B — Add to a JSP language server (recommended if you’re already doing LSP)

Put all taglib logic in the JSP LSP server and return completions/diagnostics via LSP.

**Pros**

- Clean separation + testability
- Works well with “project indexing” tasks

**Cons**

- Requires LSP scaffolding sooner

## Required capability: resolve taglibs

### 1) Parse taglib directives

Support at least the common form:

- `<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>`

Also handle:

- single quotes
- whitespace variations
- multiple directives per file

Extract:

- `prefix`
- `uri`
- directive location range (for diagnostics)

### 2) Map (prefix, uri) → TLD definition

There are multiple sources of TLDs:

1. **Web app local TLDs**
   - `WEB-INF/*.tld`
   - `WEB-INF/tlds/**/*.tld` (common convention)

2. **JAR-packaged TLDs**
   - `META-INF/*.tld` inside dependency jars

3. **Container/framework defaults**
   - Sometimes TLDs come from well-known URIs mapped by frameworks

A practical approach is to support (1) first, then add (2) for real-world projects.

## TLD parsing & indexing design

### Data model

Represent the index as:

- `Taglib`:
  - `uri?: string`
  - `shortName?: string`
  - `displayName?: string`
  - `source`: file path or jar entry
  - `tags`: Map of tagName → Tag

- `Tag`:
  - `name`
  - `description?`
  - `attributes`: Map of attrName → Attribute

- `Attribute`:
  - `name`
  - `required?: boolean`
  - `rtexprvalue?: boolean`
  - `type?: string`
  - `description?`

Keep the model versioned so you can invalidate caches cleanly.

### Parsing TLD XML

TLDs are XML. Key nodes you’ll likely need:

- `<taglib>` root
- `<uri>`, `<short-name>`, `<display-name>`
- `<tag>`: `<name>`, `<description>`, `<attribute>`

You don’t need full schema validation to start; a tolerant XML parser is fine.

### Index building

**MVP**

- Scan workspace for `**/*.tld` under likely web roots (configurable)
- Parse and build an in-memory map: `uri → Taglib`

**Next**

- Watch TLD files for changes and update index incrementally

**Later**

- Add jar scanning (build tool integration + zip reading)

### Workspace configuration

Add settings (future PR) to make discovery workable:

- `jsp.taglibs.webInfGlobs`: array of globs to locate TLDs
- `jsp.taglibs.enableJarScanning`: boolean
- `jsp.taglibs.jarGlobs` or a “use project classpath” strategy

Also handle multi-root workspaces by maintaining an index per workspace folder.

## Language features

### 1) Tag name completion

Trigger when user types `<prefix:`.

Algorithm:

1. Determine prefix at cursor
2. Resolve prefix to URI via taglib directives in the document
3. Look up Taglib via URI in the index
4. Return tag names as completion items

### 2) Attribute completion

When inside a start tag like `<html:form ...>`:

1. Identify the tag (prefix + localName)
2. Get Tag definition from index
3. Return attribute names not already present

### 3) Diagnostics

Publish diagnostics for:

- Unknown prefix used in `<prefix:tag>` when no matching `<%@ taglib prefix="prefix" %>` exists
- Unknown tag name for a known prefix
- Unknown attribute names for a known tag

Be careful:

- Custom tags might be used without a local TLD present in workspace (e.g., jar scanning disabled). Prefer “warning” severity instead of “error” unless you’re certain.

### 4) Hover (nice-to-have)

Use TLD `<description>` to show hover docs for:

- `<prefix:tag>`
- attributes

Status: implemented (MVP) — hover shows tag/attribute descriptions from workspace `.tld` files.

### 5) Attribute value completion (advanced)

TLDs don’t always provide value sets. Start with:

- boolean attributes (`true|false`)
- known JSTL/Struts attributes that have conventional values (optional hardcoded catalogs)

Then later integrate with Feature 2 for bean/property inference.

Status: partially implemented — boolean attribute values (`true|false`) complete when the cursor is inside quotes for a known boolean attribute.

## Roadmap (recommended milestones)

### Milestone 1 — Local TLD support (WEB-INF)

- Parse `<%@ taglib %>`
- Workspace scan for `.tld`
- Tag + attribute completions
- Basic diagnostics

### Milestone 2 — Better discovery + caching

- Settings for TLD globs
- File watchers / incremental index rebuild
- Hover docs

### Milestone 3 — Jar scanning

- Read `META-INF/*.tld` from jars
- Map jar-provided taglibs by `<uri>`

### Milestone 4 — Deep value completion (optional)

- Bean-aware completions for attributes like `property` (requires Feature 2)

## Acceptance criteria

### Must-have (Milestone 1)

- Given `<%@ taglib prefix="c" uri="..." %>`, typing `<c:` suggests tags from that taglib
- Given `<c:forEach `, suggests known attributes for that tag
- Unknown attributes show a warning diagnostic

### Nice-to-have (Milestone 2)

- Hover shows tag/attribute descriptions from the TLD
- Changes to a `.tld` file update completions without reload

### Jar support (Milestone 3)

- If a taglib is only available from a dependency jar, completions work when jar scanning is enabled

## Testing strategy

- Unit tests:
  - TLD parser (snapshot parsing of representative TLDs)
  - Directive parser in JSP documents
  - Tag/attribute extraction correctness

- Integration tests:
  - completions appear given a workspace fixture with a `WEB-INF/*.tld`
  - diagnostics trigger on unknown tag/attribute

## Key risks

- TLD discovery varies wildly across project layouts.
- Jar scanning requires either:
  - build tool integration (classpath), or
  - heuristics that may miss jars.
- Some projects rely on container-provided mappings that aren’t visible in workspace.

## Practical recommendation

Start with **WEB-INF TLDs** + clear configuration settings. That covers many legacy apps and provides immediate value without turning this extension into a full build-tool integrator.
