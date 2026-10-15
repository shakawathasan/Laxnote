# LexNote — My AI Law Notebook

A personal, 100% free, privacy-preserving AI notebook for an LLB student to record classroom lectures, create organized law notes, study legal concepts, and manage academic materials. Built with support for **Bangla (বাংলা)**, **English**, and mixed **Banglish** speech and text.

---

## 1. Feature Availability Matrix

| Feature | In-Browser Offline (Zero Install) | Browser Native / Free Open-Source | Optional Local Software |
| :--- | :---: | :---: | :---: |
| **Law Library & Notes Management** | ✅ 100% Offline (IndexedDB) | — | None needed |
| **Bilingual Legal Structuring Engine** | ✅ 100% Offline (Rule-based) | — | Ollama (optional) |
| **Legal Research & FIRAC Briefs** | ✅ 100% Offline | — | None needed |
| **English–Bangla Legal Dictionary** | ✅ 100% Offline (120+ terms) | — | None needed |
| **Ask My Notebook (RAG Search)** | ✅ 100% Offline | — | None needed |
| **PDF Text Extraction** | ✅ 100% Offline (PDF.js) | — | None needed |
| **Export to PDF, DOCX, MD, TXT** | ✅ 100% Offline | — | None needed |
| **Full JSON Data Backup & Restore** | ✅ 100% Offline | — | None needed |
| **Voice Lecture Dictation** | — | ✅ Free Web Speech API (Chrome/Edge) | Vosk / whisper.cpp (offline) |
| **Image & Scanned OCR** | — | ✅ Free Tesseract.js (ben/eng) | None needed |

---

## 2. Core Capabilities

### A. Voice Notes & Dictation
- Dictate lectures directly in **Bangla (`bn-BD`)**, **English (`en-US`)**, or **mixed Banglish**.
- Real-time animated audio visualizer via Web Audio API.
- Audio recording retention: Audio clips are captured in local memory via `MediaRecorder` so you can listen back while proofreading your transcript.
- Uncertainty detection: Words with lower speech recognition confidence are highlighted with soft amber dashed underlines; clicking any highlighted word opens an instant inline correction popup.

### B. AI Note Organizer
- Transforms raw classroom speech or pasted text into structured notes:
  - **Executive Summary & Purpose**
  - **Key Statutory Provisions** (Acts, Sections, Constitutional Articles)
  - **Judicial Precedents & Ratio Decidendi**
  - **Classroom Lecture Breakdown**
  - **Concise, Detailed, or Simple-Language explanations**
- Strictly preserves legal terminology, case names, and citations without hallucination.

### C. Law Library
- Pre-seeded with core LLB subjects:
  - Constitutional Law (সাংবিধানিক আইন)
  - Jurisprudence (আইনশাস্ত্র ও ন্যায়তত্ত্ব)
  - Contract Law (চুক্তি আইন)
  - Tort Law (টর্ট আইন)
  - Muslim Law (মুসলিম ব্যক্তিগত আইন)
  - Labour Law (শ্রম আইন)
  - Land Law (ভূমি ও সম্পত্তি আইন)
  - Banking and Insurance Law (ব্যাংকিং ও বীমা আইন)
- Create custom subjects, filter by semester, chapter, lecture date, and bookmarks.

### D. Document Import & OCR
- Extract text from course handouts, syllabus PDFs, and scanned judicial reports.
- PDF.js client-side parser extracts page-by-page text preserving page numbers (`[Page X]`).
- Tesseract.js client-side OCR for English and Bengali document images.
- One-click "Convert Extracted Text to Law Note".

### E. Ask My Notebook
- Grounded local RAG engine querying your own saved lecture notes and uploaded documents.
- Provides answers with explicit citations: `[Source: Note "...", Para 2]` or `[Source: Document "...", Page 1]`.
- Clearly distinguishes verified information found in your notes from general legal background.

### F. Legal Research Organizer (FIRAC)
- Structured case briefs: **Facts (F)**, **Issues (I)**, **Ruling / Decision (R)**, **Analysis / Reasoning (Ratio Decidendi) (A)**, and **Legal Principle (Obiter Dicta) (C)**.
- Verification status badge (Verified with Official Law Report / Gazette vs. Draft).

### G. English–Bangla Legal Dictionary
- 120+ authentic legal terms with phonetic guides, bilingual definitions, and statutory citations (e.g. *Mens Rea*, *Ratio Decidendi*, *Habeas Corpus*, *Res Judicata*, *Estoppel*, *Void Ab Initio*, *Caveat Emptor*, *Hiba*, *Waqf*, *Cheque Dishonour*).

---

## 3. Optional Local AI & Offline Speech Setup

### Option A: Local Ollama Model (100% Free & Private)
If you wish to augment note summarization with a local open-weight language model:
1. Install [Ollama](https://ollama.ai) on your computer:
   ```bash
   # Linux / macOS
   curl -fsSL https://ollama.com/install.sh | sh
   ```
2. Pull a model (e.g., Llama 3 or Mistral):
   ```bash
   ollama run llama3
   ```
3. In LexNote, go to **Settings & Sync** and set:
   - **Local Ollama Endpoint:** `http://localhost:11434`
   - **Model Name:** `llama3`
   - Click **Test Local Connection**.

*Note: Even without Ollama, LexNote's built-in rule-based legal structuring engine is 100% active and functional out of the box!*

### Option B: Offline Speech Recognition with Vosk / whisper.cpp
For 100% air-gapped environments without browser speech recognition:
1. **Vosk (Bangla & English offline model)**:
   ```bash
   pip install vosk sounddevice
   # Download the free Bangla model from alphacephei.com/vosk/models
   # vosk-model-bn-0.42
   python -m vosk.transcribe lecture.wav
   ```
2. **whisper.cpp**:
   ```bash
   git clone https://github.com/ggerganov/whisper.cpp
   cd whisper.cpp
   make
   ./models/download-ggml-model.sh small
   ./main -m models/ggml-small.bin -f lecture.wav -l bn
   ```
   Paste the resulting transcript directly into LexNote's Voice Notes editor.

---

## 4. Privacy & Data Safety
- All notes, case briefs, audio recordings, and uploaded documents are stored locally in your browser's **IndexedDB**.
- Use **Settings & Sync > Download Full Backup (JSON)** to export your entire database at any time.
- No personal notes or voice recordings are ever sent to external cloud servers.
