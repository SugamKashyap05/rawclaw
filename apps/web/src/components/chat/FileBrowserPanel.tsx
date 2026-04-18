import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { FiFolder, FiFileText, FiX, FiRefreshCw, FiChevronRight, FiChevronDown, FiPlus } from 'react-icons/fi';
import { ChatAttachment } from '@rawclaw/shared';

interface WorkspaceFileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WorkspaceFileNode[];
}

interface FileBrowserPanelProps {
  onClose: () => void;
  onAttach: (attachment: ChatAttachment) => void;
}

function FileTreeNode({ 
  node, 
  level = 0, 
  onAttach 
}: { 
  node: WorkspaceFileNode; 
  level?: number;
  onAttach: (path: string, name: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const isDir = node.type === 'directory';

  return (
    <div style={{ marginLeft: `${level * 12}px`, marginBottom: '2px' }}>
      <div 
        onClick={() => isDir && setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 6px',
          borderRadius: '4px',
          cursor: isDir ? 'pointer' : 'default',
          background: 'rgba(255,255,255,0.02)',
        }}
        className="workspace-file-node"
      >
        {isDir ? (
          isOpen ? <FiChevronDown size={12} style={{ opacity: 0.6 }} /> : <FiChevronRight size={12} style={{ opacity: 0.6 }} />
        ) : (
          <span style={{ width: 12 }} />
        )}
        
        {isDir ? <FiFolder size={14} style={{ color: 'var(--neon-cyan)' }} /> : <FiFileText size={14} style={{ opacity: 0.8 }} />}
        
        <span style={{ fontSize: '0.85rem', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.name}
        </span>

        {!isDir && (
          <button
            className="attach-btn"
            onClick={(e) => {
              e.stopPropagation();
              onAttach(node.path, node.name);
            }}
            title="Attach File"
          >
            <FiPlus size={12} />
          </button>
        )}
      </div>

      {isDir && isOpen && node.children && (
        <div style={{ marginTop: '2px' }}>
          {node.children.map(child => (
            <FileTreeNode key={child.path} node={child} level={level + 1} onAttach={onAttach} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileBrowserPanel({ onClose, onAttach }: FileBrowserPanelProps) {
  const [tree, setTree] = useState<WorkspaceFileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const loadFiles = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<{ root: string; tree: WorkspaceFileNode[] }>('/workspace/files');
      setTree(res.data.tree);
    } catch (err: any) {
      setError(err.message || 'Failed to load workspace files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadFiles();
  }, []);

  const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

  const handleAttachClick = async (path: string, name: string) => {
    try {
      const res = await api.get<{ content: string; filename: string }>(`/workspace/file?path=${encodeURIComponent(path)}`);
      let content = res.data.content;
      if (content.length > MAX_ATTACHMENT_BYTES) {
        content = content.slice(0, MAX_ATTACHMENT_BYTES);
        console.warn(`Workspace file "${name}" truncated to 2MB for attachment.`);
      }
      onAttach({
        filename: res.data.filename || name,
        content,
        size: new Blob([res.data.content]).size
      });
    } catch (err: any) {
      setError(`Failed to attach ${name}: ${err.response?.data?.message || err.message}`);
    }
  };

  return (
    <div style={{
      width: '280px',
      borderLeft: '1px solid var(--border-glass)',
      background: 'rgba(15, 23, 42, 0.4)',
      backdropFilter: 'blur(12px)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      minHeight: 0
    }}>
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--border-glass)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FiFolder /> Workspace
        </h3>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={loadFiles} title="Refresh">
            <FiRefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }} onClick={onClose} title="Close Workspace Browser">
            <FiX size={16} />
          </button>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .attach-btn {
          background: rgba(0, 240, 255, 0.1);
          border: 1px solid rgba(0, 240, 255, 0.2);
          color: var(--neon-cyan);
          border-radius: 4px;
          padding: 2px 4px;
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s;
        }
        .attach-btn:hover {
          background: rgba(0, 240, 255, 0.2);
        }
        .workspace-file-node:hover .attach-btn {
          opacity: 1;
        }
      `}} />

      <div className="custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '12px 8px' }}>
        {error && (
          <div style={{ color: 'var(--error)', fontSize: '0.85rem', padding: '8px' }}>{error}</div>
        )}
        
        {!loading && !error && tree.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '20px 0' }}>
            No files found
          </div>
        )}

        <div style={{ padding: '0 4px', paddingBottom: '12px' }}>
          {tree.map(node => (
            <FileTreeNode key={node.path} node={node} onAttach={handleAttachClick} />
          ))}
        </div>
      </div>
    </div>
  );
}
