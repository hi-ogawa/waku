# E2E Testing Guide

## Quick Start

### Running Tests Locally

```bash
# Install dependencies
pnpm install

# Compile packages
pnpm run compile

# Run all e2e tests
pnpm run e2e

# Run only dev mode tests
pnpm run e2e-dev

# Run only production mode tests
pnpm run e2e-prd

# Run specific test file
pnpm exec playwright test ssr-basic

# Run tests in a specific browser
pnpm exec playwright test --project=chromium-dev

# Run tests with UI mode (for debugging)
pnpm exec playwright test --ui
```

### Debugging Failed Tests

```bash
# Show trace viewer for failed test
pnpm exec playwright show-trace test-results/[test-name]/trace.zip

# Run test in headed mode (see browser)
pnpm exec playwright test ssr-basic --headed

# Run test with debug mode (step through)
pnpm exec playwright test ssr-basic --debug

# Generate and view HTML report
pnpm exec playwright show-report
```

## Test Architecture

### Directory Structure

```
e2e/
├── fixtures/               # Test applications (mini Waku apps)
│   ├── ssr-basic/         # Server-side rendering
│   ├── rsc-basic/         # React Server Components
│   ├── hot-reload/        # HMR testing
│   └── ...
├── utils.ts               # Shared utilities
├── *.spec.ts              # Test specifications
└── README.md              # This file
```

### Test Modes

Each test runs in two modes:

1. **DEV Mode** (`mode: 'DEV'`)
   - Uses `waku dev` command
   - Tests development features (HMR, fast refresh)
   - Faster execution

2. **PRD Mode** (`mode: 'PRD'`)
   - Builds with `waku build`
   - Runs with `waku start`
   - Tests production optimizations

### Test Categories

- **Rendering**: SSR, RSC, rendering modes
  - `ssr-basic.spec.ts` - Server-side rendering
  - `rsc-basic.spec.ts` - React Server Components
  - `render-type.spec.ts` - Different render types

- **Routing**: File-system routing, navigation
  - `fs-router.spec.ts` - File-system router
  - `define-router.spec.ts` - Programmatic routing
  - `use-router.spec.ts` - Router hooks

- **Build**: Build process, static generation
  - `partial-build.spec.ts` - Incremental builds
  - `ssg-performance.spec.ts` - SSG performance
  - `ssg-wildcard.spec.ts` - Wildcard routes

- **Styling**: CSS solutions
  - `rsc-css-modules.spec.ts` - CSS Modules with RSC
  - `tailwindcss.spec.ts` - Tailwind CSS integration

- **Developer Experience**: Development features
  - `hot-reload.spec.ts` - Hot module replacement

- **Integration**: External library integrations
  - `waku-jotai-integration.spec.ts` - Jotai state management

- **Smoke**: Quick sanity checks
  - `examples-smoke.spec.ts` - All examples work

## Writing a New Test

### 1. Create a Fixture (if needed)

```bash
# Manually create fixture directory
mkdir -p e2e/fixtures/my-feature
cd e2e/fixtures/my-feature

# Add package.json
cat > package.json << 'EOF'
{
  "name": "my-feature",
  "type": "module",
  "dependencies": {
    "waku": "workspace:*",
    "react": "...",
    "react-dom": "..."
  }
}
EOF

# Add tsconfig.json
# Add src/pages/index.tsx
# Add waku.config.ts (if needed)
```

### 2. Create Test Spec

```typescript
// e2e/my-feature.spec.ts
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
    await expect(page.getByTestId('my-element')).toHaveText('Expected Text');
  });
});
```

### 3. Common Patterns

#### Testing Counter Interactions
```typescript
test('counter increments', async ({ page }) => {
  await page.goto(\`http://localhost:\${port}/\`);
  await expect(page.getByTestId('count')).toHaveText('0');
  await page.getByTestId('increment').click();
  await expect(page.getByTestId('count')).toHaveText('1');
});
```

#### Testing Navigation
```typescript
test('navigation works', async ({ page }) => {
  await page.goto(\`http://localhost:\${port}/\`);
  await page.getByRole('link', { name: 'About' }).click();
  await expect(page).toHaveURL(\`http://localhost:\${port}/about\`);
  await expect(page.getByRole('heading')).toHaveText('About');
});
```

#### Testing Server Actions
```typescript
test('server action', async ({ page }) => {
  await page.goto(\`http://localhost:\${port}/\`);
  await page.getByTestId('form-input').fill('test data');
  await page.getByTestId('submit').click();
  await expect(page.getByTestId('result')).toHaveText('Success');
});
```

#### Testing SSR (no JavaScript)
```typescript
test('works without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto(\`http://localhost:\${port}/\`);
  await expect(page.getByTestId('content')).toHaveText('Static Content');
  await page.close();
  await context.close();
});
```

## Test Utilities

### Setup Functions

#### `prepareNormalSetup(fixtureName)`
Use for testing with the monorepo's built packages (most common).

```typescript
const startApp = prepareNormalSetup('my-fixture');
const { port, stopApp, fixtureDir } = await startApp('DEV');
```

#### `prepareStandaloneSetup(fixtureName)`
Use for testing as a standalone installation (simulates user experience).

```typescript
const startApp = prepareStandaloneSetup('my-fixture');
const { port, stopApp, standaloneDir } = await startApp('PRD', 'pnpm');
```

