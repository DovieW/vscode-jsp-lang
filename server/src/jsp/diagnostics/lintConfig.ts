import { DiagnosticSeverity } from 'vscode-languageserver';

export type LintRuleLevel = 'off' | 'info' | 'warning' | 'error';

export type LintConfig = {
  enable: boolean;
  /** Rule id -> level (off/info/warning/error). Unknown ids are ignored. */
  rules: Record<string, LintRuleLevel>;

  scriptlets: {
    maxCount: number;
    maxLines: number;
    maxNesting: number;
  };

  java: {
    enableSyntaxDiagnostics: boolean;
  };
};

export const DEFAULT_LINT_CONFIG: LintConfig = {
  enable: true,
  rules: {
    'jsp.scriptlet.present': 'info',
    'jsp.scriptlet.too-many': 'info',
    'jsp.scriptlet.too-large': 'info',
    'jsp.scriptlet.nested-control-flow': 'info',

    'jsp.directive.taglib-missing-prefix': 'warning',
    'jsp.directive.taglib-missing-uri': 'warning',

    'jsp.include.unresolvable': 'warning',

    'jsp.tag.missing-required-attribute': 'warning',

    // Only emitted when `java.enableSyntaxDiagnostics` is enabled.
    'jsp.java.syntax': 'error',
  },
  scriptlets: {
    maxCount: 5,
    maxLines: 30,
    maxNesting: 3,
  },
  java: {
    enableSyntaxDiagnostics: false,
  },
};

export function normalizeLintConfig(input: any): LintConfig {
  const cfg: LintConfig = {
    ...DEFAULT_LINT_CONFIG,
    rules: { ...DEFAULT_LINT_CONFIG.rules },
    scriptlets: { ...DEFAULT_LINT_CONFIG.scriptlets },
    java: { ...DEFAULT_LINT_CONFIG.java },
  };

  if (!input || typeof input !== 'object') {
    return cfg;
  }

  if (typeof input.enable === 'boolean') {
    cfg.enable = input.enable;
  }

  if (input.rules && typeof input.rules === 'object') {
    for (const [k, v] of Object.entries(input.rules)) {
      const level = parseRuleLevel(v);
      if (level) {
        cfg.rules[k] = level;
      }
    }
  }

  if (input.scriptlets && typeof input.scriptlets === 'object') {
    if (Number.isFinite(input.scriptlets.maxCount)) {
      cfg.scriptlets.maxCount = clampInt(input.scriptlets.maxCount, 0, 10_000);
    }
    if (Number.isFinite(input.scriptlets.maxLines)) {
      cfg.scriptlets.maxLines = clampInt(input.scriptlets.maxLines, 0, 10_000);
    }
    if (Number.isFinite(input.scriptlets.maxNesting)) {
      cfg.scriptlets.maxNesting = clampInt(input.scriptlets.maxNesting, 0, 100);
    }
  }

  if (input.java && typeof input.java === 'object') {
    if (typeof input.java.enableSyntaxDiagnostics === 'boolean') {
      cfg.java.enableSyntaxDiagnostics = input.java.enableSyntaxDiagnostics;
    }
  }

  return cfg;
}

export function parseRuleLevel(v: unknown): LintRuleLevel | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }
  const s = v.trim().toLowerCase();
  if (s === 'off' || s === 'info' || s === 'warning' || s === 'error') {
    return s as LintRuleLevel;
  }
  return undefined;
}

export function severityFromLevel(level: LintRuleLevel): DiagnosticSeverity | null {
  switch (level) {
    case 'off':
      return null;
    case 'info':
      return DiagnosticSeverity.Information;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'error':
      return DiagnosticSeverity.Error;
  }
}

export function effectiveRuleLevel(config: LintConfig | undefined, ruleId: string, fallback: LintRuleLevel): LintRuleLevel {
  const fromCfg = config?.rules?.[ruleId];
  return fromCfg ?? fallback;
}

export function severityFromRuleLevel(
  config: LintConfig | undefined,
  ruleId: string,
  fallback: LintRuleLevel,
): DiagnosticSeverity | null {
  return severityFromLevel(effectiveRuleLevel(config, ruleId, fallback));
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(n)));
}
