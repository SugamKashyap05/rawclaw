import { ChangeEvent, useMemo, useState } from 'react';
import { emitRawClawEvent } from './rawclaw-sdk';

type ImageStatus = 'pending' | 'approved' | 'rejected';
type ImageItem = {
  id: string;
  title: string;
  owner: string;
  status: ImageStatus;
  priority: 'low' | 'normal' | 'urgent';
  submittedDate: string;
  dimensions: string;
  size: string;
  tags: string[];
  notes: string;
  palette: string;
  src?: string;
};

type HistoryEntry = { id: string; imageTitle: string; action: string; at: string };

const appTitle = "An Image Viewing Reviewing";
const summary = "Build an image viewing tool for reviewing local image sets.\n\nRequirements:\n- Web app\n- Responsive layout\n- Polished local preview\n- No real backend required for v1; local mock image data is fine\n\nMain views:\n- Gallery overview\n- Single image viewer\n- Metadata/details panel\n- Review history panel\n\nEach image item should have:\n- title\n- filename\n- owner\n- status\n- tags\n- dimensions\n- uploaded date\n- notes\n\nActions:\n- open image\n- zoom in\n- zoom out\n- fit to screen\n- rotate image\n- mark favorite\n- approve image\n- reject image\n- filter by status and tag\n- search by title or filename\n\nRawClaw control:\n- add SDK hooks and manifest\n- expose actions:\n  - list_images\n  - open_image\n  - zoom_image\n  - rotate_image\n  - fit_image\n  - mark_favorite\n  - approve_image\n  - reject_image\n  - filter_images\n  - get_viewer_state\n- emit events when:\n  - image opened\n  - zoom changed\n  - image rotated\n  - image approved\n  - image rejected\n  - filters changed\n- return structured state for control\n\nRefinement:\nso tell me what you suggest to add\n\nRefinement:\nthere is no window to uplode the image in the app\n\nRefinement:\nthere is no window to uplode the image in the app\n\nRefinement:\nthere is no window to uplode the image in the app\n\nRefinement:\ncan you see the image and telll me where i wiilmuplode the image for image discription";
const controlActions = ["list_images","open_image","zoom_image","rotate_image","fit_image","mark_favorite","approve_image","reject_image","filter_images","get_viewer_state"] as string[];
const runtimeEvents = ["image.opened","zoom.changed","image.rotated","image.approved","image.rejected","filters.changed"] as string[];
const requestedSections = ["hero","content area","support panel"] as string[];

const initialImages: ImageItem[] = [
  { id: 'img-001', title: 'Storefront hero refresh', owner: 'Mira', status: 'pending', priority: 'urgent', submittedDate: '2026-05-01', dimensions: '2400 x 1600', size: '3.4 MB', tags: ['campaign', 'hero'], notes: 'Needs approval before the Monday launch.', palette: 'linear-gradient(135deg, #0bd3ff, #7c3aed)' },
  { id: 'img-002', title: 'Operations badge set', owner: 'Dev', status: 'pending', priority: 'normal', submittedDate: '2026-04-30', dimensions: '1800 x 1200', size: '1.8 MB', tags: ['icons', 'ops'], notes: 'Check contrast and crop before publishing.', palette: 'linear-gradient(135deg, #98f47d, #0ea5e9)' },
  { id: 'img-003', title: 'Partner announcement card', owner: 'Leah', status: 'approved', priority: 'low', submittedDate: '2026-04-28', dimensions: '1600 x 900', size: '1.2 MB', tags: ['social', 'partner'], notes: 'Approved for scheduling.', palette: 'linear-gradient(135deg, #f97316, #22c55e)' },
  { id: 'img-004', title: 'Rejected mobile crop', owner: 'Anik', status: 'rejected', priority: 'normal', submittedDate: '2026-04-27', dimensions: '1200 x 1600', size: '2.1 MB', tags: ['mobile', 'crop'], notes: 'Subject is clipped on narrow screens.', palette: 'linear-gradient(135deg, #ef4444, #f59e0b)' },
];

