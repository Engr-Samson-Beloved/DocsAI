import fs from 'fs'
import path from 'path'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } from 'docx'
import { execSync } from 'child_process'

// Helper to load .env.local environment variables
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local file not found in the project root')
  }
  const content = fs.readFileSync(envPath, 'utf-8')
  const env = {}
  content.split('\n').forEach(line => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const parts = trimmed.split('=')
    if (parts.length >= 2) {
      env[parts[0].trim()] = parts.slice(1).join('=').trim()
    }
  })
  return env
}

const env = loadEnv()
const GEMINI_API_KEY = env['GEMINI_API_KEY']
if (!GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is missing from .env.local')
}

// Read logo image and convert to base64
const logoPath = path.join(process.cwd(), 'public', 'yabatech_logo.png')
let logoBase64 = ''
if (fs.existsSync(logoPath)) {
  logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
}

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)

// Section Generator
async function generateSection(title, prompt, previousContext = '') {
  // Use gemini-2.5-flash as the primary fast generation model
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  
  const systemInstruction = 
    `You are WordPI, an academic research writing assistant.\n` +
    `Write a comprehensive, professional, and detailed chapter for a seminar report.\n` +
    `Requirements:\n` +
    `- Academic, formal tone.\n` +
    `- NO placeholders like "[Source]", "[Year]", or "[1]". Write actual citations or facts.\n` +
    `- NO generic buzzwords (e.g., thereby, holistic, revolutionize, paradigm shift).\n` +
    `- Write in detail (around 600-800 words for this section) with concrete examples.\n` +
    `- Format using standard Markdown: Heading 1 as "# Heading", Heading 2 as "## Heading", lists as "* item", and plain text paragraphs. Do not use bold markdown ** inside paragraph text unless strictly necessary.`;

  const userPrompt = `${previousContext}\n\nChapter: ${title}\n\nTask:\n${prompt}`

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction,
    generationConfig: {
      temperature: 0.25,
      maxOutputTokens: 2548,
    }
  })

  return result.response.text()
}

// Parse markdown into paragraph nodes
function parseMarkdownToNodes(text) {
  const lines = text.split('\n')
  const nodes = []
  
  lines.forEach(line => {
    const trimmed = line.trim()
    if (!trimmed) return

    if (trimmed.startsWith('### ')) {
      nodes.push({ type: 'heading', level: 3, text: trimmed.replace('### ', '') })
    } else if (trimmed.startsWith('## ')) {
      nodes.push({ type: 'heading', level: 2, text: trimmed.replace('## ', '') })
    } else if (trimmed.startsWith('# ')) {
      nodes.push({ type: 'heading', level: 1, text: trimmed.replace('# ', '') })
    } else if (trimmed.startsWith('* ') || trimmed.startsWith('- ')) {
      const bulletText = trimmed.substring(2).trim()
      nodes.push({ type: 'bullet', text: bulletText })
    } else {
      nodes.push({ type: 'paragraph', text: trimmed })
    }
  })
  
  return nodes
}

