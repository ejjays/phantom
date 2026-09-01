import { test, expect } from '@playwright/test';

const E2E_URLS = [
  {
    id: 'vimeo',
    url: 'https://vimeo.com/76979871',
    expectTitle: 'The New Vimeo Player',
    expectUploader: 'Vimeo',
  },
  {
    id: 'soundcloud',
    url: 'https://soundcloud.com/marshmellomusic/alone',
    expectTitle: 'Alone',
    expectUploader: 'marshmello',
  },
  {
    id: 'threads',
    url: 'https://www.threads.com/@mrbeast/post/DOCp-qLiXVo',
    expectTitle: null,
    expectUploader: null,
  },
] as const;

for (const { id, url, expectTitle, expectUploader } of E2E_URLS) {
  test.describe(`picker modal — ${id}`, () => {
    test(
      'resolves URL, shows picker with thumbnail + title + formats + download button',
      async ({ page }) => {
        await page.goto('/');

        const input = page.locator('#url-input');
        await expect(input).toBeVisible();
        await input.fill(url);
        await input.press('Enter');

        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible({ timeout: 60_000 });

        const thumbnail = dialog.getByRole('img', { name: 'Thumbnail' });
        await expect(thumbnail).toBeVisible();
        const src = await thumbnail.getAttribute('src');
        expect(src, 'thumbnail has a real image URL').toBeTruthy();
        expect(src).not.toContain('logo.webp');

        const title = dialog.locator('h3');
        await expect(title).toBeVisible();
        const titleText = await title.textContent();
        expect(titleText, 'title is not empty').toBeTruthy();
        expect(titleText!.length).toBeGreaterThan(2);
        if (expectTitle) {
          expect(titleText!.toLowerCase()).toContain(expectTitle.toLowerCase());
        }

        const qualityTrigger = dialog.locator('[aria-haspopup="listbox"]');
        await expect(qualityTrigger).toBeVisible();
        await qualityTrigger.click();

        const options = dialog.locator('[role="option"]');
        const count = await options.count();
        expect(count, 'at least 1 quality option').toBeGreaterThanOrEqual(1);

        const selected = dialog.locator('[role="option"][aria-selected="true"]');
        await expect(selected).toBeVisible();

        const getFileBtn = dialog.getByRole('button', { name: 'Get File' });
        await expect(getFileBtn).toBeVisible();
        await expect(getFileBtn).toBeEnabled();

        await qualityTrigger.click();

        console.log(
          `[e2e] ${id} PASS title="${titleText!.slice(0, 60)}" options=${count}`
        );
      },
      90_000
    );
  });
}

test.describe('input + error handling', () => {
  test('empty input does not resolve', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#url-input');
    await expect(input).toBeVisible();
    await input.press('Enter');
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5_000 });
  });

  test('invalid URL shows error', async ({ page }) => {
    await page.goto('/');
    const input = page.locator('#url-input');
    await input.fill('not-a-url');
    await input.press('Enter');
    const error = page.locator('[role="alert"], .text-red, .text-red-400, .text-orange');
    await expect(error.first()).toBeVisible({ timeout: 15_000 });
  });
});
