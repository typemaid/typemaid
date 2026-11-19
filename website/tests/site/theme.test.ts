import { describe, expect, it } from 'vitest';
import { allRoutes, loadPage } from './helpers';

// The site has one theme: dark, on a black background. Behaviour is covered in tests/e2e.
describe('dark theme in the HTML', () => {
  describe.each(allRoutes)('%s', (route) => {
    it('declares only the dark colour scheme to the browser', () => {
      const { $ } = loadPage(route);
      expect($('meta[name="color-scheme"]').attr('content')).toBe('dark');
      expect($('meta[name="theme-color"]').attr('content')).toBe('#000000');
    });

    it('has no theme toggle and no theme switching script', () => {
      const { $ } = loadPage(route);
      expect($('[data-theme-toggle]').length).toBe(0);
      expect($('html').attr('data-theme')).toBeUndefined();
      expect($('script:not([src])').text()).not.toContain("localStorage.getItem('theme')");
    });
  });
});
