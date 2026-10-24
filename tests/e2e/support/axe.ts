import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** Next streams titles after navigation; retain every caller's axe rules. */
export async function scanAxe(page: Page, tags?: string[]) {
  await expect.poll(() => page.title(), { message: 'document title is set before the axe scan' }).not.toBe('');
  const builder = new AxeBuilder({ page });
  return (tags ? builder.withTags(tags) : builder).analyze();
}
