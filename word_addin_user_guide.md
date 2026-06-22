# WordPI MS Word AI Copilot Add-in: Installation & User Guide

## Introduction
The WordPI MS Word Add-in brings the full context-aware academic AI writing assistant directly inside Microsoft Word desktop and web editions. It allows users to:
1. Highlight paragraphs in a Word document and prompt the AI to rewrite, expand, or format them.
2. Draft new sections or thesis blueprints and insert them at the cursor position with a single click.

---

## 🛠️ Step 1: Serving the Add-in Locally (Development Setup)
Since modern Office Add-ins run inside an embedded web container, Word must load the HTML content over HTTPS.
1. Make sure your local project server is running (e.g. Next.js server).
   If Next.js is running locally, it defaults to port `3000`.
2. **Crucial HTTPS requirement**: MS Word requires HTTPS for taskpane add-ins. For development, you can use standard localhost SSL tools (like `mkcert`) or serve the files using a simple local proxy.
   > [!TIP]
   > If you do not have SSL configured locally, you can use a quick tunnel tool like `ngrok` to map your local port `3000` to a secure public HTTPS URL (e.g., `ngrok http 3000`). If you do this, make sure to update the URLs in the manifest file ([`wordpi_word_addin_manifest.xml`](file:///E:/DOCU_AI/wordpi_word_addin_manifest.xml)) to use the ngrok HTTPS domain instead of `https://localhost:3000`.

---

## 💻 Step 2: Sideloading the Add-in in MS Word

### Method A: Word for Windows (Desktop)
1. **Share the manifest folder**:
   - Create a folder on your system and place [`wordpi_word_addin_manifest.xml`](file:///E:/DOCU_AI/wordpi_word_addin_manifest.xml) inside it.
   - Right-click the folder -> **Properties** -> **Sharing** -> **Share**.
   - Add yourself, click **Share**, and copy the **Network Path** (e.g., `\\PC-NAME\Folder`).
2. **Add Trust Center catalog in MS Word**:
   - Open Microsoft Word. Open a blank document.
   - Click **File** -> **Options** -> **Trust Center** -> **Trust Center Settings** -> **Trusted Add-in Catalogs**.
   - In the **Catalog URL** box, paste the copied Network Path.
   - Click **Add Catalog**. Check the **Show in Menu** box.
   - Click **OK**, and restart MS Word.
3. **Insert the Add-in**:
   - Go to **Developer** or **Insert** tab -> **Add-ins** -> **My Add-ins** -> **Shared Folder**.
   - Select **WordPI AI Copilot** and click **Add**. The taskpane will open on the right!

### Method B: Word for the Web (Office Online)
1. Go to [Office.com](https://office.com) and open a document in Word Online.
2. Click the **Insert** tab -> **Add-ins**.
3. Under the Add-ins panel, click **Upload My Add-in** (or **Manage My Add-ins** -> **Upload My Add-in**).
4. Browse and select your [`wordpi_word_addin_manifest.xml`](file:///E:/DOCU_AI/wordpi_word_addin_manifest.xml) file.
5. Click **Upload**. The WordPI sidebar will appear on the right side of the screen.

---

## 🚀 Step 3: How to Use the Add-in
1. **Interactive Chat**: Type any query in the input area at the bottom of the sidebar (e.g. *"draft an introduction on serverless browser privacy"*), and click **Ask**.
2. **Document Context**: If you highlight text in your Word document before clicking **Ask**, the Add-in automatically captures the selected text as context. The AI replies with suggestions tailored specifically to that paragraph.
3. **One-Click Insert**:
   - Click **Insert after cursor** inside any AI message block to write the text straight into your document at the current caret spot.
   - Click **Replace Selection** (visible when you had highlighted text) to surgically replace the highlighted Word text with the AI's refined output.

---

## 🔍 Step 4: Troubleshooting & Diagnostics

| Symptoms | Cause | Solution |
| :--- | :--- | :--- |
| **"Add-in Error: We couldn't connect..."** or blank taskpane | The HTTPS dev server is offline or the SSL certificate is untrusted. | 1. Ensure your Next.js server is running.<br>2. Visit `https://localhost:3000/wordpi_word_addin.html` in your browser and click "Proceed/Accept Certificate" to bypass local SSL alerts. |
| **"Cannot read selected text"** | Selection API timing lag or missing manifest permissions. | Verify that `<Permissions>ReadWriteDocument</Permissions>` is present in the manifest.xml. |
| **Add-in doesn't appear in shared folder** | Trust Center configuration caching. | 1. Clear Add-in Cache: File -> Options -> Trust Center -> Settings -> Add-ins -> check "Start next time with cached cleared".<br>2. Restart MS Word. |