### Helper Functions

#### `findWakuPort(cp: ChildProcess): Promise<number>`
Detects the port from server stdout.

#### `terminate(port: number): Promise<void>`
Cleanly stops a server on a given port.

#### `waitForHydration(page: Page): Promise<void>`
Waits for React hydration to complete.

#### `debugChildProcess(cp: ChildProcess, sourceFile: string)`
Monitors process output and checks for unexpected errors.

## Best Practices

### 1. Use Test IDs
```tsx
// In components
<div data-testid="my-element">Content</div>

// In tests
await page.getByTestId('my-element').click();
```

### 2. Wait for Hydration
```typescript
// Before interacting with client components
await waitForHydration(page);
await page.getByTestId('button').click();
```

### 3. Clean Up Resources
```typescript
test.afterAll(async () => {
  await stopApp?.();  // Always stop the server
});
```

### 4. Use Mode-Specific Tests
```typescript
// Skip in production mode
test.skip(({ mode }) => mode !== 'DEV', 'Dev-only feature');

// Or skip in dev mode
test.skip(({ mode }) => mode === 'DEV', 'Production optimization');
```

### 5. Handle Console Messages
```typescript
test('no hydration errors', async ({ page }) => {
  const messages: string[] = [];
  page.on('console', (msg) => messages.push(msg.text()));
  
  await page.goto(\`http://localhost:\${port}/\`);
  
  expect(messages.join('\n')).not.toContain('hydration-mismatch');
});
```

### 6. Test Error Boundaries
```typescript
test('handles errors gracefully', async ({ page }) => {
  await page.goto(\`http://localhost:\${port}/error-page\`);
  await expect(page.getByText('Error: Something went wrong')).toBeVisible();
});
```

## CI/CD Pipeline

### GitHub Actions Workflow

The e2e tests run on:
- **Trigger**: Push to main, PRs, merge groups
- **Platforms**: Ubuntu, Windows, macOS
- **Node.js versions**: 24.0.0, 22.12.0, 20.19.0
- **Browsers**: Chromium, Firefox, WebKit
- **Parallelization**: 4 shards per configuration

### Test Sharding

Tests are automatically distributed across 4 shards:
```bash
# Shard 1/4
pnpm exec playwright test --shard=1/4

# Shard 2/4
pnpm exec playwright test --shard=2/4
# ... etc
```

### Artifacts

On test failure, the following are uploaded:
- Playwright test results
- Screenshots and videos
- Trace files
- Build outputs (`dist/` directories)

### Performance

- **Timeout**: 30 minutes per shard
- **Typical duration**: 15-20 minutes per shard
- **Total matrix jobs**: ~30-40 (varies by exclusions)

## Troubleshooting

### Test Hangs or Times Out

1. Check if server started:
   ```typescript
   // Add logging
   const port = await findWakuPort(cp);
   console.log('Server started on port:', port);
   ```

2. Increase timeout:
   ```typescript
   test('slow test', async ({ page }) => {
     test.setTimeout(60000); // 60 seconds
   });
   ```

### Port Already in Use

```bash
# Kill process on port
npx fkill :3000

# Or on Unix
lsof -ti:3000 | xargs kill -9
```

### Flaky Tests

1. Add explicit waits:
   ```typescript
   await page.waitForLoadState('networkidle');
   await page.waitForSelector('[data-testid="content"]');
   ```

2. Use retry assertions:
   ```typescript
   await expect(async () => {
     const text = await page.textContent('[data-testid="dynamic"]');
     expect(text).toBe('Expected');
   }).toPass({ timeout: 5000 });
   ```

### Build Failures

```bash
# Clean and rebuild
rm -rf e2e/fixtures/*/dist
pnpm run compile
pnpm run e2e-prd
```

## FAQ

### Q: When should I use `prepareNormalSetup` vs `prepareStandaloneSetup`?

**A:** Use `prepareNormalSetup` for most tests. Use `prepareStandaloneSetup` when:
- Testing installation process
- Testing with different package managers
- Testing monorepo scenarios
- Simulating real user experience

### Q: How do I test only one fixture?

**A:**
```bash
pnpm exec playwright test --grep "ssr-basic"
```

### Q: How do I add a new test fixture?

**A:** See "Writing a New Test" section above. Key steps:
1. Create fixture directory with package.json, tsconfig.json, src/
2. Create test spec file
3. Add fixture to any relevant test suites

### Q: Why do tests run in both DEV and PRD modes?

**A:** To catch issues in both development and production builds. Dev mode has different optimizations and features (like HMR) compared to production.

### Q: How do I run tests in headed mode to see the browser?

**A:**
```bash
pnpm exec playwright test --headed
```

### Q: Can I run tests on only one browser?

**A:**
```bash
pnpm exec playwright test --project=chromium-dev
```

## Contributing

When adding new e2e tests:

1. ✅ Follow existing patterns and structure
2. ✅ Add appropriate test IDs to components
3. ✅ Test both DEV and PRD modes (unless mode-specific)
4. ✅ Clean up resources in `afterAll` hooks
5. ✅ Add fixture README if creating new fixture
6. ✅ Update this guide if adding new patterns
7. ✅ Consider browser compatibility
8. ✅ Keep tests focused and independent

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
- [E2E Architecture Analysis](../docs/e2e-architecture.md)
- [Waku Documentation](https://waku.gg/)
