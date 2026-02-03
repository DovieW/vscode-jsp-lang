# Feasibility: implementing “full JSP IDE features” in this VS Code extension

This repository currently ships a **TextMate grammar** + **language configuration** (comments/brackets). That architecture is great for **syntax highlighting**, but it cannot deliver most IDE features by itself.

Most of the requirements you received (completion, validation, navigation, debugging integration, framework-aware tags) require a **language server** and/or deep integration with Java project tooling.

## How to read this document

### Feasibility scale

- **Easy**: can be done in this extension with VS Code APIs and/or small grammar/config tweaks.
- **Medium**: doable, but requires non-trivial extension code and careful edge cases.
- **Hard**: requires a language server or heavy parsing; significant maintenance.
- **Very hard**: effectively a full product—needs deep runtime/project integration (debugger, build system, framework model).

### Key technical constraint: TextMate vs Language Server

- TextMate grammars provide **tokenization for highlighting**.
- IntelliSense, diagnostics, “go to definition”, refactoring, etc. typically come from:
  - a **Language Server Protocol (LSP)** implementation, and/or
  - a full VS Code language feature provider that parses/understands code.

In other words: moving from “JSP looks nice” to “JSP behaves like an IDE” means adding a **second component** (server) and a lot of project awareness.

## Feasibility assessment by requirement

### 1) HTML, CSS, and JavaScript language support inside JSP

**What’s already true today**

- **Highlighting**: mostly yes, because the grammar includes the HTML grammar.

**What’s requested**

- IntelliSense/completion for embedded HTML/CSS/JS
- Validation for HTML/CSS/JS
- Integration with ESLint/Prettier and other tooling

**Feasibility: Hard** (for “inside JSP as first-class”)

**Why it’s hard**

VS Code’s HTML/CSS/JS features normally activate for `html`, `css`, `javascript` documents. A `.jsp` document is a *single* text buffer with mixed languages. To get “real” HTML/CSS/JS IntelliSense inside JSP you need one of the following approaches:

1) **Virtual documents** (best for prototypes)
   - Split a JSP file into extracted virtual `html/css/js` documents (and separately virtual `java` regions).
   - Map positions back and forth to the original file.
   - Route completion/diagnostics/formatting requests to the right embedded language service.
   - This is how many “embedded language” editors work, but it’s a sizeable engineering effort.

2) **Custom mixed-language language server** (recommended for a stable product)
   - Build an LSP server that understands JSP as a container language and delegates to HTML/CSS/JS/Java analysis.
   - Even larger scope; more maintainable long-term if done well, but expensive.

**What is feasible in a lightweight extension**

- Documented configuration hints (e.g., Emmet mapping) — **Easy**
- Better tokenization coverage — **Easy/Medium**

### 2) JSP syntax highlighting and code completion (smart Java in scriptlets)

**What’s already true today**

- Scriptlet/directive highlighting exists.
- Scriptlet content is tokenized as Java for coloring.

**What’s requested**

- Smart completions for `<% %>` tags and Java expressions
- Java context (`request`, `session`, `pageContext`, imports)
- Navigation from scriptlet Java into real Java symbols
- Java diagnostics inside scriptlets

**Feasibility: Very hard**

**Why it’s very hard**

To implement “Java IntelliSense inside scriptlets” you must:

- Parse JSP into an AST with accurate source maps
- Extract Java fragments into compilable units (often by generating synthetic Java classes)
- Feed those fragments into a Java compiler / Java language server model
- Keep everything incremental and fast as the user types

This is essentially what full IDEs do. Reusing existing Java tooling helps, but stitching it into JSP is the hard part.

**The biggest iceberg is the classpath/project model**: even if you perfectly extract scriptlets and generate synthetic Java, Java IntelliSense will be disappointing until you have reliable dependency resolution (Maven/Gradle, multi-module, servlet/JSP API jars, source attachments).

**Potential approach**

- Generate a synthetic Java file per JSP (or per class of JSP), mapping scriptlet ranges to methods/blocks.
- Maintain source maps for completions/diagnostics.
- Ask a Java language server (e.g., JDT-based) for completions/diagnostics on the synthetic file.

> Note: servlet/JSP APIs come in **Jakarta** (`jakarta.servlet.*`) and **Javax** (`javax.servlet.*`) variants. Supporting real projects usually means supporting both via configuration/auto-detection.

**Risks / costs**

- Correctness is hard (JSP lifecycle, implicit objects, taglibs, includes)
- Performance: must be incremental and responsive
- Maintenance: many corner cases (includes, fragments, expression language, directives)

### 3) Framework-specific JSP tags (Struts 1.x) + custom tag libraries

