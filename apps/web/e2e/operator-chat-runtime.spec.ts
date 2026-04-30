import { expect, test } from '@playwright/test';
import { makeBaseOperatorSnapshot } from './fixtures/operator-fixtures';
import { mountOperatorHarness, openOperator } from './fixtures/operator-mocks';

test('chat runtime presence is visible on the operator surface', async ({ page }) => {
  await mountOperatorHarness(page, {
    snapshotSequence: [makeBaseOperatorSnapshot()],
  });

  await openOperator(page);

  await expect(page.getByRole('button', { name: /Main session/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Main chat route/i })).toBeVisible();
  await expect(page.getByText('rawclaw-default', { exact: true })).toBeVisible();
  await expect(page.getByText('Main route heartbeat', { exact: true })).toBeVisible();
});
