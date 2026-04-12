import { ToolCall } from '@rawclaw/shared';
import { useState } from 'react';
import { FiTool, FiChevronDown, FiChevronUp } from 'react-icons/fi';

interface Props {
  toolCall: ToolCall;
}

export function ToolCard({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="tool-card">
      <div 
        className="tool-card-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="tool-card-title">
          <FiTool />
          <span>Used <strong>{toolCall.tool_name}</strong></span>
        </div>
        {expanded ? <FiChevronUp /> : <FiChevronDown />}
      </div>
      
      {expanded && (
        <div className="tool-card-body">
          <div className="tool-card-section">
            <div className="tool-card-label">Input</div>
            <pre>{JSON.stringify(toolCall.input, null, 2)}</pre>
          </div>
          {/* Note: toolCall doesn't inherently store the result in this type, 
              but if we added it, it would go here */}
        </div>
      )}
    </div>
  );
}
