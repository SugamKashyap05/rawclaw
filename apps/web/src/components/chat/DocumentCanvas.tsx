import React, { useEffect, useState } from 'react';
import { FiX, FiInfo } from 'react-icons/fi';
import { api } from '../../lib/api';

interface Document {
  id: string;
  filename: string;
  extractedText: string;
  extractionMethod: string;
  mimeType: string;
  createdAt: string;
}

interface DocumentCanvasProps {
  documentId: string;
  extractionFailed?: boolean;
  extractionError?: string;
  onClose: () => void;
  onSelect: (selection: { text: string; contextBefore: string; contextAfter: string }) => void;
  activeSelection?: { text: string; contextBefore: string; contextAfter: string } | null;
  editSuggestion?: string | null;
  onAcceptEdit?: (newText: string) => void;
  onRejectEdit?: () => void;
}

export const DocumentCanvas: React.FC<DocumentCanvasProps> = ({ 
  documentId, 
  extractionFailed, 
  extractionError, 
  onClose, 
  onSelect,
  activeSelection,
  editSuggestion,
  onAcceptEdit,
  onRejectEdit
}) => {
  const [doc, setDoc] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // If extraction failed, show error state instead of trying to load
  if (extractionFailed) {
    return (
      <div className="glass-card" style={{
        width: '450px',
        display: 'flex',
        flexDirection: 'column',
        padding: '0',
        borderLeft: '1px solid var(--border-glass)',
        animation: 'slideInRight 0.3s ease-out'
      }}>
        <div style={{
          padding: '1rem',
          borderBottom: '1px solid var(--border-glass)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(255,77,77,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: 'var(--error)' }}>
            <FiInfo />
            <span style={{ fontWeight: 600 }}>Document Processing Failed</span>
          </div>
          <button className="icon-btn" onClick={onClose}><FiX size={18} /></button>
        </div>
        <div style={{ padding: '1.5rem', color: 'var(--text-secondary)' }}>
          <p style={{ marginBottom: '0.75rem' }}>
            This document could not be processed:
          </p>
          <code style={{
            display: 'block',
            padding: '0.75rem',
            background: 'rgba(255,77,77,0.08)',
            border: '1px solid rgba(255,77,77,0.2)',
            borderRadius: '8px',
            fontSize: '0.8rem',
            color: 'var(--error)'
          }}>
            {extractionError || 'Extraction failed. The document format may not be supported.'}
          </code>
          <p style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Supported formats: text PDFs, images (PNG, JPG, WEBP). Scanned PDFs require OCR which is not yet available.
          </p>
        </div>
      </div>
    );
  }

  useEffect(() => {
    const fetchDoc = async () => {
      setLoading(true);
      try {
        // Correct path is now /chat/docs
        const response = await api.get<Document>(`/chat/docs/${documentId}`);
        setDoc(response.data);
      } catch (err: any) {
        console.error('Fetch doc error:', err);
        setFetchError(`Failed to load document content: ${err.message || 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };
    fetchDoc();
  }, [documentId]);

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

    const text = selection.toString().trim();
    if (!text) return;

    // The logic below identifies the selection within the pre-wrap container
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const parent = container.nodeType === 3 ? container.parentElement : (container as HTMLElement);
    
    if (!parent) return;

    const fullText = doc?.extractedText || '';
    const startIdx = fullText.indexOf(text);
    
    if (startIdx === -1) return; // Fallback if direct match fails

    // Get 200 chars of context as requested
    const contextBefore = fullText.substring(Math.max(0, startIdx - 200), startIdx);
    const contextAfter = fullText.substring(startIdx + text.length, Math.min(fullText.length, startIdx + text.length + 200));

    onSelect({ text, contextBefore, contextAfter });
    
    // Clear selection visually to avoid frustration
    selection.removeAllRanges();
  };

  const renderContent = () => {
    const fullText = doc?.extractedText || '';
    
    if (!activeSelection || !fullText.includes(activeSelection.text)) {
      return fullText;
    }

    const { text } = activeSelection;
    const startIdx = fullText.indexOf(text);
    const before = fullText.substring(0, startIdx);
    const after = fullText.substring(startIdx + text.length);

    if (editSuggestion) {
      return (
        <React.Fragment>
          {before}
          <span style={{ 
            background: 'rgba(255, 77, 77, 0.2)', 
            textDecoration: 'line-through',
            color: 'var(--text-muted)'
          }}>
            {text}
          </span>
          <span style={{ 
            background: 'rgba(0, 255, 150, 0.15)',
            boxShadow: '0 0 10px rgba(0, 255, 150, 0.2)',
            color: '#00ff96',
            padding: '2px 4px',
            borderRadius: '4px',
            border: '1px solid rgba(0, 255, 150, 0.3)',
            display: 'inline-block',
            position: 'relative',
            marginTop: '4px',
            marginBottom: '4px'
          }}>
            {editSuggestion}
            <div style={{
              position: 'absolute',
              top: '-35px',
              right: 0,
              display: 'flex',
              gap: '4px',
              zIndex: 10
            }}>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  if (doc && activeSelection) {
                    setDoc({
                      ...doc,
                      extractedText: doc.extractedText.replace(activeSelection.text, editSuggestion)
                    });
                  }
                  onAcceptEdit?.(editSuggestion);
                }}
                style={{
                  background: 'var(--success)',
                  color: 'var(--bg-deep)',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >Accept</button>
              <button 
                onClick={(e) => {
                  e.stopPropagation();
                  onRejectEdit?.();
                }}
                style={{
                  background: 'var(--error)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  padding: '4px 8px',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >Reject</button>
            </div>
          </span>
          {after}
        </React.Fragment>
      );
    }

    return (
      <React.Fragment>
        {before}
        <span style={{ 
          background: 'rgba(0, 240, 255, 0.15)',
          boxShadow: '0 0 10px rgba(0, 240, 255, 0.2)',
          borderBottom: '2px solid var(--neon-cyan)',
          padding: '2px 0'
        }}>
          {text}
        </span>
        {after}
      </React.Fragment>
    );
  };

  if (loading) {
     return (
       <div className="glass-card" style={{ width: '400px', padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
         <div className="loader"></div>
       </div>
     );
  }

  if (fetchError || !doc) {
    return (
      <div className="glass-card" style={{ width: '400px', padding: '1.5rem', color: 'var(--error)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <span>Error</span>
          <button onClick={onClose}><FiX /></button>
        </div>
        <div>{fetchError || 'Document not found'}</div>
      </div>
    );
  }

  return (
    <div className="glass-card" style={{ 
      width: '450px', 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '0',
      padding: '0',
      borderLeft: '1px solid var(--border-glass)',
      animation: 'slideInRight 0.3s ease-out'
    }}>
      {/* Header */}
      <div style={{ 
        padding: '1rem', 
        borderBottom: '1px solid var(--border-glass)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(255,255,255,0.02)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <FiInfo style={{ color: 'var(--neon-cyan)' }} />
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600, maxWidth: '250px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {doc.filename}
          </h3>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="icon-btn" onClick={onClose}><FiX size={18} /></button>
        </div>
      </div>

      {/* Content */}
      <div 
        className="custom-scrollbar"
        onMouseUp={handleTextSelection}
        style={{ 
          flex: 1, 
          overflow: 'auto', 
          padding: '1.5rem',
          fontSize: '0.9rem',
          lineHeight: '1.6',
          color: 'var(--text-secondary)',
          background: 'rgba(0,0,0,0.2)',
          userSelect: 'text'
        }}
      >
        <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>
          {renderContent()}
        </div>
      </div>

      {/* Footer Info */}
      <div style={{ 
        padding: '0.75rem 1rem', 
        borderTop: '1px solid var(--border-glass)',
        fontSize: '0.75rem',
        color: 'var(--text-muted)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span>ID: {doc.id.slice(0,8)}</span>
          <div style={{ 
            background: 'rgba(0, 255, 249, 0.1)', 
            color: 'var(--neon-cyan)', 
            padding: '2px 8px', 
            borderRadius: '4px',
            fontSize: '0.65rem',
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            border: '1px solid rgba(0, 255, 249, 0.2)'
          }}>
            {doc.extractionMethod.replace(/_/g, ' ')}
          </div>
        </div>
        <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
};
