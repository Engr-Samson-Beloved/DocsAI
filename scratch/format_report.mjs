import fs from 'fs'
import path from 'path'
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } from 'docx'
import { execSync } from 'child_process'

// Read the existing generated report.html
const htmlPath = path.join(process.cwd(), 'report.html')
if (!fs.existsSync(htmlPath)) {
  console.error('Error: report.html not found in project root. Please generate it first.')
  process.exit(1)
}

const htmlContent = fs.readFileSync(htmlPath, 'utf8')

// Parse chapters from HTML body
function parseChaptersFromHtml(html) {
  // Find where the report body content starts
  const searchStr = '<div class="report-body">'
  const bodyIndex = html.indexOf(searchStr)
  if (bodyIndex === -1) {
    throw new Error('Could not find report body wrapper in HTML')
  }
  
  const bodyText = html.substring(bodyIndex + searchStr.length)
  
  // Split by <h1> tag
  const h1Parts = bodyText.split('<h1>')
  
  const chapters = []
  
  // Skip the first split part since it contains the Abstract heading/box and pre-content HTML
  h1Parts.forEach((part, index) => {
    if (index === 0) return // Skip abstract page content in main loop (we will define abstract separately)
    
    const h1CloseIndex = part.indexOf('</h1>')
    if (h1CloseIndex === -1) return
    
    const rawTitle = part.substring(0, h1CloseIndex).trim()
    const contentHtml = part.substring(h1CloseIndex + 5).trim()
    
    // Clean content html (remove closing body/html tags if present in last part)
    let cleanContent = contentHtml
    const endBodyIndex = cleanContent.indexOf('</div>')
    if (endBodyIndex !== -1 && index === h1Parts.length - 1) {
      cleanContent = cleanContent.substring(0, endBodyIndex).trim()
    }
    
    // Extract paragraphs and headings
    const nodes = []
    const lineRegex = /<(p|h2|h3|ul|li)[^>]*>([\s\S]*?)<\/\1>/gi
    let match
    
    while ((match = lineRegex.exec(cleanContent)) !== null) {
      const tag = match[1].toLowerCase()
      const innerContent = match[2].trim()
        .replace(/<[^>]+>/g, '') // strip any inline html formatting like strong, em, span
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
      
      if (!innerContent) continue
      
      if (tag === 'h2') {
        nodes.push({ type: 'heading', level: 2, text: innerContent })
      } else if (tag === 'h3') {
        nodes.push({ type: 'heading', level: 3, text: innerContent })
      } else if (tag === 'li') {
        nodes.push({ type: 'bullet', text: innerContent })
      } else if (tag === 'p') {
        nodes.push({ type: 'paragraph', text: innerContent })
      }
    }
    
    chapters.push({
      title: rawTitle,
      nodes: nodes
    })
  })
  
  return chapters
}