**What’s requested**

- Highlighting + IntelliSense for tags like `<html:form>`, `<logic:equals>`
- Attribute validation + value completion
- Resolve taglib imports via `<%@ taglib %>`

**Feasibility: Hard → Very hard** (depending on how deep you go)

**Options**

- **Highlighting only**: **Easy** (TextMate patterns for prefixed tags/attributes)
- **Basic taglib-aware completions**: **Hard**
  - Need to resolve TLD files (`WEB-INF/*.tld`) and parse them
  - Many projects also depend on **jar-provided TLDs** (`META-INF/*.tld` inside dependency jars), which usually forces jar/classpath discovery to be correct.
  - Build a tag/attribute catalog
- **Bean/property-aware completions** (e.g., `property` based on Java beans): **Very hard**
  - Requires Java project model + type resolution

**Recommendation**

If you ever tackle this, start with **taglib resolution + attribute catalog** (no Java bean inference) and treat Java-aware property completion as a separate (much larger) milestone.

### 4) Java debugging integration for JSP lines/tags

**What’s requested**

- Set breakpoints on JSP lines and debug scriptlets/tags
- Inspect runtime values, step through execution

**Feasibility: Very hard**

**Why**

JSP files are compiled into servlet Java classes and then debugged at the Java level. Mapping a breakpoint in a JSP file to the correct location in the generated servlet requires:

- build tooling integration (knowing where generated sources/classes are)
- stable source maps (line mappings) from JSP → generated Java
- cooperation with the Java debug adapter

This is closer to “build a JSP-aware debugger” than “add a few extension features”.

## Suggested additional features (feasibility)

### Navigation & refactoring

- Go to definition for Java referenced in scriptlets: **Very hard** (requires the same infrastructure as Java IntelliSense in scriptlets)
- Refactors across JSP and Java: **Very hard**

### Linting & validation

- JSP-specific lint rules (non-project-aware): **Medium**
  - Example: flag presence of scriptlets as a warning (“modernization” hint)
  - This can be implemented as a simple document scanner with regex/heuristics.
- True semantic validation (imports, tag attributes, Java symbols): **Hard → Very hard**

### Template snippets

- Snippets for directives/taglib/scriptlet templates: **Easy**
  - This extension could ship snippets without needing a language server.

### Formatting (mixed-language)

- Formatting a mixed-language JSP document (HTML + JSP + embedded CSS/JS) is usually **Hard**.
  - HTML-only formatting can be offered earlier, but JSP-aware formatting (with safe mappings) is a later milestone.

### Diagnostics & profiling

**Scope note (2026-02):** runtime profiling features are out of scope for the core extension and have been rolled back.

- Profiling JSP rendering time: **Very hard**
  - Requires runtime instrumentation and integration with server/container.

### Project-specific configuration (taglibs, sources, multi-module)

- Adding settings UI and reading configuration: **Medium**
- Making those settings power real validation/completion: **Hard → Very hard**

### “Integration with Copilot and other AI tools”

- You generally can’t directly “enhance Copilot” from another extension.
- What you *can* do is provide better language structure (tokens/semantic tokens, virtual documents, etc.) so editors/assistants have cleaner inputs.

**Feasibility: Medium** (for indirect improvements) to **Not directly controllable** (for “make Copilot smarter”).

## Practical roadmap (if you wanted to expand this project)

### Phase 0 (keep it lightweight)

- Improve highlighting coverage (safe, incremental)
- Add snippets for common directives/taglibs
- Add a simple linter: warn on scriptlets, highlight deprecated patterns

**Effort:** low to moderate

### Phase 1 (embedded web tooling)

- Implement a “virtual HTML document” extraction approach for JSP
- Delegate HTML/CSS/JS completion/diagnostics/formatting to existing VS Code providers

**Effort:** high

### Phase 2 (taglib awareness)

- Parse and index TLD files
- Provide completions for tag names + attributes
- Optional: validate attributes against TLD

**Effort:** high

### Phase 3 (Java-in-scriptlets)

- Synthetic Java generation + source maps
- Integration with Java language server for diagnostics/completion

**Effort:** very high

### Phase 4 (debugger/source mapping)

- Integrate with build/container toolchain
- Map JSP breakpoints to generated servlet code

**Effort:** extremely high

## Bottom line

- **Feasible in this repo’s current style:** highlighting improvements, snippets, simple heuristics-based linting.
- **Feasible but large:** embedded HTML/CSS/JS IntelliSense via virtual documents; taglib indexing.
- **Very difficult / product-scale:** Java intelligence inside scriptlets; framework-aware bean/property completions; JSP debugging integration.
