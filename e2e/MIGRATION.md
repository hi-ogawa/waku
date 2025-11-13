# Migration Guide: Old Utils to New Modular Utils

## Overview

The new modular utility structure provides better organization and documentation while maintaining backward compatibility. The original `e2e/utils.ts` still works, but new tests should use the modular structure.

## Import Changes

### Old Style (still works)
```typescript
import { 
  prepareNormalSetup, 
  test, 
  waitForHydration 
} from './utils.js';
```

### New Style (recommended)
```typescript
// Import everything from index
import { 
  prepareNormalSetup, 
  test, 
  waitForHydration 
} from './utils/index.js';

// Or import from specific modules
import { prepareNormalSetup } from './utils/setup.js';
import { test, waitForHydration } from './utils/browser.js';
import { findWakuPort, terminate } from './utils/process.js';
```

## Benefits of New Structure

### 1. Better Organization
- `utils/setup.ts` - Application setup and lifecycle
- `utils/process.ts` - Process management and monitoring
- `utils/browser.ts` - Browser interactions and waits
- `utils/index.ts` - Main exports (backward compatible)

### 2. Better Documentation
Each module has JSDoc comments explaining:
- What each function does
- Parameters and return types
- Usage examples
- When to use each function

### 3. Easier Maintenance
- Related functions grouped together
- Easier to find and update code
- Clearer separation of concerns

## Example: Refactoring a Test

### Before (using old utils.ts)
```typescript
import { expect } from '@playwright/test';
import { prepareNormalSetup, test } from './utils.js';

const startApp = prepareNormalSetup('my-feature');

test.describe('my-feature', () => {
  let port: number;
  let stopApp: (() => Promise<void>) | undefined;

  test.beforeAll(async ({ mode }) => {
    ({ port, stopApp } = await startApp(mode));
  });

  test.afterAll(async () => {
    await stopApp?.();
  });

  test('basic test', async ({ page }) => {
    await page.goto(\`http://localhost:\${port}/\`);
    await expect(page.getByTestId('content')).toHaveText('Hello');
  });
});
```

### After (using new modular utils)
```typescript
import { expect } from '@playwright/test';
import { 
  prepareNormalSetup, 
  test, 
  waitForHydration 
} from './utils/index.js';

const startApp = prepareNormalSetup('my-feature');

test.describe('my-feature', () => {
  let port: number;
  let stopApp: (() => Promise<void>) | undefined;

  test.beforeAll(async ({ mode }) => {
    ({ port, stopApp } = await startApp(mode));
  });

  test.afterAll(async () => {
    await stopApp?.();
  });

  test('basic test', async ({ page }) => {
    await page.goto(\`http://localhost:\${port}/\`);
    // Explicitly wait for hydration before interacting
    await waitForHydration(page);
    await expect(page.getByTestId('content')).toHaveText('Hello');
  });
});
```

## Migration Checklist

When creating new tests or updating existing ones:

- [ ] Use `./utils/index.js` imports for new tests
- [ ] Add JSDoc comments to test files explaining what they test
- [ ] Wait for hydration before interacting with client components
- [ ] Use type-safe imports (`type TestOptions`, etc.)
- [ ] Follow patterns in `e2e/README.md`

## No Breaking Changes

The old `utils.ts` continues to work. Migration is optional and can be done gradually:

1. **Keep using old utils** - Existing tests work without changes
2. **New tests use new utils** - Start using modular structure for new tests
3. **Gradually migrate** - Update existing tests over time as you modify them

## Future Enhancements

The modular structure makes it easy to add:
- Custom assertion helpers
- Advanced wait strategies
- Test fixture generators
- Performance monitoring utilities

See `docs/e2e-architecture.md` for the full improvement roadmap.
