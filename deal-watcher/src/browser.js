/** Playwright is imported lazily so that `once --source mock`, tests and /ping work without browsers installed. */

let chromium = null;

async function getChromium() {
  if (chromium) return chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is not installed. Run: npm install && npx playwright install chromium');
  }
  return chromium;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function launchBrowser({ headless = true, executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH } = {}) {
  const engine = await getChromium();
  return engine.launch({
    headless,
    executablePath: executablePath || undefined,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
}

export async function newContext(browser, { locale = 'ro-RO', timezone = 'Europe/Bucharest', storageState } = {}) {
  const context = await browser.newContext({
    locale,
    timezoneId: timezone,
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    storageState: storageState || undefined,
  });
  // Cheap tell-tale removal; enough for ordinary hotel booking engines, not for hard anti-bot walls.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  return context;
}

/** Blocks images/fonts/media so sweeps stay fast and light on the hotel's server. */
export async function blockHeavyAssets(context) {
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font' || type === 'media') return route.abort();
    return route.continue();
  });
}