async function main() {
  console.log('--- WordPI Offline Terminal Generation & Export ---')
  console.log('Topic: How Young Africans Can Build Global Tech Solutions')
  console.log('Author: Olabanji OWooluwa Samson (F/HD/24/3410036)\n')

  const sectionsToGenerate = [
    {
      title: 'Chapter 1: Introduction & Contextual Background',
      prompt: 'Write an extensive introduction on How Young Africans Can Build Global Tech Solutions. Detail the background of African technology development, the problem statement regarding local solution scaling, the main objectives of this study, and the significance of enabling African youths in the global tech economy. Avoid meta-introductions; start directly with the academic text.'
    },
    {
      title: 'Chapter 2: Literature Review & The African Tech Ecosystem Landscape',
      prompt: 'Conduct a thorough literature review of the African technology landscape. Discuss the growth of tech hubs (Lagos, Nairobi, Cape Town), the role of open source, infrastructure constraints (power, bandwidth), and how educational institutions like YABATECH play a role in developer training. Reference real-world software engineering paradigms and frameworks.'
    },
    {
      title: 'Chapter 3: Strategic Frameworks for Building Globally Scalable Software',
      prompt: 'Describe the engineering and business frameworks needed for young African developers to build software that scales globally. Detail cloud architectures (AWS, GCP, Azure), microservices, API-first designs, localization vs internationalization strategies, and design thinking methodologies applied to solving local problems with global utility.'
    },
    {
      title: 'Chapter 4: Real-World Case Studies and Startup Successes',
      prompt: 'Analyze critical case studies of African tech entities going global, such as Flutterwave, Paystack, and Andela. Highlight the regulatory challenges they faced, seed funding patterns, talent acquisition models, and the key lessons that new African founders can learn from their execution journeys.'
    },
    {
      title: 'Chapter 5: Key Barriers, Opportunities, and Funding Mechanisms',
      prompt: 'Provide a granular review of funding constraints (venture capital patterns in Africa, local angel networks) and regulatory barriers. Then, detail the immense opportunities in Web3, AI, Fintech, and Agritech, explaining how African youths can leverage cost-effective tools to bypass traditional entry barriers.'
    },
    {
      title: 'Chapter 6: Proposed Strategic Implementation Model',
      prompt: 'Develop and outline a proposed action model for universities, hubs, and governments to support African tech talent. Detail curriculum reforms (industry-aligned coding bootcamps), cross-border developer networks, intellectual property protections, and policy recommendations for supporting early-stage youth startups.'
    },
    {
      title: 'Chapter 7: Conclusion & Summary of Actionable Insights',
      prompt: 'Write a scholarly conclusion summarizing the entire seminar report. Recapitulate the key findings, synthesize the future outlook of the African tech diaspora, and present a final call-to-action for African tech builders.'
    },
    {
      title: 'Chapter 8: Academic References & Journal Citations',
      prompt: 'Provide a structured references section containing 8 to 10 realistic, fully formatted APA style academic journal citations. These should include journal articles from IEEE, ACM, Springer, and African journals discussing tech startup scaling, digital skills training, and software architecture.'
    }
  ]

  const contents = []
  let combinedContext = 'Topic: How Young Africans Can Build Global Tech Solutions\n'

  for (let i = 0; i < sectionsToGenerate.length; i++) {
    const s = sectionsToGenerate[i]
    try {
      const generatedText = await generateSection(s.title, s.prompt, combinedContext)
      contents.push({ title: s.title, text: generatedText, parsed: parseMarkdownToNodes(generatedText) })
      combinedContext += `\nSummary of ${s.title}: ${generatedText.substring(0, 300)}...\n`
      console.log(`Successfully generated ${s.title}.\n`)
    } catch (e) {
      console.error(`Failed to generate ${s.title}:`, e)
      process.exit(1)
    }
  }

  // --- HTML Build for PDF ---
  console.log('Compiling HTML layout...')
  let html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Seminar Report</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 20mm 20mm 20mm;
    }
    body {
      font-family: 'Arial', sans-serif;
      color: #22252A;
      line-height: 1.6;
      font-size: 11pt;
      margin: 0;
      padding: 0;
    }
    .cover-page {
      height: 250mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      text-align: center;
      padding: 20mm 0;
      box-sizing: border-box;
      page-break-after: always;
    }
    .logo-container img {
      max-height: 80px;
      object-contain: fit;
    }
    .institution {
      font-size: 14pt;
      font-weight: bold;
      color: #111;
      text-transform: uppercase;
      margin-top: 10px;
    }
    .department {
      font-size: 12pt;
      color: #555;
      text-transform: uppercase;
    }
    .title-block {
      margin: 40px 0;
    }
    .document-type {
      font-size: 11pt;
      font-weight: bold;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: #185ABD;
    }
    .title {
      font-size: 22pt;
      font-weight: bold;
      color: #1B1F23;
      margin-top: 15px;
      line-height: 1.3;
    }
    .meta-block {
      font-size: 11pt;
      margin: 40px 0;
      text-align: left;
      width: 80%;
      border-left: 3px solid #185ABD;
      padding-left: 20px;
    }
    .meta-row {
      margin-bottom: 8px;
    }
    .meta-label {
      font-weight: bold;
      color: #555;
      display: inline-block;
      width: 150px;
    }
    .date-block {
      font-size: 11pt;
      font-weight: bold;
      color: #777;
    }
    
    .report-body {
      padding: 10mm 0;
    }
    .page-break {
      page-break-after: always;
    }
    h1 {
      font-size: 18pt;
      color: #1B1F23;
      margin-top: 30px;
      margin-bottom: 15px;
      page-break-before: always;
      border-bottom: 1.5px solid #E2E8F0;
      padding-bottom: 5px;
      text-transform: uppercase;
    }
    h2 {
      font-size: 14pt;
      color: #185ABD;
      margin-top: 25px;
      margin-bottom: 10px;
    }
    h3 {
      font-size: 12pt;
      color: #0F766E;
      margin-top: 20px;
      margin-bottom: 8px;
    }
    p {
      margin-bottom: 15px;
      text-align: justify;
      text-indent: 10mm;
    }
    ul {
      margin-bottom: 15px;
      padding-left: 25px;
    }
    li {
      margin-bottom: 6px;
      text-align: justify;
    }
    .abstract-box {
      border: 1px solid #CBD5E1;
      padding: 20px;
      background: #FAFAFA;
      margin-top: 30px;
      border-radius: 4px;
      text-align: justify;
    }
    .abstract-title {
      font-weight: bold;
      font-size: 13pt;
      margin-bottom: 10px;
      text-align: center;
      text-transform: uppercase;
      color: #1B1F23;
    }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover-page">
    <div class="logo-container">
      ${logoBase64 ? `<img src="${logoBase64}" alt="Yabatech Logo" />` : ''}
      <div class="institution">Yaba College of Technology</div>
      <div class="department">Department of Computer Science</div>
    </div>
    
    <div class="title-block">
      <div class="document-type">A Seminar Report</div>
      <div class="title">How Young Africans Can Build Global Tech Solutions</div>
    </div>
    
    <div class="meta-block">
      <div class="meta-row"><span class="meta-label">Presented By:</span><span>Olabanji OWooluwa Samson</span></div>
      <div class="meta-row"><span class="meta-label">Matric Number:</span><span>F/HD/24/3410036</span></div>
      <div class="meta-row"><span class="meta-label">Course:</span><span>COM 413: Seminar and Presentation</span></div>
      <div class="meta-row"><span class="meta-label">Supervisor:</span><span>Dr. Olalekan Bello</span></div>
    </div>
    
    <div class="date-block">
      July 2026
    </div>
  </div>

  <!-- Table of Contents and Abstract page -->
  <div class="report-body">
    <h1>Abstract</h1>
    <div class="abstract-box">
      <div class="abstract-title">Executive Summary</div>
      <p>This seminar report explores the strategic frameworks, ecosystems, and talent development pipelines required for young African technologists to build software solutions that scale globally. By examining the current landscape of tech hubs in Lagos, Nairobi, and Cape Town, and highlighting structural barriers such as infrastructure deficit and funding limitations, the report outlines an actionable path forward. Through case studies of global successes like Flutterwave and Paystack, we identify key scalability principles, cloud engineering patterns, and localization-to-globalization strategies. Finally, we propose a strategic collaboration model involving academic institutions like Yaba College of Technology, startup hubs, and government agencies to cultivate a world-class developer ecosystem capable of positioning Africa as a global exporter of technology.</p>
    </div>
    
    <div class="page-break"></div>
