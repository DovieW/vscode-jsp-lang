import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    alias: {
      // Allow Node-only testing of VS Code extension modules by mapping `import 'vscode'`
      // to a tiny in-repo mock.
      vscode: resolve(__dirname, './test/mock/vscode.ts'),
    },
  },
});
