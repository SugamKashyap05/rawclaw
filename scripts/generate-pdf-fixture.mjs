import fs from 'node:fs';

// A minimal valid PDF v1.4 with one page containing "RAWCLAW_PDF_TEXT"
// This avoids manual xref offset errors by calculating them.
const chunks = [
  '%PDF-1.4\n',
  '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n',
  '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n',
  '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents 4 0 R >> endobj\n',
  '4 0 obj << /Length 46 >> stream\nBT /F1 12 Tf 10 50 Td (RAWCLAW_PDF_TEXT) Tj ET\nendstream\nendobj\n'
];

let pdf = chunks.join('');
const xrefOffset = pdf.length;

const xref = [
  'xref\n',
  '0 5\n',
  '0000000000 65535 f \n',
  `${'0000000000'.slice(0, 10 - chunks[0].length)}${chunks[0].length}`.padStart(10, '0') + ' 00000 n \n' // obj 1
];

// Re-calculating offsets manually for simplicity since it's a tiny file
const obj1Pos = chunks[0].length;
const obj2Pos = obj1Pos + chunks[1].length;
const obj3Pos = obj2Pos + chunks[2].length;
const obj4Pos = obj3Pos + chunks[3].length;

const finalPdf = 
  chunks[0] + 
  chunks[1] + 
  chunks[2] + 
  chunks[3] + 
  chunks[4] +
  `xref\n0 5\n0000000000 65535 f \n` +
  `${obj1Pos.toString().padStart(10, '0')} 00000 n \n` +
  `${obj2Pos.toString().padStart(10, '0')} 00000 n \n` +
  `${obj3Pos.toString().padStart(10, '0')} 00000 n \n` +
  `${obj4Pos.toString().padStart(10, '0')} 00000 n \n` +
  `trailer << /Size 5 /Root 1 0 R >>\n` +
  `startxref\n${(obj4Pos + chunks[4].length).toString()}\n` +
  `%%EOF\n`;

fs.writeFileSync('scripts/test-fixtures/tiny-text.pdf', finalPdf);
console.log('PDF generated at scripts/test-fixtures/tiny-text.pdf');
