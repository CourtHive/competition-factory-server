/**
 * Vitest replaces jest for the server specs.
 *
 * Jest cannot survive the move to NestJS 12: @nestjs/common@12 is ESM-only
 * ("type": "module", a single ESM entry, no `require` condition in its exports map),
 * and a CommonJS jest dies in setupFiles before a single test loads. The
 * transformIgnorePatterns escape hatch was tried and abandoned — fixing the ESM
 * syntax exposes `import.meta`, and fixing that exposes a `_require` TDZ error
 * inside @nestjs/swagger's own interop.
 *
 * This lands on Nest 11 deliberately, so the runner change can be verified against
 * the existing baseline before any dependency bump rides along with it.
 */
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    // The suite was written against jest's injected globals — describe/it/expect and
    // the hooks are used bare in all 147 spec files. Keeping them global confines this
    // migration to the jest.* -> vi.* surface instead of touching every file.
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts', 'ecosystem.config.spec.ts'],
    // e2e/ is a separate Playwright-style tree, excluded from the runner exactly as
    // jest's testPathIgnorePatterns excluded it.
    exclude: ['**/node_modules/**', '**/build/**', '**/dist/**', '.claude/**', 'e2e/**', 'audit-worker/**'],
    setupFiles: [
      'dotenv/config',
      './src/tests/config/disable-throttle.ts',
      './src/tests/config/silence-logger.ts',
      // jest split this one into setupFilesAfterEach because its setupFiles run before
      // the test framework is installed. Vitest's setupFiles run inside the test
      // context, so the beforeEach hook registers from the same list.
      './src/tests/config/silence-logger-after-env.ts',
    ],
    globalSetup: ['./src/tests/config/globalSetup.ts'],
    // NOT NEGOTIABLE — see src/tests/config/teardown.ts. The suite shares a single
    // Postgres database, and running spec files in parallel was measured at a 50%
    // full-run failure rate. This is the vitest equivalent of jest's maxWorkers: 1.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
  resolve: {
    // jest resolved `src/...` specifiers through modulePaths: [rootDir]. Vite needs it
    // spelled out, and as a prefix rule so it cannot swallow a package named `src`.
    alias: [{ find: /^src\//, replacement: `${rootDir}src/` }],
  },
  plugins: [
    // Nest resolves constructor injection from design:paramtypes. esbuild — Vite's
    // default TS transform — cannot emit decorator metadata, so the specs transform
    // through swc instead, mirroring tsconfig.json's experimentalDecorators and
    // emitDecoratorMetadata.
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2021',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