async function main() {
  console.log('--- WordPI Structural Restructuring ---')
  console.log('Parsing E:\\DOCU_AI\\report.html...')
  
  const parsedChapters = parseChaptersFromHtml(htmlContent)
  console.log(`Successfully parsed ${parsedChapters.length} chapters from existing HTML.\n`)
  
  // Re-map the chapters into the 4-chapter Yabatech Seminar Report structure:
  // Chapter 1 -> 1. INTRODUCTION
  // Chapters 2 to 6 -> 2. REVIEW OF STRATEGIC FRAMEWORKS FOR GLOBAL TECH SOLUTIONS
  // Chapter 7 -> 3. SUMMARY AND CONCLUSION
  // Chapter 8 -> 4. REFERENCES
  
  const newChapters = [
    {
      title: '1. INTRODUCTION',
      nodes: parsedChapters[0].nodes // Original Chapter 1
    },
    {
      title: '2. REVIEW OF STRATEGIC FRAMEWORKS FOR GLOBAL TECH SOLUTIONS',
      nodes: [
        // Sub-section 2.1: Ecosystem Landscape of African Tech Hubs
        { type: 'heading', level: 2, text: '2.1 Ecosystem Landscape of African Tech Hubs' },
        ...parsedChapters[1].nodes.filter(n => n.level !== 1), // Filter out H1s
        
        // Sub-section 2.2: Engineering Frameworks and Microservices Architectures
        { type: 'heading', level: 2, text: '2.2 Engineering Frameworks and Microservices Architectures' },
        ...parsedChapters[2].nodes.filter(n => n.level !== 1),
        
        // Sub-section 2.3: Case Studies of Flutterwave, Paystack, and Andela
        { type: 'heading', level: 2, text: '2.3 Case Studies of Flutterwave, Paystack, and Andela' },
        ...parsedChapters[3].nodes.filter(n => n.level !== 1),
        
        // Sub-section 2.4: Key Barriers, Opportunities, and Funding Mechanisms
        { type: 'heading', level: 2, text: '2.4 Key Barriers, Opportunities, and Funding Mechanisms' },
        ...parsedChapters[4].nodes.filter(n => n.level !== 1),
        
        // Sub-section 2.5: Proposed Strategic Implementation Model
        { type: 'heading', level: 2, text: '2.5 Proposed Strategic Implementation Model' },
        ...parsedChapters[5].nodes.filter(n => n.level !== 1)
      ]
    },
    {
      title: '3. SUMMARY AND CONCLUSION',
      nodes: parsedChapters[6].nodes // Original Chapter 7
    },
    {
      title: '4. REFERENCES',
      nodes: parsedChapters[7].nodes // Original Chapter 8
    }
  ]

  // Read Yabatech logo base64
  const logoPath = path.join(process.cwd(), 'public', 'yabatech_logo.png')
  let logoBase64 = ''
  if (fs.existsSync(logoPath)) {
    logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
  }

  // --- Compile NEW report.html ---
  console.log('Recompiling report.html with Yabatech strict cover styling...')
  let newHtml = `<!DOCTYPE html>
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
      color: #000000;
      line-height: 1.6;
      font-size: 11pt;
      margin: 0;
      padding: 0;
    }
    .cover-page {
      height: 255mm;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      text-align: center;
      padding: 15mm 0;
      box-sizing: border-box;
      page-break-after: always;
    }
    .logo-container img {
      max-height: 80px;
      object-fit: contain;
    }
    .institution-header {
      font-size: 13pt;
      font-weight: bold;
      color: #000;
      text-transform: uppercase;
      margin-top: 10px;
    }
    .school-header, .dept-header {
      font-size: 11pt;
      font-weight: bold;
      color: #333;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .title-block {
      margin: 30px 0;
      max-width: 90%;
    }
    .title {
      font-size: 16pt;
      font-weight: bold;
      color: #000;
      line-height: 1.5;
      text-transform: uppercase;
    }
    .document-type {
      font-size: 12pt;
      font-weight: bold;
      color: #000;
      margin-top: 15px;
      letter-spacing: 0.05em;
    }
    .presented-block, .by-block, .supervised-block {
      font-size: 11pt;
      color: #111;
      text-transform: uppercase;
      font-weight: bold;
      margin: 10px 0;
      line-height: 1.4;
    }
    .author-name {
      font-size: 12pt;
      font-weight: bold;
      margin-top: 5px;
    }
    .matric-number {
      font-size: 11pt;
      margin-top: 3px;
    }
    .award-block {
      font-size: 10.5pt;
      color: #000;
      text-transform: uppercase;
      text-align: center;
      max-width: 85%;
      margin: 15px auto;
      line-height: 1.5;
      font-weight: bold;
    }
    .date-block {
      font-size: 11pt;
      font-weight: bold;
      color: #000;
      margin-top: 10px;
    }
    
    .report-body {
      padding: 10mm 0;
    }
    .page-break {
      page-break-after: always;
    }
    h1 {
      font-size: 16pt;
      color: #000000;
      margin-top: 35px;
      margin-bottom: 20px;
      page-break-before: always;
      border-bottom: 1.5px solid #000000;
      padding-bottom: 5px;
      text-align: left;
      font-weight: bold;
      text-transform: uppercase;
    }
    h2 {
      font-size: 13pt;
      color: #000000;
      margin-top: 30px;
      margin-bottom: 12px;
      font-weight: bold;
      text-align: left;
    }
    h3 {
      font-size: 11pt;
      color: #000000;
      margin-top: 22px;
      margin-bottom: 8px;
      font-weight: bold;
      text-align: left;
    }
    p {
      margin-bottom: 15px;
      text-align: justify;
      text-indent: 10mm;
      font-size: 11pt;
    }
    ul {
      margin-bottom: 15px;
      padding-left: 25px;
    }
    li {
      margin-bottom: 6px;
      text-align: justify;
      font-size: 11pt;
    }
    .abstract-box {
      border: 1px solid #CBD5E1;
      padding: 24px;
      background: #FAFAFA;
      margin-top: 40px;
      border-radius: 4px;
      text-align: justify;
    }
    .abstract-title {
      font-weight: bold;
      font-size: 13pt;
      margin-bottom: 15px;
      text-align: center;
      text-transform: uppercase;
      color: #000000;
    }
  </style>
</head>
<body>

  <!-- Cover Page -->
  <div class="cover-page">
    <div class="logo-container">
      ${logoBase64 ? `<img src="${logoBase64}" alt="Yabatech Logo" />` : ''}
      <div class="institution-header">Yaba College of Technology, Yaba</div>
      <div class="school-header">School of Technology</div>
      <div class="dept-header">Department of Computer Science</div>
    </div>
    
    <div class="title-block">
      <div class="title">HOW YOUNG AFRICANS CAN BUILD GLOBAL TECH SOLUTIONS</div>
      <div class="document-type">A SEMINAR REPORT</div>
    </div>

    <div class="presented-block">
      <div>Presented To</div>
      <div class="dept-header">The Department of Computer Science</div>
      <div class="school-header">School of Technology</div>
      <div class="institution-header">Yaba College of Technology, Yaba.</div>
    </div>

    <div class="by-block">
      <div>By</div>
      <div class="author-name">Olabanji OWooluwa Samson</div>
      <div class="matric-number">F/HD/24/3410036</div>
    </div>
    
    <div class="award-block">
      A Seminar Report Submitted in Partial Fulfilment of the Requirements for the Award of the Higher National Diploma (HND) in Computer Science
    </div>
    
    <div class="supervised-block">
      Supervised By<br/><br/>
      Dr. Olalekan Bello
    </div>
    
    <div class="date-block">
      2025/2026
    </div>
  </div>

  <!-- Table of Contents Page -->
  <div class="table-of-contents page-break" style="padding: 20mm 0; box-sizing: border-box; display: flex; flex-direction: column; justify-content: flex-start; height: 250mm;">
    <div style="font-size: 16pt; font-weight: bold; text-align: center; margin-bottom: 40px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1.5px solid #000000; padding-bottom: 5px;">Table of Contents</div>
    <div style="width: 90%; margin: 0 auto; font-size: 11pt; line-height: 1.8;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-weight: bold;">
        <span>1. INTRODUCTION</span>
        <span>1</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-weight: bold;">
        <span>2. REVIEW OF STRATEGIC FRAMEWORKS FOR GLOBAL TECH SOLUTIONS</span>
        <span>3</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-left: 20px; margin-bottom: 8px; color: #111;">
        <span>2.1 Ecosystem Landscape of African Tech Hubs</span>
        <span>3</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-left: 20px; margin-bottom: 8px; color: #111;">
        <span>2.2 Engineering Frameworks and Microservices Architectures</span>
        <span>5</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-left: 20px; margin-bottom: 8px; color: #111;">
        <span>2.3 Case Studies of Flutterwave, Paystack, and Andela</span>
        <span>7</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-left: 20px; margin-bottom: 8px; color: #111;">
        <span>2.4 Key Barriers, Opportunities, and Funding Mechanisms</span>
        <span>9</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-left: 20px; margin-bottom: 8px; color: #111;">
        <span>2.5 Proposed Strategic Implementation Model</span>
        <span>11</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 12px; margin-bottom: 12px; font-weight: bold;">
        <span>3. SUMMARY AND CONCLUSION</span>
        <span>14</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 12px; font-weight: bold;">
        <span>4. REFERENCES</span>
        <span>16</span>
      </div>
    </div>
  </div>

  <!-- Abstract Page -->
  <div class="report-body">
    <h1>Abstract</h1>
    <div class="abstract-box">
      <div class="abstract-title">Executive Summary</div>
      <p>This seminar report explores the strategic frameworks, ecosystems, and talent development pipelines required for young African technologists to build software solutions that scale globally. By examining the current landscape of tech hubs in Lagos, Nairobi, and Cape Town, and highlighting structural barriers such as infrastructure deficit and funding limitations, the report outlines an actionable path forward. Through case studies of global successes like Flutterwave and Paystack, we identify key scalability principles, cloud engineering patterns, and localization-to-globalization strategies. Finally, we propose a strategic collaboration model involving academic institutions like Yaba College of Technology, startup hubs, and government agencies to cultivate a world-class developer ecosystem capable of positioning Africa as a global exporter of technology.</p>
    </div>
    
    <div class="page-break"></div>
`

  // Compile restructuring chapters into HTML
  newChapters.forEach(chapter => {
    newHtml += `<h1>${chapter.title}</h1>\n`
    chapter.nodes.forEach(node => {
      if (node.type === 'heading') {
        if (node.level === 2) newHtml += `<h2>${node.text}</h2>\n`
        else if (node.level === 3) newHtml += `<h3>${node.text}</h3>\n`
        else newHtml += `<h2>${node.text}</h2>\n`
      } else if (node.type === 'bullet') {
        newHtml += `<ul><li>${node.text}</li></ul>\n`
      } else {
        newHtml += `<p>${node.text}</p>\n`
      }
    })
  })

  newHtml += `
  </div>
</body>
</html>`

  fs.writeFileSync(htmlPath, newHtml, 'utf8')
  console.log('Restructured and saved report.html.')

  // --- PDF Export using Edge ---
  console.log('Generating PDF using Headless Edge...')
  const pdfPath = path.join(process.cwd(), 'report.pdf')
  try {
    const edgeCmd = `"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --headless --disable-gpu --print-to-pdf="${pdfPath}" "file:///${htmlPath.replace(/\\/g, '/')}"`
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
        new TextRun({ text: 'YABA COLLEGE OF TECHNOLOGY, YABA', bold: true, size: 26, font: 'Arial' })
      ],
      spacing: { before: 200, after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'SCHOOL OF TECHNOLOGY', bold: true, size: 22, color: '333333', font: 'Arial' })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'DEPARTMENT OF COMPUTER SCIENCE', bold: true, size: 22, color: '333333', font: 'Arial' })
      ],
      spacing: { after: 1200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'HOW YOUNG AFRICANS CAN BUILD GLOBAL TECH SOLUTIONS', bold: true, size: 36, font: 'Arial' })
      ],
      spacing: { after: 200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'A SEMINAR REPORT', bold: true, size: 24, font: 'Arial' })
      ],
      spacing: { after: 1200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'PRESENTED TO', bold: true, size: 20, color: '555555', font: 'Arial' })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'THE DEPARTMENT OF COMPUTER SCIENCE', bold: true, size: 22, color: '333333', font: 'Arial' })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'SCHOOL OF TECHNOLOGY', bold: true, size: 22, color: '333333', font: 'Arial' })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'YABA COLLEGE OF TECHNOLOGY, YABA.', bold: true, size: 24, font: 'Arial' })
      ],
      spacing: { after: 1200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'BY', bold: true, size: 20, color: '555555', font: 'Arial' })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'OLABANJI OWOOLUWA SAMSON', bold: true, size: 26, font: 'Arial' })
      ],
      spacing: { after: 80 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'F/HD/24/3410036', bold: true, size: 22, font: 'Arial' })
      ],
      spacing: { after: 1200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'A SEMINAR REPORT SUBMITTED IN PARTIAL FULFILMENT OF THE REQUIREMENTS FOR THE AWARD OF THE HIGHER NATIONAL DIPLOMA (HND) IN COMPUTER SCIENCE', bold: true, size: 20, font: 'Arial' })
      ],
      spacing: { after: 1200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'SUPERVISED BY', bold: true, size: 20, color: '555555', font: 'Arial' })
      ],
      spacing: { after: 200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: 'DR. OLALEKAN BELLO', bold: true, size: 24, font: 'Arial' })
      ],
      spacing: { after: 1200 }
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: '2025/2026', bold: true, size: 24, font: 'Arial' })
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

  // Add restructured chapters to DOCX
  newChapters.forEach(chapter => {
    docChildren.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: chapter.title.toUpperCase(), bold: true, font: 'Arial' })],
        spacing: { before: 360, after: 180 }
      })
    )

    chapter.nodes.forEach(node => {
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

  // Remove final trailing page break
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
