markdown_content = """# Implementation Plan: Client-Side Document AI

## 1. Project Goal & Vision
To build a highly responsive, zero-cost, AI-powered document editor tailored specifically for student workflows. The platform will function entirely in the browser, eliminating the need for paid server infrastructure. It will combine a rich-text editing canvas with a contextual AI sidebar capable of generating project topics, drafting content, and structurally formatting documents. The system will natively handle client-side conversions between DOCX, PDF, and PPTX formats.

Drawing architectural inspiration from fast-loading educational platforms and student networks, the priority is a frictionless user experience with zero latency in document interaction.

---

## 2. Technology Stack & Libraries

### Frontend Framework & UI
* **Core:** Next.js (React) - Chosen for rapid prototyping, seamless client-side routing, and easy deployment.
* **Styling:** Tailwind CSS + Framer Motion (for smooth sidebar transitions and canvas interactions, ensuring the UI/UX remains polished and visually engaging).

### Document Engine (The Canvas)
* **Editor Core:** Tiptap (Headless, built on ProseMirror).
* **Extensions:** * `@tiptap/extension-font-family`
    * `@tiptap/extension-text-align`
    * Custom extensions for line-spacing and structural paragraph chunking.

### Artificial Intelligence Layer
* **Primary API:** Google Gemini 1.5 Flash (Free Tier) via REST/SSE.
* **Integration Method:** Direct client-side fetch utilizing Server-Sent Events (SSE) for real-time text streaming into the AI sidebar.

### Document Conversion Pipeline (100% Client-Side)
* **Word (Export):** `docx` (Generates standard .docx files from parsed JSON text).
* **Word (Import):** `mammoth.js` (Renders uploaded .docx files into HTML for Tiptap).
* **PDF (Export):** `html2pdf.js` (Captures the styled DOM elements directly to PDF).
* **PDF (Import/Parsing):** `pdf.js` (Extracts raw text strings from uploaded PDFs).
* **PowerPoint (Export):** `PptxGenJS` (Compiles slide decks dynamically from heading structures).

---

## 3. System Architecture & Data Flow

### The "Zero-Server" Paradigm
1.  **State Management:** Document state lives entirely within the React component tree and Tiptap's JSON model. No databases are required for core functionality (local storage can be used for session drafts).
2.  **AI Execution:** When a user requests an AI edit, the frontend isolates the specific JSON node (paragraph/section), packages it with the prompt, and sends it directly to the Gemini API. 
3.  **Surgical Rendering:** The streamed AI response updates only the targeted node via `editor.commands.insertContentAt()`, preventing cursor jumping and preserving the rest of the document's typography and structure.

---

## 4. Phased Execution Plan

### Phase 1: Foundation & Typography
* Initialize Next.js project with Tailwind CSS.
* Implement the Tiptap editor canvas.
* Bind UI formatting toolbars (bold, justify, font selection, line-height).
* **Milestone:** A functioning, highly polished rich-text editor that looks and feels like a modern word processor.

### Phase 2: The AI Sidebar & Structural Chunking
* Build the floating/collapsible sidebar component.
* Implement the frontend JSON node extraction logic (chunking by headings/paragraphs).
* Connect the Gemini Free API using a secure client-side fetch (with environment variable protection for development, or a lightweight Edge Function proxy purely for key obfuscation on deployment).
* Implement SSE streaming to render AI text live in the sidebar, with an "Insert" button to inject it into the Tiptap canvas.
* **Milestone:** AI can read document context and write directly into the editor without breaking formatting.

### Phase 3: The Conversion Engine
* Integrate `html2pdf.js` for one-click PDF generation mapped to the canvas styling.
* Build the `.docx` export utility mapping Tiptap JSON to `docx` paragraph objects.
* Implement the Presentation generator: Write a script that loops through the Tiptap JSON, treating every `<h1>` or `<h2>` as a new slide using `PptxGenJS`.
* **Milestone:** Full import/export capabilities functioning entirely in the browser memory.

### Phase 4: Deployment & Polish
* Deploy the static/edge application via Vercel (Free Tier).
* Optimize bundle size by dynamically importing heavy conversion libraries (`pdf.js`, `PptxGenJS`) only when the user clicks the export buttons.
"""

with open("Document_AI_Implementation_Plan.md", "w", encoding="utf-8") as f:
    f.write(markdown_content)

print("File created successfully.")