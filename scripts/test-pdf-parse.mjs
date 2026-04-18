import fs from 'node:fs';
import { PDFParse } from 'pdf-parse';

const buf = fs.readFileSync('scripts/test-fixtures/tiny-text.pdf');

try {
  // pdf-parse v2: Pass data in the constructor options
  const parser = new PDFParse({ data: new Uint8Array(buf), verbosity: 0 });
  const data = await parser.getText();
  console.log('SUCCESS');
  console.log('text:', JSON.stringify(data.text));
  console.log('numpages:', data.pages.length);
} catch (e) {
  console.log('PARSE ERROR:', e.message);
  console.log('stack:', e.stack);
}
