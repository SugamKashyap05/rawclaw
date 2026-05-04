# An Image Viewing Reviewing Plan

Build an image viewing tool for reviewing local image sets.

Requirements:
- Web app
- Responsive layout
- Polished local preview
- No real backend required for v1; local mock image data is fine

Main views:
- Gallery overview
- Single image viewer
- Metadata/details panel
- Review history panel

Each image item should have:
- title
- filename
- owner
- status
- tags
- dimensions
- uploaded date
- notes

Actions:
- open image
- zoom in
- zoom out
- fit to screen
- rotate image
- mark favorite
- approve image
- reject image
- filter by status and tag
- search by title or filename

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
- return structured state for control

Refinement:
so tell me what you suggest to add

Refinement:
there is no window to uplode the image in the app

Refinement:
there is no window to uplode the image in the app

Refinement:
there is no window to uplode the image in the app

Refinement:
can you see the image and telll me where i wiilmuplode the image for image discription

## Features
- history
- image gallery
- single image viewer
- metadata details panel
- review history panel
- zoom and fit controls
- image rotation
- favorites
- image review actions
- tag filters
- filename search
- status filters
- title search
- local mock data
- RawClaw SDK hooks and manifest
- structured control state
- local preview

## Architecture
- Framework: react
- Build: vite
- SDK transport: http