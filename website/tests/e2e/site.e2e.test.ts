import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright';
import { allRoutes } from '../site/helpers';
import { launch, serveDist } from './helpers';

let browser: Browser;
let server: Awaited<ReturnType<typeof serveDist>>;

beforeAll(async () => {
  server = await serveDist();
  browser = await launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

async function open(path: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...options });
  const page = await context.newPage();
  await page.goto(server.url + path, { waitUntil: 'networkidle' });
  return { context, page };
}

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);

describe('theme', () => {
  it('follows the system light setting on a first visit', async () => {
    const { context, page } = await open('/docs/', { colorScheme: 'light' });
    expect(await theme(page)).toBe('light');
    await context.close();
  });

  it('follows the system dark setting on a first visit', async () => {
    const { context, page } = await open('/docs/', { colorScheme: 'dark' });
    expect(await theme(page)).toBe('dark');
    await context.close();
  });

  it('toggles, updates the button label, and remembers the choice after a reload', async () => {
    const { context, page } = await open('/docs/', { colorScheme: 'light' });
    const toggle = page.locator('[data-theme-toggle]');
    await expect.poll(() => toggle.getAttribute('aria-label')).toBe('Switch to dark theme');

    await toggle.click();
    expect(await theme(page)).toBe('dark');
    expect(await toggle.getAttribute('aria-label')).toBe('Switch to light theme');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');

    await page.reload({ waitUntil: 'networkidle' });
    expect(await theme(page)).toBe('dark');

    await page.locator('[data-theme-toggle]').click();
    expect(await theme(page)).toBe('light');
    await context.close();
  });

  it('keeps a stored choice even when the system setting differs', async () => {
    const { context, page } = await open('/docs/', { colorScheme: 'dark' });
    await page.evaluate(() => localStorage.setItem('theme', 'light'));
    await page.reload({ waitUntil: 'networkidle' });
    expect(await theme(page)).toBe('light');
    await context.close();
  });

  it('sets the theme before the first paint (no flash)', async () => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const page = await context.newPage();
    // Record the theme at the moment the body starts parsing.
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (document.body) {
          (window as unknown as { themeAtBody: string }).themeAtBody = document.documentElement.dataset.theme ?? '';
          observer.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(server.url + '/docs/');
    expect(await page.evaluate(() => (window as unknown as { themeAtBody: string }).themeAtBody)).toBe('dark');
    await context.close();
  });

  it('changes page and code colours with the theme', async () => {
    const { context, page } = await open('/docs/examples/hello/', { colorScheme: 'light' });
    const colours = () => page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      code: getComputedStyle(document.querySelector('pre.astro-code')!).backgroundColor,
      token: getComputedStyle(document.querySelector('pre.astro-code span span')!).color,
    }));
    const light = await colours();
    await page.locator('[data-theme-toggle]').click();
    // The body background fades over 0.2s; wait for it to settle.
    await expect.poll(async () => (await colours()).body).not.toBe(light.body);
    const dark = await colours();
    expect(dark.code).not.toBe(light.code);
    expect(dark.token).not.toBe(light.token);
    await context.close();
  });
});

describe('code blocks', () => {
  it('copy the code to the clipboard', async () => {
    const { context, page } = await open('/docs/examples/hello/', { permissions: ['clipboard-read', 'clipboard-write'] });
    const block = page.locator('.code-wrap').first();
    await block.hover();
    await block.locator('.copy').click();
    await expect.poll(() => block.locator('.copy').textContent()).toBe('Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(await block.locator('pre code').innerText());
    await context.close();
  });
});

describe('page actions', () => {
  it('"Copy page" copies the page as Markdown', async () => {
    const { context, page } = await open('/docs/examples/hello/', { permissions: ['clipboard-read', 'clipboard-write'] });
    await page.locator('.page-copy').click();
    await expect.poll(() => page.locator('[data-copy-label]').textContent()).toBe('Copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    const markdown = await (await fetch(server.url + '/docs/examples/hello.md')).text();
    expect(copied).toBe(markdown);
    expect(copied.startsWith('# Hello world\n')).toBe(true);
    await context.close();
  });

  it('the menu opens, links to the Markdown copy, and closes on Escape', async () => {
    const { context, page } = await open('/docs/api/run/');
    const menu = page.locator('details.page-menu');
    await menu.locator('summary').click();
    await expect.poll(() => menu.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(true);
    const items = await menu.locator('li strong').allTextContents();
    expect(items).toEqual(['Copy page', 'View as Markdown', 'Open in ChatGPT', 'Open in Claude']);
    const claude = await menu.locator('a', { hasText: 'Open in Claude' }).getAttribute('href');
    expect(decodeURIComponent(claude!)).toContain('https://typemaid.pages.dev/docs/api/run.md');
    await page.keyboard.press('Escape');
    await expect.poll(() => menu.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(false);

    await menu.locator('summary').click();
    await menu.locator('a', { hasText: 'View as Markdown' }).click();
    await page.waitForURL('**/docs/api/run.md');
    expect(await page.locator('body').innerText()).toMatch(/^# run\(\)/);
    await context.close();
  });
});

describe('search', () => {
  it('finds the API page for resume()', async () => {
    const { context, page } = await open('/docs/');
    const input = page.locator('#search input');
    await input.fill('resume');
    await expect.poll(() => page.locator('.pagefind-ui__result-link').count(), { timeout: 10_000 }).toBeGreaterThan(0);
    const hrefs = await page.locator('.pagefind-ui__result-link').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs.some((h) => h?.startsWith('/docs/api/resume/'))).toBe(true);
    await context.close();
  });
});

describe('mobile', () => {
  it('opens and closes the docs menu', async () => {
    const { context, page } = await open('/docs/concepts/steps/', { viewport: { width: 390, height: 800 } });
    const sidebar = page.locator('#sidebar');
    const menu = page.locator('[data-menu]');
    expect(await sidebar.isVisible()).toBe(false);
    await menu.click();
    expect(await sidebar.isVisible()).toBe(true);
    expect(await menu.getAttribute('aria-expanded')).toBe('true');
    await menu.click();
    expect(await sidebar.isVisible()).toBe(false);
    await context.close();
  });

  it('does not scroll sideways on the landing page', async () => {
    const { context, page } = await open('/', { viewport: { width: 390, height: 800 } });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await context.close();
  });
});

describe('every page', () => {
  it('loads without JavaScript errors or failed requests', async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`${page.url()}: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
    for (const route of allRoutes) await page.goto(server.url + route, { waitUntil: 'networkidle' });
    expect(problems).toEqual([]);
    await context.close();
  }, 60_000);
});
