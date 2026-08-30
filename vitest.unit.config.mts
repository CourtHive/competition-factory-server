/**
 * `pnpm test:unit` — everything except the specs that need a live stack.
 *
 * Mirrors what jest's testPathIgnorePatterns excluded: the *.e2e.spec.ts tree plus
 * two controller/service specs that boot the full app. Same base config otherwise,
 * so the transform, setup files and serial execution are identical.
 */
import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config.mjs';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      exclude: [
        '**/*.e2e.spec.ts',
        'src/modules/factory/factory.controller.spec.ts',
        'src/modules/providers/providers.service.spec.ts',
      ],
    },
  }),
);
