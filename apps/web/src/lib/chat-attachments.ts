import type { ChatAttachment } from '@rawclaw/shared';

export const MAX_ATTACHMENT_PROMPT_CHARS = 2 * 1024 * 1024;
export const MAX_RAW_FILE_BYTES = 20 * 1024 * 1024;
export const BIN_SNIFF_LIMIT = 2048;

export async function processFileForAttachment(file: File): Promise<{ attachment?: ChatAttachment; error?: string }> {
  if (file.size > MAX_RAW_FILE_BYTES) {
    return { error: `"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max allowed is 20MB.` };
  }

  const isDoc = file.type === 'application/pdf' || file.type.startsWith('image/');
  if (isDoc) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        resolve({
          attachment: {
            filename: file.name,
            size: file.size,
            type: file.type,
            content: base64,
          },
        });
      };
      reader.onerror = () => resolve({ error: `Failed to read "${file.name}"` });
      reader.readAsDataURL(file);
    });
  }

  try {
    const chunk = file.slice(0, BIN_SNIFF_LIMIT);
    const buffer = await chunk.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i += 1) {
      if (bytes[i] === 0) {
        return { error: `"${file.name}" appears to be a binary file. RawClaw currently only supports text, PDF, and image attachments.` };
      }
    }
  } catch {
    return { error: `Could not read "${file.name}" for analysis.` };
  }

  try {
    const text = await file.text();
    return {
      attachment: {
        filename: file.name,
        size: file.size,
        type: file.type,
        content: text,
        isTruncated: text.length > MAX_ATTACHMENT_PROMPT_CHARS,
      },
    };
  } catch {
    return { error: `Failed to read text from "${file.name}". It may be encoded incorrectly.` };
  }
}
