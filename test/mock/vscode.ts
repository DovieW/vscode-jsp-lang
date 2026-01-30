// Minimal VS Code API mock used by Vitest.
//
// This file is mapped via vitest `test.alias` so imports of `vscode` in src/**
// resolve to this mock during unit tests.

export type Disposable = { dispose(): void };

export type OutputChannel = {
  appendLine(value: string): void;
};

export type ExtensionContext = {
  subscriptions: Disposable[];
};

export type WorkspaceFolder = {
  uri: { fsPath: string };
};

let enabled = true;
let workspaceFolders: WorkspaceFolder[] = [];

let configOverrides = new Map<string, unknown>();

let lastTrackerFactory: any | undefined;
let lastConfigListener: ((e: { affectsConfiguration(section: string): boolean }) => void) | undefined;

export const workspace = {
  get workspaceFolders(): WorkspaceFolder[] {
    return workspaceFolders;
  },
  set workspaceFolders(value: WorkspaceFolder[]) {
    workspaceFolders = value;
  },
  getConfiguration: (_section?: string) => {
    return {
      get: <T>(_: string, defaultValue: T): T => {
        // Keep the mock small and predictable:
        // - Only the enabled flag is overridden by tests.
        // - Everything else returns the provided default.
        if (_ === 'debug.stackFrameRewrite.enabled') return enabled as unknown as T;

        if (configOverrides.has(_)) return configOverrides.get(_) as T;
        return defaultValue;
      },
    };
  },
  onDidChangeConfiguration: (
    listener: (e: { affectsConfiguration(section: string): boolean }) => void,
  ): Disposable => {
    lastConfigListener = listener;
    return { dispose: () => {} };
  },
};

export const debug = {
  registerDebugAdapterTrackerFactory: (_debugType: string, factory: any): Disposable => {
    lastTrackerFactory = factory;
    return { dispose: () => {} };
  },
};

export function __setMockEnabled(value: boolean): void {
  enabled = value;
}

export function __setMockConfigValue(key: string, value: unknown): void {
  configOverrides.set(key, value);
}

export function __setMockWorkspaceFolders(folders: WorkspaceFolder[]): void {
  workspaceFolders = folders;
}

export function __getLastDebugAdapterTrackerFactory(): any | undefined {
  return lastTrackerFactory;
}

export function __fireConfigurationChange(affectsPrefix: string): void {
  lastConfigListener?.({
    affectsConfiguration: (section: string) => section.startsWith(affectsPrefix),
  });
}

export function __resetMocks(): void {
  enabled = true;
  workspaceFolders = [];
  configOverrides = new Map();
  lastTrackerFactory = undefined;
  lastConfigListener = undefined;
}
