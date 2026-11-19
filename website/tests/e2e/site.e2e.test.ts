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

describe('dark theme', () => {
  it('is black and dark even when the system asks for light', async () => {
    const { context, page } = await open('/docs/examples/hello/', { colorScheme: 'light' });
    const colours = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      text: getComputedStyle(document.body).color,
      code: getComputedStyle(document.querySelector('pre.astro-code')!).backgroundColor,
    }));
    expect(colours.body).toBe('rgb(0, 0, 0)');
    expect(colours.text).toBe('rgb(237, 237, 237)');
    expect(colours.code).toBe('rgb(10, 10, 10)');
    await context.close();
  });

  it('shows the top bar border only after scrolling', async () => {
    const { context, page } = await open('/docs/concepts/how-it-works/');
    const border = () => page.$eval('.topbar', (e) => getComputedStyle(e).borderBottomColor);
    expect(await border()).toBe('rgba(0, 0, 0, 0)');
    await page.mouse.wheel(0, 800);
    await expect.poll(border).not.toBe('rgba(0, 0, 0, 0)');
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
