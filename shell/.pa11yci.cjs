/**
 * pa11y-ci configuration for the production-bundle a11y check.
 *
 * Strategy: build the shell, serve via `vite preview` on port 4173,
 * run pa11y-ci against the served URL. The axe runner is used so the
 * rules match what Vitest checks at the component level (docs/a11y.md).
 *
 * Chromium: pa11y depends on Puppeteer transitively, but the project's
 * `.npmrc` skips the bundled-browser download. The CI workflow + local
 * dev installs Chromium via the OS (apt on Ubuntu, `brew install
 * --cask chromium` on macOS) and sets PA11Y_CHROMIUM_PATH to the
 * binary. Common defaults below cover the typical CI runner.
 */

const fallbackExecutables = [
  process.env.PA11Y_CHROMIUM_PATH,
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const executablePath = fallbackExecutables.find(
  (p) => typeof p === 'string' && p.length > 0,
);

module.exports = {
  defaults: {
    standard: 'WCAG2AA',
    runners: ['axe'],
    timeout: 60000,
    threshold: 0,
    wait: 1500,
    chromeLaunchConfig: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      ...(executablePath !== undefined ? { executablePath } : {}),
    },
  },
  urls: ['http://localhost:4173/'],
};
