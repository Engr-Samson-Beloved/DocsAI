# WordPI: Client-Side Academic Document AI

WordPI is a zero-latency, high-fidelity client-side word processor and AI-powered document compiler tailored specifically for academic researchers and students. By eliminating paid server databases, it utilizes a browser-based **Zero-Server Architecture** running Tiptap (ProseMirror) on the frontend, combined with Gemini streaming API routes on Next.js Edge to provide real-time writing assistance, reference document ingestion, and formatting styling templates.

---

## 1. How It Works (System Architecture & Pipeline)

WordPI functions entirely within your browser to parse, format, paginate, and generate document files. The diagram below illustrates the data flow:

```mermaid
graph TD
    User([User input / File upload]) --> Ingest[Client-side mammoth.js / pdf.js parsing]
    Ingest --> DB[(IndexedDB Storage)]
    DB --> Context[Project Context Window]
    Context --> API[/api/generate API Route]
    API --> Gemini[Google Gemini Edge Streaming]
    Gemini --> Editor[Tiptap Page-Flow Editor Canvas]
    Editor --> Format[Apply Style Templates: Arial / Playfair / Line Spacing]
    Editor --> Paginate[Dynamic runPagination Engine 931px boundary]
    Paginate --> Export[Export Pipeline: Word docx / PDF html2pdf / HTML / txt]
```

### Core Architecture Components
1. **The Zero-Server Editor Canvas**: Built on top of Tiptap (a headless ProseMirror wrapper), the document state is kept locally in memory as structured JSON trees.
2. **Edge API Route (`/api/generate`)**: Connects directly to Google Gemini models (with prioritized failover support from `gemini-2.5-flash` down to `gemini-1.5-flash`). By executing on the Edge, streaming response times are reduced to milliseconds.
3. **Reference Ingestion Engine**: Utilizes client-side PDF parsing (`pdf.js`) and Word document extraction (`mammoth.js`) to extract raw text buffers from uploaded reference materials. These are stored locally in the browser's IndexedDB database, preventing massive prompt tokens on every edit.
4. **Formatting Stylesheet Extension**: Custom font and line-height extensions dynamically select layouts depending on the active document type (e.g. APA styles call for double-spaced Serif layouts, whereas proposals apply single or 1.5-spaced Sans-Serif).

---

## 2. Key Technical Questions Answered

### Q1. How Many Pages Can WordPI Generate?
* **Unlimited Canvas Flow**: WordPI has no rigid or artificial page limit. You can write, generate, or import documents spanning **dozens or hundreds of pages** entirely in browser memory.
* **The `931px` Pagination Boundary**: WordPI features a custom, height-based dynamic page-flow engine (`runPagination`). It maps layout margins to standard A4/Letter size dimensions, enforcing a safe content area height limit of exactly **`931px`**.
* **Flow & Splitting Mechanics**: 
  - **Overflow Splitting**: As you type or when the AI generates content, if the height of elements in `<div class="page-content">` exceeds `931px`, the engine automatically splits the document nodes and creates a new page block (`<div data-type="page">`).
  - **Underflow Join**: If text is deleted and a page has empty space, the engine measures the first child of the *next* page. If it fits, it pulls it backward into the current page to maintain tight vertical alignment.
* **One-Click Generation Limit**: In a single generation pass, the "One-Click Blueprint Generator" instructs the AI model to stream a complete, structured academic blueprint containing **at least 1,500 words** of rich content divided across 4 to 5 core chapters, automatically generating and paginating into **5 to 8 structured pages** instantly.

### Q2. How Humanized Is the Writing & Free from Plagiarism?
WordPI does not function as a content spinner or simple paraphraser. It enforces a strict **Knowledge Synthesis Engine** built into its LLM system instruction layers to prevent plagiarism and match human academic quality:

* **Fact Comparison vs. Spinning**: When reference sources (journals, book chapters, PDFs) are ingested, WordPI compares findings, methodologies, and limitations across papers, highlighting agreements and contradictions instead of spinning single source phrases.
* **Avoidance of "AI Buzzwords"**: The generation prompt bans generic AI indicators, robotic transitions, and repetitive boilerplate clauses (e.g., eliminating overuse of *furthermore*, *moreover*, *consequently*, *in conclusion*, *delve*, and *testament*).
* **Sentence Length Variation**: Generates text using a hybrid structure of short, direct statements paired with complex, multi-clause academic sentences.
* **Academic Level Calibration**: Tailors complexity, vocabulary, and depth to four distinct student profiles:
  - `High School`: Simple, informative, and direct.
  - `Undergraduate`: Clear, structured, and academic.
  - `Master's`: Authoritative, comprehensive, and highly analytical.
  - `Ph.D. / Researcher`: Highly technical, deeply analytical, original, and scholarly.