`

  // Compile chapters into HTML
  contents.forEach(chapter => {
    html += `<h1>${chapter.title}</h1>\n`
    chapter.parsed.forEach(node => {
      if (node.type === 'heading') {
        if (node.level === 2) html += `<h2>${node.text}</h2>\n`
        else if (node.level === 3) html += `<h3>${node.text}</h3>\n`
        else html += `<h2>${node.text}</h2>\n`
      } else if (node.type === 'bullet') {
        html += `<ul><li>${node.text}</li></ul>\n`
      } else {
        html += `<p>${node.text}</p>\n`
      }
    })
  })

  html += `
  </div>
</body>
</html>`

  const htmlPath = path.join(process.cwd(), 'report.html')
  fs.writeFileSync(htmlPath, html, 'utf8')
  console.log('Saved report.html.')

  // --- PDF Export using Edge ---
  console.log('Generating PDF using Headless Edge...')
  const pdfPath = path.join(process.cwd(), 'report.pdf')
  try {
    const edgeCmd = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless --disable-gpu --print-to-pdf="${pdfPath}" "${htmlPath}"`
    execSync(edgeCmd)
    console.log('Successfully generated report.pdf!')
  } catch (pdfErr) {
    console.error('Failed to generate PDF using Edge:', pdfErr)
  }

  // --- DOCX Export using Docx.js ---
  console.log('Compiling Word Document (.docx)...')
  const docChildren = []

  // Add cover page fields manually
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'YABA COLLEGE OF TECHNOLOGY', bold: true, size: 28, font: 'Arial' })
      ],
      spacing: { before: 400, after: 100 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'DEPARTMENT OF COMPUTER SCIENCE', bold: true, size: 22, color: '555555', font: 'Arial' })
      ],
      spacing: { after: 1200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'A SEMINAR REPORT', bold: true, size: 24, color: '185ABD', font: 'Arial' })
      ],
      spacing: { after: 200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'HOW YOUNG AFRICANS CAN BUILD GLOBAL TECH SOLUTIONS', bold: true, size: 40, font: 'Arial' })
      ],
      spacing: { after: 2000 }
    }),
    new Paragraph({
      children: [
        new TextRun({ text: 'Presented By: ', bold: true, font: 'Arial' }),
        new TextRun({ text: 'Olabanji OWooluwa Samson\n', font: 'Arial' }),
        new TextRun({ text: 'Matric Number: ', bold: true, font: 'Arial' }),
        new TextRun({ text: 'F/HD/24/3410036\n', font: 'Arial' }),
        new TextRun({ text: 'Course: ', bold: true, font: 'Arial' }),
        new TextRun({ text: 'COM 413: Seminar and Presentation\n', font: 'Arial' }),
        new TextRun({ text: 'Supervisor: ', bold: true, font: 'Arial' }),
        new TextRun({ text: 'Dr. Olalekan Bello', font: 'Arial' })
      ],
      spacing: { after: 1500 },
      indent: { left: 1440 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'JULY 2026', bold: true, size: 24, color: '777777', font: 'Arial' })
      ]
    }),
    new Paragraph({ children: [new PageBreak()] })
  )

  // Abstract section
  docChildren.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: 'ABSTRACT', bold: true, font: 'Arial' })],
      spacing: { before: 200, after: 200 }
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: 'This seminar report explores the strategic frameworks, ecosystems, and talent development pipelines required for young African technologists to build software solutions that scale globally. By examining the current landscape of tech hubs in Lagos, Nairobi, and Cape Town, and highlighting structural barriers such as infrastructure deficit and funding limitations, the report outlines an actionable path forward. Through case studies of global successes like Flutterwave and Paystack, we identify key scalability principles, cloud engineering patterns, and localization-to-globalization strategies. Finally, we propose a strategic collaboration model involving academic institutions like Yaba College of Technology, startup hubs, and government agencies to cultivate a world-class developer ecosystem capable of positioning Africa as a global exporter of technology.',
          font: 'Arial'
        })
      ],
      spacing: { after: 240, line: 360 }
    }),
    new Paragraph({ children: [new PageBreak()] })
  )

  // Add generated chapters to DOCX
  contents.forEach(chapter => {
    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: chapter.title.toUpperCase(), bold: true, font: 'Arial' })],
        spacing: { before: 360, after: 180 }
      })
    )

    chapter.parsed.forEach(node => {
      if (node.type === 'heading') {
        const level = node.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
        docChildren.push(
          new Paragraph({
            heading: level,
            children: [new TextRun({ text: node.text, bold: true, font: 'Arial' })],
            spacing: { before: 240, after: 120 }
          })
        )
      } else if (node.type === 'bullet') {
        docChildren.push(
          new Paragraph({
            children: [new TextRun({ text: node.text, font: 'Arial' })],
            bullet: { level: 0 },
            spacing: { after: 120 }
          })
        )
      } else {
        docChildren.push(
          new Paragraph({
            children: [new TextRun({ text: node.text, font: 'Arial' })],
            spacing: { after: 200, line: 360 } // 1.5 line height
          })
        )
      }
    })

    docChildren.push(new Paragraph({ children: [new PageBreak()] }))
  })

  // Remove the final trailing page break
  if (docChildren.length > 0 && docChildren[docChildren.length - 1].children?.[0] instanceof PageBreak) {
    docChildren.pop()
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: docChildren
    }]
  })

  const docxBuffer = await Packer.toBuffer(doc)
  fs.writeFileSync(path.join(process.cwd(), 'report.docx'), docxBuffer)
  console.log('Successfully generated report.docx!')
}

main().catch(err => {
  console.error('Execution Error:', err)
  process.exit(1)
})
