import mammoth from 'mammoth';
import fs from 'fs';

async function main() {
  const path = 'E:\\DOCU_AI\\sample\\RAG_Seminar_Report.docx';
  const buffer = fs.readFileSync(path);
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;
  fs.writeFileSync('scratch/sample_text.txt', text, 'utf-8');
  console.log('Saved entire sample text to scratch/sample_text.txt');
}

main().catch(console.error);
