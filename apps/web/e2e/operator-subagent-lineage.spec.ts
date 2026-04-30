import { expect, test } from '@playwright/test';
import { makeBaseOperatorSnapshot } from './fixtures/operator-fixtures';
import { mountOperatorHarness, openOperator } from './fixtures/operator-mocks';

test('subagent lineage is visible and child selection stays coherent', async ({ page }) => {
  await mountOperatorHarness(page, {
    snapshotSequence: [makeBaseOperatorSnapshot()],
  });

  await openOperator(page);

  await expect(page.getByRole('heading', { name: 'Subagent Tree' })).toBeVisible();
  await expect(page.getByText('helper / child-run-1', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Child session/i }).click();
  await expect(page.getByText('opencli_extract', { exact: true })).toBeVisible();
  await expect(page.getByText('Child memory captured', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Child session/i })).toBeVisible();
});
