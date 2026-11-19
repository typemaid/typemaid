import { describe, expect, it } from 'vitest';
import { allRoutes, loadPage } from './helpers';

// What can be checked without a browser. Behaviour is covered in tests/e2e.
describe('theme setup in the HTML', () => {
  describe.each(allRoutes)('%s', (route) => {
    it('sets data-theme from a script in <head>, before the stylesheet can paint', () => {
      const { $ } = loadPage(route);
      const inline = $('head script:not([src]):not([type])');
      expect(inline.text()).toContain('prefers-color-scheme: dark');
      expect(inline.text()).toContain("localStorage.getItem('theme')");
    });

    it('has a labelled theme toggle', () => {
      const { $ } = loadPage(route);
      expect($('[data-theme-toggle]').attr('aria-label')).toMatch(/Switch to (dark|light) theme/);
    });

    it('declares both colour schemes to the browser', () => {
      const { $ } = loadPage(route);
      expect($('meta[name="color-scheme"]').attr('content')).toBe('light dark');
    });
  });
});
