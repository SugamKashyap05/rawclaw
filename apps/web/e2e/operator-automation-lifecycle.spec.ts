import { expect, test } from '@playwright/test';
import { makeAutomationCompletedSnapshot, makeAutomationSnapshot } from './fixtures/operator-fixtures';
import { mountOperatorHarness, openOperator } from './fixtures/operator-mocks';

test('automation activity appears and completion becomes visible after refresh', async ({ page }) => {
  await mountOperatorHarness(page, {
    snapshotSequence: [makeAutomationSnapshot(), makeAutomationCompletedSnapshot()],
  });

  await openOperator(page);

  await expect(page.getByRole('button', { name: /Recurring research pulse/i })).toBeVisible();
  await expect(page.getByText('Automation run started', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /Refresh operator/i }).click();

  await expect(page.getByText('Automation run completed', { exact: true })).toBeVisible();
  await expect(page.getByText('Automation run completed with a fresh standings brief.', { exact: true })).toBeVisible();
});