export default function App() {
  const [images, setImages] = useState<ImageItem[]>(initialImages);
  const [selectedId, setSelectedId] = useState(initialImages[0].id);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ImageStatus>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([
    { id: 'hist-1', imageTitle: 'Partner announcement card', action: 'approved', at: '2026-04-28 14:20' },
    { id: 'hist-2', imageTitle: 'Rejected mobile crop', action: 'rejected', at: '2026-04-27 09:45' },
  ]);

  const allTags = useMemo(() => Array.from(new Set(images.flatMap((image) => image.tags))).sort(), [images]);
  const selected = images.find((image) => image.id === selectedId) || images[0];
  const filteredImages = images.filter((image) => {
    const matchesQuery = image.title.toLowerCase().includes(query.toLowerCase());
    const matchesStatus = statusFilter === 'all' || image.status === statusFilter;
    const matchesTag = tagFilter === 'all' || image.tags.includes(tagFilter);
    return matchesQuery && matchesStatus && matchesTag;
  });

  const recordHistory = (image: ImageItem, action: string) => {
    setHistory((current) => [{ id: crypto.randomUUID(), imageTitle: image.title, action, at: new Date().toLocaleString() }, ...current].slice(0, 8));
  };

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    const uploaded = files.map((file, index): ImageItem => ({
      id: crypto.randomUUID(),
      title: file.name.replace(/\.[^.]+$/, ''),
      owner: 'Local upload',
      status: 'pending',
      priority: index === 0 ? 'urgent' : 'normal',
      submittedDate: new Date().toISOString().slice(0, 10),
      dimensions: 'local file',
      size: `${Math.max(1, Math.round(file.size / 1024))} KB`,
      tags: ['uploaded'],
      notes: 'Uploaded locally for preview and review.',
      palette: 'linear-gradient(135deg, #0bd3ff, #98f47d)',
      src: URL.createObjectURL(file),
    }));
    setImages((current) => [...uploaded, ...current]);
    setSelectedId(uploaded[0].id);
    setStatusFilter('all');
    setTagFilter('all');
    setQuery('');
    recordHistory(uploaded[0], 'uploaded');
    emitRawClawEvent('image.uploaded', { count: uploaded.length, imageIds: uploaded.map((image) => image.id), titles: uploaded.map((image) => image.title) });
    event.target.value = '';
  };

  const chooseImage = (image: ImageItem) => {
    setSelectedId(image.id);
    emitRawClawEvent('image.opened', { imageId: image.id, title: image.title });
  };

  const updateStatus = (status: ImageStatus) => {
    setImages((current) => current.map((image) => image.id === selected.id ? { ...image, status } : image));
    recordHistory(selected, status);
    emitRawClawEvent(status === 'approved' ? 'image.approved' : 'image.rejected', { imageId: selected.id, title: selected.title });
  };

  const updateFilters = (next: { query?: string; status?: 'all' | ImageStatus; tag?: string }) => {
    if (next.query !== undefined) setQuery(next.query);
    if (next.status !== undefined) setStatusFilter(next.status);
    if (next.tag !== undefined) setTagFilter(next.tag);
    emitRawClawEvent('filters.changed', { query: next.query ?? query, status: next.status ?? statusFilter, tag: next.tag ?? tagFilter });
  };

  const changeZoom = (nextZoom: number) => {
    const bounded = Math.min(180, Math.max(50, nextZoom));
    setZoom(bounded);
    emitRawClawEvent('zoom.changed', { imageId: selected.id, zoom: bounded });
  };

  const rotateImage = () => {
    const nextRotation = (rotation + 90) % 360;
    setRotation(nextRotation);
    emitRawClawEvent('image.rotated', { imageId: selected.id, rotation: nextRotation });
  };

  const toggleFavorite = () => {
    setFavorites((current) => current.includes(selected.id) ? current.filter((id) => id !== selected.id) : [...current, selected.id]);
    emitRawClawEvent('favorite.changed', { imageId: selected.id });
  };

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="eyebrow">RawClaw Image Viewer</div>
        <h1>{appTitle}</h1>
        <p>{summary}</p>
      </section>
      <section className="workspace-panel">
        <div className="eyebrow">Gallery Overview</div>
        <div className="filter-row" style={{ marginTop: '0.85rem' }}>
          <label className="key-btn primary" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '0 1rem' }}>
            Upload images
            <input aria-label="Upload images" type="file" accept="image/*" multiple onChange={handleUpload} style={{ display: 'none' }} />
          </label>
          <input aria-label="Search by title" value={query} onChange={(event) => updateFilters({ query: event.target.value })} placeholder="Search by title" />
          <select aria-label="Filter by status" value={statusFilter} onChange={(event) => updateFilters({ status: event.target.value as 'all' | ImageStatus })}>
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <select aria-label="Filter by tag" value={tagFilter} onChange={(event) => updateFilters({ tag: event.target.value })}>
            <option value="all">All tags</option>
            {allTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </div>
        <div className="gallery-grid" style={{ marginTop: '1rem' }}>
          {filteredImages.map((image) => (
            <button type="button" className={image.id === selected.id ? 'gallery-card active' : 'gallery-card'} key={image.id} onClick={() => chooseImage(image)}>
              {image.src ? <img src={image.src} alt="" className="mock-image" style={{ width: '100%', objectFit: 'cover', marginBottom: '0.75rem' }} /> : <div className="mock-image" style={{ width: '100%', background: image.palette, marginBottom: '0.75rem' }}>{image.title.slice(0, 2).toUpperCase()}</div>}
              <strong>{image.title}</strong>
              <div style={{ color: 'var(--muted)', marginTop: '0.35rem' }}>{image.owner} / {image.status}</div>
            </button>
          ))}
        </div>
      </section>
      <section className="grid two-up">
        <div className="workspace-panel">
          <div className="eyebrow">Single Image Viewer</div>
          <h2>{selected.title}</h2>
          <div className="image-preview">
            {selected.src ? <img src={selected.src} alt={selected.title} className="uploaded-image" style={{ transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }} /> : <div className="mock-image" style={{ background: selected.palette, transform: `scale(${zoom / 100}) rotate(${rotation}deg)` }}>{selected.title}</div>}
          </div>
          <div className="action-row" style={{ marginTop: '1rem' }}>
            <button type="button" className="key-btn" onClick={() => changeZoom(zoom - 10)}>Zoom out</button>
            <button type="button" className="key-btn" onClick={() => changeZoom(zoom + 10)}>Zoom in</button>
            <button type="button" className="key-btn" onClick={() => changeZoom(100)}>Fit image</button>
            <button type="button" className="key-btn" onClick={rotateImage}>Rotate</button>
            <button type="button" className="key-btn" onClick={toggleFavorite}>{favorites.includes(selected.id) ? 'Favorited' : 'Favorite'}</button>
          </div>
          <div className="action-row" style={{ marginTop: '0.75rem' }}>
            <button type="button" className="key-btn primary" onClick={() => updateStatus('approved')}>Approve image</button>
            <button type="button" className="key-btn accent" onClick={() => updateStatus('rejected')}>Reject image</button>
          </div>
        </div>
        <aside className="workspace-panel">
          <div className="eyebrow">Metadata / Details</div>
          <h2>{selected.owner}</h2>
          <div className="spec-list">
            <div className="spec-item"><strong>Status</strong><div>{selected.status}</div></div>
            <div className="spec-item"><strong>Priority</strong><div>{selected.priority}</div></div>
            <div className="spec-item"><strong>Submitted</strong><div>{selected.submittedDate}</div></div>
            <div className="spec-item"><strong>Dimensions</strong><div>{selected.dimensions}</div></div>
            <div className="spec-item"><strong>Size</strong><div>{selected.size}</div></div>
            <div className="spec-item"><strong>Notes</strong><div>{selected.notes}</div></div>
          </div>
          <div className="action-row" style={{ marginTop: '1rem' }}>{selected.tags.map((tag) => <span className="chip" key={tag}>{tag}</span>)}</div>
        </aside>
      </section>
      <section className="grid two-up">
        <div className="workspace-panel">
          <div className="eyebrow">Review History</div>
          <div className="history-list" style={{ marginTop: '0.9rem' }}>
            {history.map((entry) => <div className="history-item" key={entry.id}><strong>{entry.action}</strong><div style={{ color: 'var(--muted)' }}>{entry.imageTitle} / {entry.at}</div></div>)}
          </div>
        </div>
        <div className="workspace-panel">
          <div className="eyebrow">RawClaw Control</div>
          <h2>Manifest capabilities</h2>
          <div className="action-row">{controlActions.map((action) => <span className="chip" key={action}>{action}</span>)}</div>
          <h2 style={{ marginTop: '1rem' }}>Events</h2>
          <div className="action-row">{runtimeEvents.map((event) => <span className="chip" key={event}>{event}</span>)}</div>
          <h2 style={{ marginTop: '1rem' }}>Requested views</h2>
          <div className="action-row">{requestedSections.map((section) => <span className="chip" key={section}>{section}</span>)}</div>
        </div>
      </section>
    </main>
  );
}