* **Tone Configuration**: Guides style using custom modes: **Analytical**, **Scholarly/Formal**, **Critical/Evaluative**, **Objective**, and **Persuasive**.
* **Citation Integration**: Automatically inserts formatted parenthetical citations (APA, IEEE, MLA) linked directly to the facts extracted from your ingested sources.

### Q3. How Formatted Is the Output?
WordPI outputs standard, semantic HTML nodes (`<h1>`, `<h2>`, `<h3>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<blockquote>`) wrapped inside structured Page tags. The formatting settings change dynamically based on the **Document Type**:

| Document Type | Associated Layout Style | Typography | Line Spacing | Standard Spacing Rules |
| :--- | :--- | :--- | :--- | :--- |
| **Seminar Report** | Modern Academic Standard | Playfair / Times New Roman | `2.0` (Double-spaced) | Double margins, clean chapter divisions |
| **Research Proposal** | Proposal Layout | Arial (Sans-Serif) | `1.5` | Section-level index tags |
| **Graduation Thesis** | Standard Thesis Print | Arial (Sans-Serif) | `1.5` | Chapter breaks on new page blocks |
| **Custom Outline** | Flexible Structure | Default Serif/Sans | `1.5` | Adapts to user outline inputs |

All formats maintain running header margins, dynamic footers, automated page numbering, and real-time document outline listings that update as you type.

---

## 3. What Problems Has WordPI Solved?

1. **The "Blank Slate" Writer's Block**: Provides researchers with structured drafts based on their topic, selected tone, and reference journals with a single click.
2. **Generic, AI-Generated Academic Prose**: Prevents typical ChatGPT-style boilerplate from making documents look AI-generated by enforcing specific academic level adjustments and sentence variation rules.
3. **Plagiarism Scanners**: By writing synthesized literature reviews and methodologies referencing actual uploaded source files rather than generating random text, the content passes copy-detection checks.
4. **Manual Spacing & Font Management**: Auto-applies standard font sizes, line heights, and margins dynamically based on the paper classification.
5. **Touchpad & Wheel Scale Conflicts**: Overrides native canvas scrolling glitches using an event interceptor so zooming and scrolling through simulated print pages works smoothly on touchpads.

---

## 4. User Guide & Core Features

### Running the Project Locally
To run the Next.js developer environment on your local system:
```bash
# Install package dependencies
npm install

# Create environment config
cp .env.example .env.local
# Add your GEMINI_API_KEY inside the .env.local file

# Start the dev server
npm run dev
```

### Document Creation & Generation Workflow

#### Step 1: Create a Document Template
Choose a document type from the **Template Gallery** on the dashboard (e.g. *Seminar Report*, *Research Proposal*, *Graduation Thesis*). This initializes the editor canvas and auto-applies the required document formatting (Arial 1.5, Playfair 2.0, etc.).

#### Step 2: Configure Workspace Settings
In the **Assistant Sidebar**:
1. **Academic Settings**: Adjust the target *Academic Level* (e.g. Master's) and the *Academic Tone* (e.g. Scholarly/Formal).
2. **Project Context**: Upload or drag-and-drop reference papers/journals (PDF/Docx) to ingest them as context.

#### Step 3: Run the One-Click Generator
Click **"Generate Full Blueprint"** in the top header toolbar or at the top of the **One-Click Prompt Presets** in the sidebar. This opens a configuration popup:
- Confirm your **Seminar Topic**, **Document Type**, **Academic Level**, and **Tone**.
- Review your **Ingested Reference Files**.
- Click **"Generate Full Document"**.

WordPI will automatically stream the content, paginate it into A4 print pages, and write the draft to your canvas in real-time.

#### Step 4: Refine and Export
- Select any text block on the editor canvas to trigger AI sidebar presets (like *Fix Grammar*, *Summarize*, or *Make Concise*).
- Click **Export** in the top right to download your completed paper in Word (`.docx`), PDF (`.pdf`), Web Page (`.html`), or Plain Text (`.txt`).
