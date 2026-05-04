import { IntentParserService } from './intent-parser.service';

describe('IntentParserService', () => {
  let service: IntentParserService;

  beforeEach(() => {
    service = new IntentParserService();
  });

  it('keeps a content approval dashboard brief out of the calculator template', () => {
    const prompt = `Build a content approval dashboard for a small operations team.

Requirements:
- Web app
- Responsive layout
- Main views:
  - Overview dashboard
  - Pending approvals list
  - Approved / rejected history
  - Item detail panel
- Each item should have:
  - title
  - owner
  - status
  - priority
  - submitted date
  - notes
- Actions:
  - approve item
  - reject item
  - mark urgent
  - filter by status and priority
  - search by title
- No real backend required for v1; local mock data is fine
- Keep it polished and easy to preview locally

RawClaw control:
- add SDK hooks and manifest
- expose actions:
  - list_items
  - approve_item
  - reject_item
  - mark_urgent
  - filter_items
  - get_dashboard_state
- emit events when:
  - item approved
  - item rejected
  - filters changed
- return structured state for control`;

    const intent = service.parse({
      prompt,
      sourceType: 'generated',
      appType: 'web_app',
      controlMode: 'action_limited',
      templateId: 'web-dashboard',
    });

    expect(intent.domain).toBe('dashboard');
    expect(intent.summary).toContain('Operational dashboard');
    expect(intent.requestedFeatures).toEqual(expect.arrayContaining([
      'overview dashboard',
      'pending approvals list',
      'approved and rejected history',
      'item detail panel',
      'status filters',
      'priority filters',
      'title search',
      'RawClaw SDK hooks and manifest',
      'structured control state',
    ]));
    expect(intent.requestedFeatures).not.toEqual(expect.arrayContaining(['addition', 'subtraction', 'multiplication', 'division']));
    expect(intent.controlActions).toEqual([
      'list_items',
      'approve_item',
      'reject_item',
      'mark_urgent',
      'filter_items',
      'get_dashboard_state',
    ]);
    expect(intent.runtimeEvents).toEqual(['item.approved', 'item.rejected', 'filters.changed']);
  });

  it('still recognizes explicit calculator prompts', () => {
    const intent = service.parse({
      prompt: 'Build a calculator with keypad, decimals, percent, and history.',
      sourceType: 'generated',
      appType: 'web_app',
      controlMode: 'action_limited',
      templateId: 'web-dashboard',
    });

    expect(intent.domain).toBe('calculator');
    expect(intent.requestedFeatures).toEqual(expect.arrayContaining(['addition', 'history', 'keyboard input']));
  });

  it('extracts arbitrary RawClaw actions and normalized events from an image viewer brief', () => {
    const prompt = `Build an image viewing tool for a content team.

Requirements:
- Web app
- Gallery overview
- Single image viewer
- Metadata / details panel
- Review history
- Search by filename
- Filter by tag and status
- Zoom in and zoom out
- Rotate image
- Mark favorite
- Approve image
- Reject image

RawClaw control:
- add SDK hooks and manifest
- expose actions:
  - list_images
  - open_image
  - zoom_image
  - rotate_image
  - fit_image
  - mark_favorite
  - approve_image
  - reject_image
  - filter_images
  - get_viewer_state
- emit events when:
  - image opened
  - zoom changed
  - image rotated
  - image approved
  - image rejected
  - filters changed
- return structured state for control`;

    const intent = service.parse({
      prompt,
      sourceType: 'generated',
      appType: 'web_app',
      controlMode: 'action_limited',
      templateId: 'web-dashboard',
    });

    expect(intent.domain).toBe('generic_web');
    expect(intent.requestedFeatures).toEqual(expect.arrayContaining([
      'image gallery',
      'single image viewer',
      'metadata details panel',
      'review history panel',
      'zoom and fit controls',
      'image rotation',
      'favorites',
      'image review actions',
      'tag filters',
      'filename search',
    ]));
    expect(intent.controlActions).toEqual([
      'list_images',
      'open_image',
      'zoom_image',
      'rotate_image',
      'fit_image',
      'mark_favorite',
      'approve_image',
      'reject_image',
      'filter_images',
      'get_viewer_state',
    ]);
    expect(intent.runtimeEvents).toEqual([
      'image.opened',
      'zoom.changed',
      'image.rotated',
      'image.approved',
      'image.rejected',
      'filters.changed',
    ]);
  });
});
