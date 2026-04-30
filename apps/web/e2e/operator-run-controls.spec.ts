import { expect, test } from '@playwright/test';
import { makeAutomationSnapshot, makeRunActionResult } from './fixtures/operator-fixtures';
import { mountOperatorHarness, openOperator } from './fixtures/operator-mocks';

test('cancel and retry mutate visible run state from the operator surface', async ({ page }) => {
  const initial = makeAutomationSnapshot();
  const cancelled = {
    ...makeAutomationSnapshot(),
    currentRuns: makeAutomationSnapshot().currentRuns.map((run) =>
      run.id === 'automation-run-1' ? { ...run, status: 'cancelled', summary: 'Cancelled.' } : run,
    ),
  };
  const retried = {
    ...cancelled,
    currentRuns: cancelled.currentRuns.map((run) =>
      run.id === 'automation-run-1'
        ? { ...run, id: 'automation-run-2', status: 'queued', summary: 'Replacement automation queued.' }
        : run,
    ),
  };

  await mountOperatorHarness(page, {
    snapshotSequence: [initial, initial, cancelled, retried],
    streamHeartbeat: false,
    runActionResults: {
      cancel: makeRunActionResult('cancel_run', 'automation-run-1', {
        message: 'Cancellation requested.',
      }),
      retry: makeRunActionResult('retry_run', 'automation-run-1', {
        message: 'Replacement automation queued.',
        replacementRunId: 'automation-run-2',
      }),
    },
  });

  await openOperator(page);

  await page.getByRole('button', { name: /Recurring research pulse/i }).click();
  await expect(page.getByRole('button', { name: /Retry Run/i })).toBeVisible();
  await page.getByRole('button', { name: /Cancel Run/i }).click();
  await expect(page.getByText('Cancelled.', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: /Retry Run/i }).click();
  await expect(page.getByText('Replacement automation queued.', { exact: true }).first()).toBeVisible();
});
