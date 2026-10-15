/**
 * LexNote — My AI Law Notebook
 * Main Application Orchestrator (Modular Vanilla ES6)
 */

import {
  getNotes,
  getNote,
  saveNote,
  deleteNote,
  getSubjects,
  saveSubject,
  deleteSubject,
  getDocuments,
  saveDocument,
  deleteDocument,
  getResearchItems,
  saveResearchItem,
  deleteResearchItem,
  getSetting,
  saveSetting,
  seedInitialDataIfNeeded,
  exportAllData,
  importAllData
} from './db.js';

import { organizeLegalNote, queryMyNotebook, extractLegalEntities } from './ai-engine.js';
import { SpeechRecorder } from './speech.js';
import { validateUploadedFile, extractTextFromFile } from './ocr-pdf.js';
import { exportNoteAsText, exportNoteAsMarkdown, exportNoteAsDocx, printNoteAsPdf } from './exporter.js';
import { LEGAL_DICTIONARY, searchDictionary } from './dictionary.js';
import { showToast, openModal, closeModal, formatFriendlyDate, escape } from './ui.js';
import {
  markdownToNotionHtml,
  notionHtmlToMarkdown,
  NOTION_SLASH_COMMANDS,
  insertBlockHtml,
  PageSearchEngine
} from './notion-editor.js';

// Application State
const state = {
  currentView: 'dashboard',
  notes: [],
  subjects: [],
  documents: [],
  research: [],
  activeNoteId: null,
  activeNoteSplitMode: 'rich', // 'rich' | 'markdown' | 'raw' | 'split'
  speechRecorder: null,
  speechLang: 'bn-BD',
  outputLang: 'bilingual',
  aiMode: 'detailed',
  theme: 'light',
  localAiUrl: 'http://localhost:11434',
  localAiModel: 'llama3',
  dictionaryFilter: 'all',
  autosaveTimer: null,
  lastRecordedAudioUrl: null
};

// Document Elements
const els = {
  app: document.getElementById('app'),
  loader: document.getElementById('initial-loader'),
  pageHeading: document.getElementById('page-heading'),
  navNotesCount: document.getElementById('nav-notes-count'),
  sidebarSubjectsList: document.getElementById('sidebar-subjects-list'),
  globalSearchInput: document.getElementById('global-search-input'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeIconSun: document.getElementById('theme-icon-sun'),
  themeIconMoon: document.getElementById('theme-icon-moon'),
  mobileMenuToggle: document.getElementById('mobile-menu-toggle'),
  views: {
    dashboard: document.getElementById('view-dashboard'),
    library: document.getElementById('view-library'),
    editor: document.getElementById('view-note-editor'),
    voice: document.getElementById('view-voice'),
    documents: document.getElementById('view-documents'),
    ask: document.getElementById('view-ask'),
    research: document.getElementById('view-research'),
    dictionary: document.getElementById('view-dictionary'),
    settings: document.getElementById('view-settings')
  }
};

/**
 * Initialize LexNote
 */
async function initApp() {
  try {
    // 1. Seed default subjects and sample LLB notes
    await seedInitialDataIfNeeded();

    // 2. Load stored state
    await refreshStateData();

    // 3. Load user settings
    const savedTheme = await getSetting('theme', 'light');
    setTheme(savedTheme);

    const savedSpeechLang = await getSetting('speechLang', 'bn-BD');
    state.speechLang = savedSpeechLang;

    const savedAiUrl = await getSetting('localAiUrl', 'http://localhost:11434');
    state.localAiUrl = savedAiUrl;

    const savedAiModel = await getSetting('localAiModel', 'llama3');
    state.localAiModel = savedAiModel;

    // 4. Setup Speech Recorder instance
    setupSpeechRecorder();

    // 5. Setup Event Listeners & Router
    setupEventListeners();

    // 6. Navigate to initial view based on hash or dashboard
    const initialView = window.location.hash.replace('#', '') || 'dashboard';
    switchView(initialView in els.views ? initialView : 'dashboard');

    // 7. Hide loader
    if (els.loader) {
      els.loader.classList.add('opacity-0');
      setTimeout(() => els.loader.remove(), 350);
    }
  } catch (err) {
    console.error('LexNote initialization error:', err);
    if (els.loader) {
      els.loader.innerHTML = `
        <div class="p-6 bg-paper border border-rule rounded-xl max-w-md text-center">
          <h2 class="font-serif text-lg font-bold text-rose-800 mb-2">Notebook Initialization Warning</h2>
          <p class="text-xs text-secondary mb-4">${escape(err.message)}</p>
          <button onclick="location.reload()" class="px-4 py-2 bg-forest text-white rounded-md text-xs font-medium">Reload LexNote</button>
        </div>
      `;
    }
  }
}

async function refreshStateData() {
  const [notes, subjects, documents, research] = await Promise.all([
    getNotes(),
    getSubjects(),
    getDocuments(),
    getResearchItems()
  ]);

  state.notes = notes.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  state.subjects = subjects;
  state.documents = documents.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  state.research = research.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

  // Update counts
  if (els.navNotesCount) {
    els.navNotesCount.textContent = state.notes.length;
  }

  renderSidebarSubjects();
}

function setTheme(theme) {
  state.theme = theme;
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
    if (els.themeIconSun) els.themeIconSun.classList.remove('hidden');
    if (els.themeIconMoon) els.themeIconMoon.classList.add('hidden');
  } else {
    document.documentElement.classList.remove('dark');
    if (els.themeIconSun) els.themeIconSun.classList.add('hidden');
    if (els.themeIconMoon) els.themeIconMoon.classList.remove('hidden');
  }
  saveSetting('theme', theme);
}

function renderSidebarSubjects() {
  if (!els.sidebarSubjectsList) return;
  els.sidebarSubjectsList.innerHTML = state.subjects.map(s => `
    <button data-subject-id="${s.id}" class="subject-filter-btn w-full text-left px-2 py-1 rounded hover:bg-paper/70 flex items-center justify-between text-[11px] truncate transition-colors">
      <span class="truncate">${escape(s.name)}</span>
      <span class="font-mono text-[9px] text-secondary opacity-70">${state.notes.filter(n => n.subjectId === s.id).length}</span>
    </button>
  `).join('');

  els.sidebarSubjectsList.querySelectorAll('.subject-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subId = btn.dataset.subjectId;
      switchView('library', { filterSubjectId: subId });
    });
  });
}

/**
 * View Router
 */
export function switchView(viewName, params = {}) {
  // Update state
  state.currentView = viewName;
  window.location.hash = viewName;

  // Toggle active class on nav links
  document.querySelectorAll('.nav-item, .mobile-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewName);
  });

  // Hide all view panels
  Object.values(els.views).forEach(panel => {
    if (panel) panel.classList.add('hidden');
  });

  // Show target view panel
  const targetPanel = els.views[viewName] || els.views.dashboard;
  if (targetPanel) {
    targetPanel.classList.remove('hidden');
  }

  // Update Top Bar Heading
  const titles = {
    dashboard: 'LexNote — Law Notebook',
    library: 'Law Library & Curriculum',
    editor: 'Law Notebook Editor',
    voice: 'Voice Lecture & Dictation Studio',
    documents: 'Document Import & OCR',
    ask: 'Ask My Notebook (RAG Search)',
    research: 'Legal Research & FIRAC Case Briefs',
    dictionary: 'English–Bangla Legal Terminology',
    settings: 'Notebook Settings & Offline Sync'
  };
  if (els.pageHeading) {
    els.pageHeading.textContent = titles[viewName] || 'LexNote';
  }

  // Render view-specific content
  switch (viewName) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'library':
      renderLibrary(params.filterSubjectId);
      break;
    case 'editor':
      renderEditor(params.noteId || state.activeNoteId);
      break;
    case 'voice':
      renderVoiceStudio();
      break;
    case 'documents':
      renderDocuments();
      break;
    case 'ask':
      renderAskMyNotebook(params.initialQuery);
      break;
    case 'research':
      renderResearch();
      break;
    case 'dictionary':
      renderDictionary();
      break;
    case 'settings':
      renderSettings();
      break;
  }
}

/**
 * View 1: Dashboard
 */
function renderDashboard() {
  const container = els.views.dashboard;
  const recentNotes = state.notes.slice(0, 5);

  container.innerHTML = `
    <div class="max-w-6xl mx-auto space-y-8">
      <!-- Welcome Header with Academic Focus -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-rule">
        <div>
          <h1 class="font-serif text-2xl sm:text-3xl font-bold text-forest">Welcome to LexNote</h1>
          <p class="text-sm text-secondary mt-1">Your offline-first personal law repository for lectures, case analysis, and statutory research.</p>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <button id="dash-new-note" class="flex items-center gap-2 px-4 py-2 bg-forest text-white text-xs font-semibold rounded-lg hover:bg-forest/90 transition-all shadow-sm">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>Create Law Note</span>
          </button>
          <button id="dash-quick-record" class="flex items-center gap-2 px-4 py-2 border border-rule bg-paper text-primary text-xs font-semibold rounded-lg hover:bg-canvas transition-all">
            <svg class="w-4 h-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
            <span>Dictate Lecture</span>
          </button>
        </div>
      </div>

      <!-- Quantitative Metric Cards (Tabular figures, unboxed metadata) -->
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div class="p-4 bg-paper border border-rule rounded-xl">
          <div class="text-xs text-secondary font-medium">Total Law Notes</div>
          <div class="font-mono text-2xl font-bold text-forest mt-1 tabular-nums">${state.notes.length}</div>
          <div class="text-[11px] text-secondary mt-1">Across all semesters</div>
        </div>
        <div class="p-4 bg-paper border border-rule rounded-xl">
          <div class="text-xs text-secondary font-medium">Curriculum Subjects</div>
          <div class="font-mono text-2xl font-bold text-forest mt-1 tabular-nums">${state.subjects.length}</div>
          <div class="text-[11px] text-secondary mt-1">Bilingual categories</div>
        </div>
        <div class="p-4 bg-paper border border-rule rounded-xl">
          <div class="text-xs text-secondary font-medium">FIRAC Case Briefs</div>
          <div class="font-mono text-2xl font-bold text-forest mt-1 tabular-nums">${state.research.length}</div>
          <div class="text-[11px] text-secondary mt-1">Legal ratio & precedents</div>
        </div>
        <div class="p-4 bg-paper border border-rule rounded-xl">
          <div class="text-xs text-secondary font-medium">Documents & OCR</div>
          <div class="font-mono text-2xl font-bold text-forest mt-1 tabular-nums">${state.documents.length}</div>
          <div class="text-[11px] text-secondary mt-1">Extracted PDFs & scans</div>
        </div>
      </div>

      <!-- Main 2-Column Section: Recent Notes & Curriculum Subjects -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <!-- Recent Notes Column (2 Cols) -->
        <div class="lg:col-span-2 space-y-4">
          <div class="flex items-center justify-between">
            <h2 class="font-serif text-lg font-bold text-forest">Recent Lecture Notes</h2>
            <button id="dash-view-all-notes" class="text-xs text-forest hover:underline font-medium">View all library notes &rarr;</button>
          </div>

          <div class="space-y-3">
            ${recentNotes.length === 0 ? `
              <div class="p-8 text-center bg-paper border border-rule rounded-xl">
                <p class="text-sm text-secondary">No notes created yet. Click "Create Law Note" or record your first lecture.</p>
              </div>
            ` : recentNotes.map(note => {
              const sub = state.subjects.find(s => s.id === note.subjectId);
              return `
                <div data-note-id="${note.id}" class="recent-note-card p-4 bg-paper hover:bg-card-hover border border-rule rounded-xl cursor-pointer transition-all">
                  <div class="flex items-start justify-between gap-4">
                    <div class="space-y-1">
                      <h3 class="font-serif text-base font-semibold text-primary hover:text-forest transition-colors">${escape(note.title)}</h3>
                      <!-- Unboxed metadata with typographic separators -->
                      <div class="text-xs text-secondary flex items-center flex-wrap gap-1">
                        <span>${escape(sub ? sub.name : 'General Law')}</span>
                        <span class="meta-sep"></span>
                        <span>${escape(note.lectureNo || 'Lecture')}</span>
                        <span class="meta-sep"></span>
                        <span>${formatFriendlyDate(note.lectureDate || note.createdAt)}</span>
                        ${note.audioDuration ? `<span class="meta-sep"></span><span class="font-mono">${escape(note.audioDuration)} audio</span>` : ''}
                      </div>
                    </div>
                    ${note.bookmarked ? `
                      <span title="Bookmarked" class="text-champagne shrink-0">
                        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                      </span>
                    ` : ''}
                  </div>
                  <p class="text-xs text-secondary mt-2 line-clamp-2">${escape(note.summary || note.structuredNote || note.rawTranscript)}</p>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Subjects & Fast Tools Column (1 Col) -->
        <div class="space-y-6">
          <div class="p-5 bg-paper border border-rule rounded-xl space-y-4">
            <h2 class="font-serif text-base font-bold text-forest">Core Subjects</h2>
            <div class="space-y-2">
              ${state.subjects.slice(0, 6).map(sub => `
                <button data-subject-id="${sub.id}" class="dash-subject-row w-full flex items-center justify-between p-2 rounded-lg hover:bg-canvas text-left transition-colors border border-transparent hover:border-rule">
                  <div>
                    <div class="text-xs font-semibold text-primary">${escape(sub.name)}</div>
                    <div class="text-[10px] text-secondary">${escape(sub.nameBn)}</div>
                  </div>
                  <span class="font-mono text-xs text-secondary tabular-nums">
                    ${state.notes.filter(n => n.subjectId === sub.id).length}
                  </span>
                </button>
              `).join('')}
            </div>
          </div>

          <!-- Legal Term of the Day Widget -->
          <div class="p-5 bg-citation border border-rule rounded-xl space-y-2">
            <div class="text-[11px] font-semibold text-forest uppercase tracking-wider">Legal Dictionary Spotlight</div>
            <div class="font-serif text-base font-bold text-primary">Ratio Decidendi</div>
            <div class="text-xs text-forest font-bangla font-medium">রায়ের মূল আইনি ভিত্তি বা নজির</div>
            <p class="text-xs text-secondary mt-1">The underlying legal principle upon which a court bases its binding decision (Bangladesh Constitution Art. 111).</p>
            <button id="dash-open-dict" class="text-xs text-forest font-medium hover:underline pt-1 inline-block">Search 120+ legal terms &rarr;</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach Dashboard Handlers
  container.querySelector('#dash-new-note').addEventListener('click', () => createNewNote());
  container.querySelector('#dash-quick-record').addEventListener('click', () => switchView('voice'));
  container.querySelector('#dash-view-all-notes').addEventListener('click', () => switchView('library'));
  container.querySelector('#dash-open-dict').addEventListener('click', () => switchView('dictionary'));

  container.querySelectorAll('.recent-note-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.noteId;
      switchView('editor', { noteId: id });
    });
  });

  container.querySelectorAll('.dash-subject-row').forEach(row => {
    row.addEventListener('click', () => {
      const id = row.dataset.subjectId;
      switchView('library', { filterSubjectId: id });
    });
  });
}

/**
 * View 2: Law Library
 */
function renderLibrary(selectedSubjectId = 'all') {
  const container = els.views.library;
  let activeFilterSub = selectedSubjectId || 'all';
  let searchQuery = '';
  let onlyBookmarked = false;

  const renderContent = () => {
    const filtered = state.notes.filter(n => {
      if (activeFilterSub !== 'all' && n.subjectId !== activeFilterSub) return false;
      if (onlyBookmarked && !n.bookmarked) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = (n.title || '').toLowerCase().includes(q);
        const matchesContent = (n.structuredNote || '').toLowerCase().includes(q) || (n.rawTranscript || '').toLowerCase().includes(q);
        const matchesTags = (n.tags || []).some(t => t.toLowerCase().includes(q));
        if (!matchesTitle && !matchesContent && !matchesTags) return false;
      }
      return true;
    });

    container.innerHTML = `
      <div class="max-w-6xl mx-auto space-y-6">
        <!-- Header & Library Controls -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-rule">
          <div>
            <h1 class="font-serif text-2xl font-bold text-forest">Law Library</h1>
            <p class="text-xs text-secondary mt-0.5">Organize course materials by semester, subject, chapter, and lecture.</p>
          </div>
          <button id="lib-new-note" class="flex items-center gap-2 px-3.5 py-2 bg-forest text-white text-xs font-medium rounded-lg hover:bg-forest/90 shadow-sm transition-colors self-start sm:self-auto">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>New Note</span>
          </button>
        </div>

        <!-- Filter Bar & Search -->
        <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <!-- Subject Select Dropdown -->
          <div class="flex items-center gap-2 flex-wrap">
            <select id="lib-subject-select" class="px-3 py-1.5 text-xs bg-paper border border-rule rounded-md text-primary focus:outline-none focus:border-forest">
              <option value="all" ${activeFilterSub === 'all' ? 'selected' : ''}>All Subjects (${state.notes.length})</option>
              ${state.subjects.map(s => `
                <option value="${s.id}" ${activeFilterSub === s.id ? 'selected' : ''}>
                  ${escape(s.name)} (${state.notes.filter(n => n.subjectId === s.id).length})
                </option>
              `).join('')}
            </select>

            <button id="lib-bookmark-toggle" class="px-3 py-1.5 text-xs font-medium rounded-md border transition-colors flex items-center gap-1.5 ${
              onlyBookmarked ? 'bg-champagne/20 border-champagne text-forest font-semibold' : 'bg-paper border-rule text-secondary hover:text-primary'
            }">
              <svg class="w-3.5 h-3.5 ${onlyBookmarked ? 'fill-current' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
              <span>Bookmarks</span>
            </button>
          </div>

          <!-- Search input -->
          <div class="relative w-full md:w-72">
            <input type="search" id="lib-search-input" value="${escape(searchQuery)}" placeholder="Filter library notes..." class="w-full pl-8 pr-3 py-1.5 text-xs bg-paper border border-rule rounded-md focus:outline-none focus:border-forest text-primary">
            <svg class="w-3.5 h-3.5 text-secondary absolute left-2.5 top-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>
        </div>

        <!-- Notes Grid -->
        ${filtered.length === 0 ? `
          <div class="p-12 text-center bg-paper border border-rule rounded-xl">
            <h3 class="font-serif text-lg font-bold text-forest mb-1">No Notes Match Your Filter</h3>
            <p class="text-xs text-secondary mb-4">Try clearing your search query or create a new note in this category.</p>
            <button id="lib-empty-create" class="px-4 py-2 bg-forest text-white text-xs font-medium rounded-md">Create Note</button>
          </div>
        ` : `
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${filtered.map(note => {
              const sub = state.subjects.find(s => s.id === note.subjectId);
              return `
                <div class="note-grid-card p-5 bg-paper hover:bg-card-hover border border-rule rounded-xl flex flex-col justify-between transition-all group relative">
                  <div>
                    <div class="flex items-start justify-between gap-2 mb-2">
                      <span class="text-[11px] font-semibold text-forest uppercase tracking-wider truncate">${escape(sub ? sub.name : 'General Law')}</span>
                      <button data-bookmark-id="${note.id}" class="note-card-bookmark p-1 text-secondary hover:text-champagne rounded transition-colors" title="Bookmark">
                        <svg class="w-4 h-4 ${note.bookmarked ? 'fill-champagne text-champagne' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                      </button>
                    </div>

                    <h3 data-open-id="${note.id}" class="font-serif text-base font-bold text-primary group-hover:text-forest transition-colors cursor-pointer line-clamp-2">
                      ${escape(note.title)}
                    </h3>

                    <!-- Unboxed metadata with typographic separators -->
                    <div class="text-[11px] text-secondary mt-1 flex items-center flex-wrap gap-1">
                      <span>${escape(note.semester || 'LLB')}</span>
                      <span class="meta-sep"></span>
                      <span>${escape(note.lectureNo || 'Lecture')}</span>
                      <span class="meta-sep"></span>
                      <span>${formatFriendlyDate(note.lectureDate || note.createdAt)}</span>
                    </div>

                    <p class="text-xs text-secondary mt-3 line-clamp-3 leading-relaxed">
                      ${escape(note.summary || note.structuredNote || note.rawTranscript)}
                    </p>
                  </div>

                  <!-- Footer with tags and action icons -->
                  <div class="pt-4 mt-4 border-t border-rule flex items-center justify-between text-xs">
                    <div class="flex items-center gap-1 overflow-hidden truncate">
                      ${(note.tags || []).slice(0, 2).map(t => `<span class="text-[10px] text-secondary truncate">#${escape(t)}</span>`).join(' ')}
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                      <button data-open-id="${note.id}" class="text-xs font-semibold text-forest hover:underline">Open &rarr;</button>
                      <button data-delete-id="${note.id}" class="text-secondary hover:text-rose-700 p-1" title="Delete note">
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `}
      </div>
    `;

    // Handlers
    container.querySelector('#lib-new-note').addEventListener('click', () => createNewNote(activeFilterSub !== 'all' ? activeFilterSub : null));
    const emptyBtn = container.querySelector('#lib-empty-create');
    if (emptyBtn) emptyBtn.addEventListener('click', () => createNewNote());

    container.querySelector('#lib-subject-select').addEventListener('change', (e) => {
      activeFilterSub = e.target.value;
      renderContent();
    });

    container.querySelector('#lib-bookmark-toggle').addEventListener('click', () => {
      onlyBookmarked = !onlyBookmarked;
      renderContent();
    });

    const searchEl = container.querySelector('#lib-search-input');
    searchEl.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderContent();
    });

    container.querySelectorAll('[data-open-id]').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.openId;
        switchView('editor', { noteId: id });
      });
    });

    container.querySelectorAll('[data-bookmark-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.bookmarkId;
        const note = state.notes.find(n => n.id === id);
        if (note) {
          note.bookmarked = !note.bookmarked;
          await saveNote(note);
          await refreshStateData();
          renderContent();
          showToast(note.bookmarked ? 'Note bookmarked' : 'Bookmark removed', 'info', 2000);
        }
      });
    });

    container.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.deleteId;
        const note = state.notes.find(n => n.id === id);
        if (!note) return;

        openModal(
          'Delete Law Note',
          `<p>Are you sure you want to permanently delete <strong>"${escape(note.title)}"</strong>? This action cannot be undone.</p>`,
          async () => {
            await deleteNote(id);
            await refreshStateData();
            renderContent();
            showToast('Note deleted successfully', 'success');
          },
          'Delete'
        );
      });
    });
  };

  renderContent();
}

/**
 * View 3: Note Editor (with Split Transcript vs Polished Note Comparison)
 */
/**
 * View 3: Note Editor (Interactive Notion-Style Law Notebook Editor)
 */
async function renderEditor(noteId) {
  const container = els.views.editor;

  let note = state.notes.find(n => n.id === noteId);
  if (!note) {
    note = {
      id: 'note_' + Date.now(),
      title: 'Comparative Constitutional Law',
      subjectId: state.subjects[0]?.id || 'sub_const',
      semester: '1st Year / 1st Sem',
      chapter: 'Part III & Part VI',
      topic: 'Judicial Review & Fundamental Rights',
      lectureNo: 'Lecture 01',
      lectureDate: new Date().toISOString().split('T')[0],
      rawTranscript: '',
      structuredNote: '',
      summary: '',
      tags: ['Article 102', 'Writ', 'Judicial Review'],
      bookmarked: false,
      fontStyle: 'serif', // 'default' | 'serif' | 'mono'
      icon: '⚖️',
      cover: null,
      isFullWidth: false,
      isSmallText: false,
      commentsList: [],
      customProperties: []
    };
  }

  // Ensure default structures exist
  if (!note.fontStyle) note.fontStyle = 'serif';
  if (!note.commentsList) note.commentsList = [];
  if (!note.customProperties) note.customProperties = [];
  if (note.icon === undefined) note.icon = '⚖️';
  if (note.isSmallText === undefined) note.isSmallText = false;
  if (note.isFullWidth === undefined) note.isFullWidth = false;

  state.activeNoteId = note.id;

  const fontClass = note.fontStyle === 'mono'
    ? 'font-style-mono'
    : note.fontStyle === 'default'
    ? 'font-style-default'
    : 'font-style-serif';

  // Calculate live word count & reading time
  const fullContent = (note.structuredNote || '') + ' ' + (note.rawTranscript || '');
  const wordCount = fullContent.trim() ? fullContent.trim().split(/\s+/).length : 0;
  const charCount = fullContent.length;
  const readingTimeMin = Math.ceil(wordCount / 200) || 1;

  container.innerHTML = `
    <div id="notion-page-root" class="notion-page-container ${note.isFullWidth ? 'full-width' : ''} ${note.isSmallText ? 'small-text' : ''} ${fontClass} relative pb-28 transition-all">
      
      <!-- Top Bar (Clean Notion Style: Back Arrow, Realtime Status, Mode Switcher, Share, Three Dots) -->
      <div class="flex items-center justify-between py-2 mb-2 border-b border-rule/50 gap-2">
        <div class="flex items-center gap-2">
          <button id="editor-back-btn" class="p-2 text-secondary hover:text-primary rounded-lg transition-colors flex items-center gap-1.5 text-xs" title="Back to Library">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <!-- Real-time Offline Autosave Indicator -->
          <span id="editor-autosave-status" class="text-xs text-secondary flex items-center gap-1 mr-1 opacity-80 select-none">
            <span class="inline-block w-2 h-2 rounded-full bg-forest"></span>
            <span class="hidden sm:inline">Saved locally</span>
          </span>
        </div>

        <!-- Mode Selector Pills (Visual Notion Page | Markdown Source | Raw Transcript | Split Comparison) -->
        <div class="flex items-center p-1 bg-canvas border border-rule rounded-lg text-xs font-medium overflow-x-auto">
          <button id="view-mode-rich" class="px-2.5 py-1 rounded-md transition-colors flex items-center gap-1 ${state.activeNoteSplitMode === 'rich' ? 'bg-paper text-primary shadow-xs font-semibold' : 'text-secondary hover:text-primary'}" title="Interactive visual document with clickable to-dos and callouts">
            <span>✨ Visual Page</span>
          </button>
          <button id="view-mode-polished" class="px-2.5 py-1 rounded-md transition-colors ${state.activeNoteSplitMode === 'markdown' ? 'bg-paper text-primary shadow-xs font-semibold' : 'text-secondary hover:text-primary'}" title="Edit in raw Markdown syntax">
            <span>Markdown</span>
          </button>
          <button id="view-mode-raw" class="px-2.5 py-1 rounded-md transition-colors ${state.activeNoteSplitMode === 'raw' ? 'bg-paper text-primary shadow-xs font-semibold' : 'text-secondary hover:text-primary'}" title="Classroom lecture audio transcript">
            <span>Transcript</span>
          </button>
          <button id="view-mode-split" class="hidden md:flex items-center px-2.5 py-1 rounded-md transition-colors ${state.activeNoteSplitMode === 'split' ? 'bg-paper text-primary shadow-xs font-semibold' : 'text-secondary hover:text-primary'}" title="Side-by-side comparison">
            <span>Split</span>
          </button>
        </div>

        <div class="flex items-center gap-1 sm:gap-2 shrink-0">
          <!-- Organize with AI Button -->
          <button id="editor-run-ai-btn" class="hidden sm:flex items-center gap-1 px-2.5 py-1.5 bg-forest text-white text-xs font-semibold rounded-lg hover:bg-forest/90 transition-all shadow-xs" title="Structure and refine this law note">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            <span>Organize</span>
          </button>

          <!-- Share / Export Button (Screenshot 1 top bar) -->
          <button id="editor-share-btn" class="p-2 text-secondary hover:text-primary rounded-lg hover:bg-canvas transition-colors" title="Share & Export Note">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
          </button>

          <!-- Actions Three-Dots Button (Screenshot 1 top bar) -->
          <button id="editor-actions-sheet-btn" class="p-2 text-secondary hover:text-primary rounded-lg hover:bg-canvas transition-colors" title="Page Actions">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="12" r="1.5"/></svg>
          </button>
        </div>
      </div>

      <!-- Optional Cover Photo Banner -->
      ${note.cover ? `
        <div class="notion-cover-wrapper mb-4 group relative rounded-xl overflow-hidden border border-rule shadow-xs">
          <img src="${escape(note.cover)}" class="w-full h-full object-cover" alt="Note cover">
          <div class="absolute bottom-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button id="btn-change-cover" class="px-2.5 py-1 bg-black/60 hover:bg-black/80 text-white text-[11px] rounded backdrop-blur-xs">Change cover</button>
            <button id="btn-remove-cover" class="px-2.5 py-1 bg-black/60 hover:bg-black/80 text-white text-[11px] rounded backdrop-blur-xs">Remove</button>
          </div>
        </div>
      ` : ''}

      <!-- Page Icon & Hover Affordances (Add icon, Add cover) -->
      <div class="flex items-center gap-3 mb-2">
        ${note.icon ? `
          <div id="notion-page-icon-btn" class="notion-icon-display" title="Click to change icon">
            ${note.icon}
          </div>
        ` : ''}

        <div class="flex items-center gap-3 text-xs text-secondary opacity-75 hover:opacity-100 transition-opacity">
          ${!note.icon ? `<button id="btn-add-icon" class="flex items-center gap-1 hover:text-primary transition-colors">😊 Add icon</button>` : ''}
          ${!note.cover ? `<button id="btn-add-cover" class="flex items-center gap-1 hover:text-primary transition-colors">🖼️ Add cover</button>` : ''}
        </div>
      </div>

      <!-- Page Title (Matching Screenshot 1: 'Comparative Constitutional Law') -->
      <div class="mb-4">
        <input type="text" id="note-title-field" value="${escape(note.title)}" placeholder="Untitled" class="w-full text-2xl sm:text-3xl md:text-4xl font-bold bg-transparent text-primary outline-none tracking-tight transition-colors placeholder:text-secondary/40 pb-1">
      </div>

      <!-- Notion Properties Section (Matching Screenshot 1 & 3) -->
      <div class="space-y-1 mb-4 text-xs">
        <!-- Tags Property Row (Screenshot 1) -->
        <div class="notion-property-row flex items-center justify-between text-secondary">
          <div class="flex items-center gap-2 w-32 shrink-0">
            <svg class="w-4 h-4 text-secondary/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>
            <span>Tags</span>
          </div>
          <div class="flex-1 flex items-center gap-1.5 flex-wrap pl-2 cursor-pointer" id="notion-tags-display">
            ${(note.tags && note.tags.length > 0) ? note.tags.map(t => `
              <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-canvas text-forest border border-rule font-medium">
                ${escape(t)}
                <button data-remove-tag="${escape(t)}" class="text-secondary hover:text-rose-600">&times;</button>
              </span>
            `).join('') : '<span class="text-secondary/70 italic">Empty</span>'}
            <button id="btn-add-tag-prompt" class="text-forest hover:underline text-[11px] font-medium ml-1">+ Add</button>
          </div>
        </div>

        <!-- Subject Property Row -->
        <div class="notion-property-row flex items-center justify-between text-secondary">
          <div class="flex items-center gap-2 w-32 shrink-0">
            <svg class="w-4 h-4 text-secondary/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z"/></svg>
            <span>Subject</span>
          </div>
          <div class="flex-1 pl-2">
            <select id="note-subject-field" class="w-full sm:w-auto bg-transparent border-0 text-xs text-primary font-medium focus:outline-none cursor-pointer">
              ${state.subjects.map(s => `<option value="${s.id}" ${s.id === note.subjectId ? 'selected' : ''}>${escape(s.name)}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- Semester & Chapter Property Row -->
        <div class="notion-property-row flex items-center justify-between text-secondary">
          <div class="flex items-center gap-2 w-32 shrink-0">
            <svg class="w-4 h-4 text-secondary/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2Z"/></svg>
            <span>Chapter / Act</span>
          </div>
          <div class="flex-1 pl-2">
            <input type="text" id="note-chapter-field" value="${escape(note.chapter || '')}" placeholder="e.g. Article 102 / Contract Act s. 10" class="w-full bg-transparent border-0 text-xs text-primary focus:outline-none placeholder:text-secondary/50">
          </div>
        </div>

        <!-- Lecture Date & No. Property Row -->
        <div class="notion-property-row flex items-center justify-between text-secondary">
          <div class="flex items-center gap-2 w-32 shrink-0">
            <svg class="w-4 h-4 text-secondary/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg>
            <span>Lecture Date</span>
          </div>
          <div class="flex-1 pl-2 flex items-center gap-2">
            <input type="date" id="note-date-field" value="${note.lectureDate || ''}" class="bg-transparent border-0 text-xs text-primary focus:outline-none">
            <input type="text" id="note-lectureno-field" value="${escape(note.lectureNo || 'Lecture 01')}" class="w-24 bg-transparent border-0 text-xs text-secondary focus:outline-none">
          </div>
        </div>

        <!-- Dynamically Added Custom Properties -->
        ${(note.customProperties || []).map((cp, idx) => `
          <div class="notion-property-row flex items-center justify-between text-secondary">
            <div class="flex items-center gap-2 w-32 shrink-0 truncate">
              <span class="text-xs">🏷️</span>
              <span class="truncate">${escape(cp.name)}</span>
            </div>
            <div class="flex-1 pl-2 flex items-center justify-between">
              <input type="text" data-custom-prop-idx="${idx}" value="${escape(cp.value || '')}" placeholder="Value..." class="custom-prop-val-input w-full bg-transparent border-0 text-xs text-primary focus:outline-none">
              <button data-remove-custom-prop="${idx}" class="text-secondary/60 hover:text-rose-600 px-1 text-xs">&times;</button>
            </div>
          </div>
        `).join('')}

        <!-- Add a property Button (Screenshot 1: '+ Add a property') -->
        <div class="pt-1">
          <button id="btn-add-property" class="flex items-center gap-1.5 text-xs text-secondary hover:text-primary transition-colors py-1">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
            <span>Add a property</span>
          </button>
        </div>
      </div>

      <!-- Notion Comments Section (Matching Screenshot 1: 'S Add a comment...') -->
      <div class="pt-2 mb-6 border-b border-rule/60 pb-3">
        <!-- Input Row with 'S' Avatar Circle -->
        <div class="flex items-center gap-3">
          <div class="w-6 h-6 rounded-full bg-forest text-white flex items-center justify-center font-bold text-[11px] shrink-0 shadow-xs">
            S
          </div>
          <input type="text" id="notion-comment-input" placeholder="Add a comment..." class="flex-1 bg-transparent text-xs text-primary placeholder:text-secondary/60 outline-none">
          <button id="notion-comment-submit-btn" class="text-xs text-forest hover:underline font-semibold px-2 py-0.5">Post</button>
        </div>

        <!-- Rendered Comments List -->
        ${(note.commentsList && note.commentsList.length > 0) ? `
          <div class="mt-3 space-y-2 pl-9">
            ${note.commentsList.map((c, i) => `
              <div class="text-xs text-primary flex items-start justify-between bg-canvas/60 p-2 rounded-lg border border-rule/50">
                <div>
                  <div class="font-semibold text-forest text-[11px]">${escape(c.author || 'Shakawat')} · <span class="font-normal text-secondary text-[10px]">${formatFriendlyDate(c.timestamp)}</span></div>
                  <div class="mt-0.5">${escape(c.text)}</div>
                </div>
                <button data-delete-comment-idx="${i}" class="text-secondary/50 hover:text-rose-600 text-xs px-1">&times;</button>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- In-Page Search HUD (revealed when search button clicked) -->
      <div id="notion-search-hud" class="hidden notion-search-hud mb-4 flex items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-2 flex-1">
          <svg class="w-4 h-4 text-forest shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="notion-search-hud-input" placeholder="Find in this note..." class="w-full bg-transparent outline-none text-primary text-xs">
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span id="notion-search-hud-count" class="text-[11px] text-secondary font-mono">0 of 0</span>
          <button id="notion-search-prev" class="p-1 text-secondary hover:text-primary rounded" title="Previous match">↑</button>
          <button id="notion-search-next" class="p-1 text-secondary hover:text-primary rounded" title="Next match">↓</button>
          <button id="notion-search-close" class="p-1 text-secondary hover:text-primary rounded text-sm" title="Close search">&times;</button>
        </div>
      </div>

      <!-- Document Content Body -->
      <div class="space-y-4">
        <!-- Mode 1: Visual Interactive Notion Surface (Contenteditable with rich blocks) -->
        <div id="panel-rich" class="${state.activeNoteSplitMode === 'rich' ? '' : 'hidden'}">
          <div class="flex items-center justify-between mb-1.5 text-xs font-semibold text-forest">
            <span>Visual Law Document</span>
            <span class="text-[10px] text-secondary font-mono">Click to edit · Type '/' for blocks</span>
          </div>
          <div id="notion-editor-surface" contenteditable="true" class="notion-editor-surface p-4 sm:p-6 bg-paper border border-rule rounded-xl shadow-xs transition-colors">
            ${markdownToNotionHtml(note.structuredNote || '')}
          </div>
        </div>

        <!-- Mode 2: Markdown Source -->
        <div id="panel-polished" class="${state.activeNoteSplitMode === 'markdown' ? '' : 'hidden'} ${state.activeNoteSplitMode === 'split' ? 'w-full md:w-1/2 pr-2 inline-block align-top' : ''}">
          <div class="flex items-center justify-between mb-1.5 text-xs font-semibold text-forest">
            <span>Markdown Source</span>
            <span class="text-[10px] text-secondary font-mono">Plain Text Markup</span>
          </div>
          <textarea id="note-polished-content" rows="18" placeholder="Start typing law notes in Markdown..." class="w-full p-4 bg-paper border border-rule rounded-xl text-sm leading-relaxed text-primary focus:outline-none focus:border-forest resize-y shadow-xs font-mono">${escape(note.structuredNote || '')}</textarea>
        </div>

        <!-- Mode 3: Raw Classroom Transcript -->
        <div id="panel-raw" class="${state.activeNoteSplitMode === 'raw' ? '' : 'hidden'} ${state.activeNoteSplitMode === 'split' ? 'w-full md:w-1/2 pl-2 inline-block align-top' : ''}">
          <div class="flex items-center justify-between mb-1.5 text-xs font-semibold text-secondary">
            <span>Original Lecture Voice Transcript</span>
            <span class="text-[10px] text-secondary font-mono">Unedited Spoken Speech</span>
          </div>
          <textarea id="note-raw-content" rows="18" placeholder="Spoken classroom words captured via microphone or pasted text will appear here..." class="w-full p-4 bg-citation border border-rule rounded-xl text-sm font-mono leading-relaxed text-primary focus:outline-none focus:border-forest resize-y shadow-xs">${escape(note.rawTranscript || '')}</textarea>
        </div>
      </div>

      <!-- Executive Summary / Ratio Decidendi Card -->
      <div class="mt-6 pt-4 border-t border-rule/60">
        <label class="block text-xs font-semibold uppercase tracking-wider text-secondary mb-1">Executive Summary / Case Ratio</label>
        <textarea id="note-summary-content" rows="3" placeholder="Key legal takeaway and statutory benchmark..." class="w-full p-3 bg-canvas border border-rule rounded-xl text-xs leading-relaxed text-primary focus:outline-none focus:border-forest">${escape(note.summary || '')}</textarea>
      </div>

      <!-- Slash Commands Floating Popup Menu -->
      <div id="notion-slash-menu-popup" class="hidden notion-slash-menu">
        <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-secondary border-b border-rule/60 mb-1">
          Insert Block (Press Esc to cancel)
        </div>
        <div id="notion-slash-menu-items" class="space-y-0.5">
          ${NOTION_SLASH_COMMANDS.map((cmd, idx) => `
            <button class="notion-slash-item" data-cmd-id="${cmd.id}">
              <span class="text-base shrink-0">${cmd.icon}</span>
              <div class="truncate">
                <div class="text-xs font-semibold text-primary truncate">${cmd.title}</div>
                <div class="text-[10px] text-secondary truncate">${cmd.desc}</div>
              </div>
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Inline AI Capsule Answer Box (Pops up when student asks AI about this note) -->
      <div id="notion-ai-response-card" class="hidden fixed bottom-16 inset-x-4 max-w-lg mx-auto z-45 bg-paper/98 backdrop-blur-md border border-forest/30 rounded-2xl shadow-2xl p-4 space-y-3 text-xs animate-in fade-in duration-200">
        <div class="flex items-center justify-between pb-1 border-b border-rule/60">
          <div class="flex items-center gap-2 font-semibold text-forest">
            <span class="text-base">🎩</span>
            <span>LexNote AI Analysis</span>
          </div>
          <button id="btn-close-ai-card" class="text-secondary hover:text-primary text-base font-bold">&times;</button>
        </div>
        <div id="notion-ai-response-text" class="text-primary leading-relaxed max-h-48 overflow-y-auto font-sans">
          Thinking...
        </div>
        <div class="flex items-center justify-end gap-2 pt-1 border-t border-rule/50">
          <button id="btn-copy-ai-answer" class="px-2.5 py-1 rounded bg-canvas hover:bg-card-hover text-secondary hover:text-primary transition-colors text-[11px]">Copy</button>
          <button id="btn-insert-ai-answer" class="px-3 py-1 rounded bg-forest text-white hover:bg-forest/90 font-medium transition-colors text-[11px]">Insert into Note</button>
        </div>
      </div>

      <!-- Notion Mobile Rich Formatting Toolbar Ribbon (Screenshot 3 & 4) -->
      <div id="notion-format-toolbar" class="sticky bottom-14 z-20 my-4 p-2 bg-paper/95 backdrop-blur-md border border-rule rounded-xl shadow-lg flex items-center justify-between gap-1 overflow-x-auto text-secondary text-xs">
        <div class="flex items-center gap-1">
          <!-- '+' Block Inserter Button -->
          <button id="fmt-insert-block" class="p-2 hover:bg-canvas rounded-lg text-primary hover:text-forest transition-colors font-bold" title="Insert Heading / Legal Callout">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          
          <!-- 'Aa' Format options modal -->
          <button id="fmt-style-picker" class="p-2 hover:bg-canvas rounded-lg text-primary hover:text-forest font-semibold flex items-center gap-0.5" title="Text Styles">
            <span>Aa</span>
          </button>

          <!-- B, I, U, S -->
          <button id="fmt-bold" class="p-2 hover:bg-canvas rounded-lg text-primary hover:text-forest font-bold" title="Bold">
            B
          </button>
          <button id="fmt-italic" class="p-2 hover:bg-canvas rounded-lg text-primary hover:text-forest italic font-serif" title="Italic">
            I
          </button>
          <button id="fmt-underline" class="p-2 hover:bg-canvas rounded-lg text-primary hover:text-forest underline" title="Underline">
            U
          </button>
          <button id="fmt-strike" class="p-2 hover:bg-canvas rounded-lg text-primary hover:text-forest line-through" title="Strikethrough">
            S
          </button>

          <!-- Highlight Color Picker -->
          <button id="fmt-highlight" class="p-2 hover:bg-canvas rounded-lg text-primary hover:text-forest flex items-center" title="Highlight Selection">
            <span>🎨</span>
          </button>

          <!-- Interactive Todo Checkbox Block -->
          <button id="fmt-todo" class="px-2 py-1 hover:bg-canvas rounded-lg text-[11px] font-semibold text-forest flex items-center gap-1" title="To-do Checkbox">
            <span>☑ Todo</span>
          </button>

          <!-- Legal Ratio Decidendi Quote Block -->
          <button id="fmt-ratio" class="px-2 py-1 hover:bg-canvas rounded-lg text-[11px] font-semibold text-forest flex items-center gap-1" title="Ratio Decidendi Quote">
            <span>⚖️ Ratio</span>
          </button>

          <!-- Statutory Section Callout -->
          <button id="fmt-section" class="px-2 py-1 hover:bg-canvas rounded-lg text-[11px] font-semibold text-forest flex items-center gap-1" title="Statutory Section Callout">
            <span>📜 Section</span>
          </button>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <!-- Voice Dictate Trigger -->
          <button id="fmt-dictate" class="p-2 hover:bg-canvas text-forest rounded-lg flex items-center gap-1" title="Voice Dictation">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          </button>

          <!-- Undo / Redo -->
          <button id="fmt-undo" class="p-2 hover:bg-canvas text-secondary rounded-lg" title="Undo">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
          </button>
          <button id="fmt-redo" class="p-2 hover:bg-canvas text-secondary rounded-lg" title="Redo">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
          </button>

          <!-- Copy page contents -->
          <button id="fmt-copy" class="p-2 hover:bg-canvas text-secondary rounded-lg" title="Copy Page">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
          </button>
        </div>
      </div>

      <!-- Notion Floating Action Bottom Bar (Screenshot 1: Magnifying Glass, Ask AI Pill, Floating Popover) -->
      <div id="notion-bottom-bar" class="fixed bottom-3 inset-x-4 max-w-lg mx-auto z-40 bg-paper/95 backdrop-blur-md border border-rule rounded-full shadow-xl px-3 py-2 flex items-center justify-between gap-3">
        <!-- Search in Page -->
        <button id="notion-search-btn" class="p-2 text-secondary hover:text-primary rounded-full hover:bg-canvas transition-colors" title="Search in this note">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </button>

        <!-- Notion Capsule 'Ask AI' Bar (Screenshot 1) -->
        <div class="flex-1 relative flex items-center">
          <div class="w-full flex items-center gap-2 px-3 py-1.5 bg-canvas border border-rule rounded-full hover:border-forest/50 transition-colors cursor-text" id="notion-ask-ai-trigger">
            <!-- AI Icon (Top hat) -->
            <span class="text-sm select-none">🎩</span>
            <input type="text" id="notion-ask-ai-inline-input" placeholder="Ask AI about this note..." class="w-full bg-transparent text-xs text-primary placeholder:text-secondary focus:outline-none">
          </div>
        </div>

        <!-- Floating Popover Action Trigger (Screenshot 1: Edit / Sparkle Button) -->
        <button id="notion-fab-trigger" class="p-2.5 bg-forest hover:bg-forest/90 text-white rounded-full shadow-md transition-transform active:scale-95" title="Quick AI Actions">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
      </div>

      <!-- Floating Popover Menu (Matching Screenshot 1 Menu) -->
      <div id="notion-floating-popover" class="hidden fixed bottom-16 right-6 z-50 bg-paper border border-rule rounded-xl shadow-2xl p-2 w-56 space-y-1 text-xs">
        <button id="pop-ai-meeting" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-canvas text-left text-primary transition-colors">
          <svg class="w-4 h-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg>
          <div>
            <div class="font-medium">AI Lecture Notes</div>
            <div class="text-[10px] text-secondary">Record voice into this note</div>
          </div>
        </button>

        <button id="pop-chat" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-canvas text-left text-primary transition-colors">
          <svg class="w-4 h-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <div>
            <div class="font-medium">Chat with Note</div>
            <div class="text-[10px] text-secondary">Ask questions about this law topic</div>
          </div>
        </button>

        <button id="pop-summarize" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-canvas text-left text-primary transition-colors">
          <svg class="w-4 h-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          <div>
            <div class="font-medium">Summarize Key Points</div>
            <div class="text-[10px] text-secondary">Generate ratio summary</div>
          </div>
        </button>

        <button id="pop-extract" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-canvas text-left text-primary transition-colors">
          <svg class="w-4 h-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>
          <div>
            <div class="font-medium">Extract Cases & Sections</div>
            <div class="text-[10px] text-secondary">Discover statutory citations</div>
          </div>
        </button>

        <button id="pop-subpage" class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-canvas text-left text-primary transition-colors">
          <svg class="w-4 h-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <div>
            <div class="font-medium">New Sub-Page / Brief</div>
            <div class="text-[10px] text-secondary">Link new FIRAC brief</div>
          </div>
        </button>
      </div>

    </div>

    <!-- Notion Actions Drawer / Bottom Sheet (Matching Screenshot 2) -->
    <div id="notion-actions-sheet-overlay" class="hidden fixed inset-0 z-50 notion-drawer-overlay flex flex-col justify-end">
      <div id="notion-actions-sheet" class="notion-drawer-card max-w-md w-full mx-auto p-5 space-y-4">
        <!-- Top Grab Handle (Screenshot 2) -->
        <div class="w-10 h-1 bg-rule rounded-full mx-auto -mt-2 mb-2"></div>
        <div class="flex items-center justify-between pb-1">
          <h3 class="font-bold text-sm text-primary">Actions</h3>
          <button id="btn-close-actions-sheet" class="p-1 text-secondary hover:text-primary text-lg">&times;</button>
        </div>

        <!-- Font Switcher Row (Screenshot 2: Default, Serif, Mono) -->
        <div class="grid grid-cols-3 gap-2 p-1 bg-canvas border border-rule rounded-xl text-center text-xs">
          <button id="font-opt-default" class="py-2.5 px-1 rounded-lg transition-all ${note.fontStyle === 'default' ? 'bg-paper text-forest font-bold shadow-xs' : 'text-secondary hover:text-primary'}">
            <div class="text-base font-sans font-bold">Ag</div>
            <div class="text-[10px] mt-0.5">Default</div>
          </button>
          <button id="font-opt-serif" class="py-2.5 px-1 rounded-lg transition-all ${note.fontStyle === 'serif' ? 'bg-paper text-forest font-bold shadow-xs' : 'text-secondary hover:text-primary'}">
            <div class="text-base font-serif font-bold">Ag</div>
            <div class="text-[10px] mt-0.5">Serif</div>
          </button>
          <button id="font-opt-mono" class="py-2.5 px-1 rounded-lg transition-all ${note.fontStyle === 'mono' ? 'bg-paper text-forest font-bold shadow-xs' : 'text-secondary hover:text-primary'}">
            <div class="text-base font-mono font-bold">Ag</div>
            <div class="text-[10px] mt-0.5">Mono</div>
          </button>
        </div>

        <!-- Reading & Word Statistics -->
        <div class="flex items-center justify-around p-2.5 bg-canvas/70 border border-rule/60 rounded-xl text-center text-xs">
          <div>
            <div class="font-mono font-bold text-primary">${wordCount}</div>
            <div class="text-[10px] text-secondary">Words</div>
          </div>
          <div class="h-6 w-px bg-rule"></div>
          <div>
            <div class="font-mono font-bold text-primary">${charCount}</div>
            <div class="text-[10px] text-secondary">Characters</div>
          </div>
          <div class="h-6 w-px bg-rule"></div>
          <div>
            <div class="font-mono font-bold text-forest">~${readingTimeMin} min</div>
            <div class="text-[10px] text-secondary">Read Time</div>
          </div>
        </div>

        <!-- Action Items List (Matching Screenshot 2) -->
        <div class="space-y-1 text-xs">
          <!-- Add to Favourites -->
          <button id="act-toggle-fav" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <svg class="w-4 h-4 ${note.bookmarked ? 'fill-champagne text-champagne' : 'text-secondary'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            <span class="font-medium">${note.bookmarked ? 'Remove from Favourites' : 'Add to Favourites'}</span>
          </button>

          <!-- Share -->
          <button id="act-share" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/></svg>
            <span class="font-medium">Share / Export</span>
          </button>

          <!-- Copy link -->
          <button id="act-copy-link" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
            <span class="font-medium">Copy link</span>
          </button>

          <!-- Copy page contents -->
          <button id="act-copy-content" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
            <span class="font-medium">Copy page contents</span>
          </button>

          <!-- Duplicate -->
          <button id="act-duplicate" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            <span class="font-medium">Duplicate</span>
          </button>

          <!-- Move to -->
          <button id="act-move-to" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8L22 12L18 16"/><path d="M2 12H22"/></svg>
            <span class="font-medium">Move to Subject...</span>
          </button>

          <!-- Move to Bin -->
          <button id="act-move-bin" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-left transition-colors text-rose-600">
            <svg class="w-4 h-4 text-rose-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            <span class="font-medium">Move to Bin</span>
          </button>
        </div>

        <hr class="border-rule">

        <!-- Available Offline Toggle (Screenshot 2) -->
        <div class="flex items-center justify-between p-2.5 rounded-lg text-xs">
          <div class="flex items-center gap-3">
            <svg class="w-4 h-4 text-forest" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" x2="12" y1="8" y2="16"/></svg>
            <span class="font-medium text-primary">Available offline</span>
          </div>
          <span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-forest/10 text-forest border border-forest/20">Saved in IndexedDB</span>
        </div>

        <hr class="border-rule">

        <!-- Page Customization Actions (Screenshot 2: Small text, Full width, Add icon, Add cover) -->
        <div class="space-y-1 text-xs">
          <button id="act-toggle-smalltext" class="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <div class="flex items-center gap-3">
              <span class="text-sm">🔤</span>
              <span class="font-medium">Small text</span>
            </div>
            <span class="text-secondary">${note.isSmallText ? 'On' : 'Off'}</span>
          </button>

          <button id="act-toggle-width" class="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <div class="flex items-center gap-3">
              <svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>
              <span class="font-medium">Full width</span>
            </div>
            <span class="text-secondary">${note.isFullWidth ? 'On' : 'Off'}</span>
          </button>

          <button id="act-add-icon" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <span class="text-sm">😊</span>
            <span class="font-medium">${note.icon ? 'Change icon' : 'Add icon'}</span>
          </button>

          <button id="act-add-cover" class="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-canvas text-left transition-colors text-primary">
            <svg class="w-4 h-4 text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
            <span class="font-medium">${note.cover ? 'Change cover' : 'Add cover'}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Elements
  const visualEditorSurface = container.querySelector('#notion-editor-surface');
  const markdownTextarea = container.querySelector('#note-polished-content');
  const rawTextarea = container.querySelector('#note-raw-content');
  const summaryTextarea = container.querySelector('#note-summary-content');

  // Search Engine Instance for In-Page Search
  const searchEngine = new PageSearchEngine(visualEditorSurface);

  // --- Helper to Gather Note Form Data ---
  const getNoteFormData = () => {
    const title = container.querySelector('#note-title-field').value.trim() || 'Untitled Law Note';
    const subjectId = container.querySelector('#note-subject-field').value;
    const chapter = container.querySelector('#note-chapter-field').value.trim();
    const lectureNo = container.querySelector('#note-lectureno-field').value.trim();
    const lectureDate = container.querySelector('#note-date-field').value;
    
    // Structured content: pull from visual surface if active, otherwise markdown textarea
    let structuredNote = '';
    if (state.activeNoteSplitMode === 'rich' && visualEditorSurface) {
      structuredNote = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
    } else if (markdownTextarea) {
      structuredNote = markdownTextarea.value;
    } else {
      structuredNote = note.structuredNote || '';
    }

    const rawTranscript = rawTextarea ? rawTextarea.value : (note.rawTranscript || '');
    const summary = summaryTextarea ? summaryTextarea.value : (note.summary || '');

    return {
      ...note,
      title,
      subjectId,
      chapter,
      lectureNo,
      lectureDate,
      structuredNote,
      rawTranscript,
      summary
    };
  };

  // --- Autosave Trigger ---
  const triggerAutosave = () => {
    const statusEl = container.querySelector('#editor-autosave-status');
    if (statusEl) {
      statusEl.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span><span class="hidden sm:inline">Saving...</span>`;
    }

    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(async () => {
      const updated = getNoteFormData();
      await saveNote(updated);
      await refreshStateData();
      if (statusEl) {
        statusEl.innerHTML = `<span class="inline-block w-2 h-2 rounded-full bg-forest"></span><span class="hidden sm:inline">Saved locally</span>`;
      }
    }, 600);
  };

  // Attach input listeners for autosave
  const inputSelectors = [
    '#note-title-field',
    '#note-subject-field',
    '#note-chapter-field',
    '#note-lectureno-field',
    '#note-date-field',
    '#note-raw-content',
    '#note-summary-content'
  ];
  inputSelectors.forEach(sel => {
    const el = container.querySelector(sel);
    if (el) el.addEventListener('input', triggerAutosave);
  });

  // Visual Editor Surface input & sync
  if (visualEditorSurface) {
    visualEditorSurface.addEventListener('input', () => {
      const md = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
      note.structuredNote = md;
      if (markdownTextarea) markdownTextarea.value = md;
      triggerAutosave();
    });

    // Handle interactive todo checkbox clicks inside visual surface
    visualEditorSurface.addEventListener('click', (e) => {
      const cb = e.target.closest('.notion-todo-checkbox');
      if (cb) {
        const item = cb.closest('.notion-todo-item');
        if (item) {
          item.classList.toggle('completed', cb.checked);
          item.classList.toggle('text-secondary', cb.checked);
          item.classList.toggle('line-through', cb.checked);
        }
        const md = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
        note.structuredNote = md;
        if (markdownTextarea) markdownTextarea.value = md;
        triggerAutosave();
      }
    });

    // Slash command trigger when typing '/'
    const slashMenu = container.querySelector('#notion-slash-menu-popup');
    visualEditorSurface.addEventListener('keyup', (e) => {
      if (e.key === '/') {
        showSlashMenu();
      } else if (e.key === 'Escape') {
        hideSlashMenu();
      }
    });

    const showSlashMenu = () => {
      if (!slashMenu) return;
      const rect = visualEditorSurface.getBoundingClientRect();
      slashMenu.style.top = `${rect.top + window.scrollY + 80}px`;
      slashMenu.style.left = `${Math.min(rect.left + 20, window.innerWidth - 300)}px`;
      slashMenu.classList.remove('hidden');
    };

    const hideSlashMenu = () => {
      if (slashMenu) slashMenu.classList.add('hidden');
    };

    // Slash menu item clicks
    slashMenu.querySelectorAll('.notion-slash-item').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cmdId = btn.dataset.cmdId;
        const cmd = NOTION_SLASH_COMMANDS.find(c => c.id === cmdId);
        if (cmd) {
          cmd.action(visualEditorSurface);
          const md = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
          note.structuredNote = md;
          if (markdownTextarea) markdownTextarea.value = md;
          triggerAutosave();
        }
        hideSlashMenu();
      });
    });

    document.addEventListener('click', (e) => {
      if (!slashMenu.contains(e.target)) hideSlashMenu();
    });
  }

  // Markdown Textarea sync to visual surface
  if (markdownTextarea) {
    markdownTextarea.addEventListener('input', () => {
      note.structuredNote = markdownTextarea.value;
      if (visualEditorSurface) {
        visualEditorSurface.innerHTML = markdownToNotionHtml(markdownTextarea.value);
      }
      triggerAutosave();
    });
  }

  // Back button
  container.querySelector('#editor-back-btn').addEventListener('click', () => switchView('library'));

  // Split View mode switches
  container.querySelector('#view-mode-rich').addEventListener('click', () => {
    state.activeNoteSplitMode = 'rich';
    if (visualEditorSurface && markdownTextarea) {
      visualEditorSurface.innerHTML = markdownToNotionHtml(markdownTextarea.value);
    }
    renderEditor(note.id);
  });

  container.querySelector('#view-mode-polished').addEventListener('click', () => {
    state.activeNoteSplitMode = 'markdown';
    if (markdownTextarea && visualEditorSurface) {
      markdownTextarea.value = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
    }
    renderEditor(note.id);
  });

  container.querySelector('#view-mode-raw').addEventListener('click', () => {
    state.activeNoteSplitMode = 'raw';
    renderEditor(note.id);
  });

  container.querySelector('#view-mode-split')?.addEventListener('click', () => {
    state.activeNoteSplitMode = 'split';
    renderEditor(note.id);
  });

  // Custom properties listener
  container.querySelectorAll('.custom-prop-val-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.customPropIdx);
      if (note.customProperties && note.customProperties[idx]) {
        note.customProperties[idx].value = e.target.value;
        triggerAutosave();
      }
    });
  });

  // Remove custom property
  container.querySelectorAll('[data-remove-custom-prop]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const idx = Number(btn.dataset.removeCustomProp);
      note.customProperties.splice(idx, 1);
      await saveNote(note);
      renderEditor(note.id);
    });
  });

  // Share / Export Button (Screenshot 1)
  const openShareExportModal = () => {
    const currentNoteData = getNoteFormData();
    const sub = state.subjects.find(s => s.id === currentNoteData.subjectId);
    currentNoteData.subjectName = sub ? sub.name : 'Law Note';

    openModal(
      'Export & Share Law Note',
      `
      <div class="space-y-3 text-xs">
        <p class="text-secondary">Export this note in academic and publication formats:</p>
        <div class="space-y-2">
          <button id="exp-pdf" class="w-full flex items-center justify-between p-3 bg-canvas hover:bg-card-hover border border-rule rounded-lg text-left transition-colors">
            <div>
              <div class="font-semibold text-primary">Printable Legal PDF</div>
              <div class="text-[11px] text-secondary">Formatted letterhead with legal stationery styling</div>
            </div>
            <span class="text-forest">&rarr;</span>
          </button>

          <button id="exp-docx" class="w-full flex items-center justify-between p-3 bg-canvas hover:bg-card-hover border border-rule rounded-lg text-left transition-colors">
            <div>
              <div class="font-semibold text-primary">Microsoft Word (.doc / .docx)</div>
              <div class="text-[11px] text-secondary">Formatted Word document with heading hierarchy</div>
            </div>
            <span class="text-forest">&rarr;</span>
          </button>

          <button id="exp-md" class="w-full flex items-center justify-between p-3 bg-canvas hover:bg-card-hover border border-rule rounded-lg text-left transition-colors">
            <div>
              <div class="font-semibold text-primary">Markdown (.md)</div>
              <div class="text-[11px] text-secondary">Clean plain text with Markdown syntax</div>
            </div>
            <span class="text-forest">&rarr;</span>
          </button>

          <button id="exp-txt" class="w-full flex items-center justify-between p-3 bg-canvas hover:bg-card-hover border border-rule rounded-lg text-left transition-colors">
            <div>
              <div class="font-semibold text-primary">Plain Text (.txt)</div>
              <div class="text-[11px] text-secondary">Simple unformatted text file</div>
            </div>
            <span class="text-forest">&rarr;</span>
          </button>
        </div>
      </div>
      `
    );

    document.getElementById('exp-pdf')?.addEventListener('click', () => {
      closeModal();
      printNoteAsPdf(currentNoteData);
    });
    document.getElementById('exp-docx')?.addEventListener('click', () => {
      closeModal();
      exportNoteAsDocx(currentNoteData);
      showToast('Word document exported successfully', 'success');
    });
    document.getElementById('exp-md')?.addEventListener('click', () => {
      closeModal();
      exportNoteAsMarkdown(currentNoteData);
      showToast('Markdown file exported successfully', 'success');
    });
    document.getElementById('exp-txt')?.addEventListener('click', () => {
      closeModal();
      exportNoteAsText(currentNoteData);
      showToast('Text file exported successfully', 'success');
    });
  };

  container.querySelector('#editor-share-btn').addEventListener('click', openShareExportModal);

  // Actions Drawer Sheet (Screenshot 2)
  const actionsOverlay = container.querySelector('#notion-actions-sheet-overlay');
  const openActionsSheet = () => actionsOverlay.classList.remove('hidden');
  const closeActionsSheet = () => actionsOverlay.classList.add('hidden');

  container.querySelector('#editor-actions-sheet-btn').addEventListener('click', openActionsSheet);
  container.querySelector('#btn-close-actions-sheet').addEventListener('click', closeActionsSheet);
  actionsOverlay.addEventListener('click', (e) => {
    if (e.target === actionsOverlay) closeActionsSheet();
  });

  // Font Switchers (Screenshot 2: Default, Serif, Mono)
  const setFontStyle = async (style) => {
    note.fontStyle = style;
    await saveNote(note);
    closeActionsSheet();
    renderEditor(note.id);
  };
  container.querySelector('#font-opt-default').addEventListener('click', () => setFontStyle('default'));
  container.querySelector('#font-opt-serif').addEventListener('click', () => setFontStyle('serif'));
  container.querySelector('#font-opt-mono').addEventListener('click', () => setFontStyle('mono'));

  // Small text toggle
  container.querySelector('#act-toggle-smalltext').addEventListener('click', async () => {
    note.isSmallText = !note.isSmallText;
    await saveNote(note);
    closeActionsSheet();
    renderEditor(note.id);
  });

  // Full width toggle
  container.querySelector('#act-toggle-width').addEventListener('click', async () => {
    note.isFullWidth = !note.isFullWidth;
    await saveNote(note);
    closeActionsSheet();
    renderEditor(note.id);
  });

  // Action Drawer Items (Screenshot 2)
  container.querySelector('#act-toggle-fav').addEventListener('click', async () => {
    note.bookmarked = !note.bookmarked;
    await saveNote(note);
    await refreshStateData();
    closeActionsSheet();
    showToast(note.bookmarked ? 'Added to Favourites' : 'Removed from Favourites', 'success');
    renderEditor(note.id);
  });

  container.querySelector('#act-share').addEventListener('click', () => {
    closeActionsSheet();
    openShareExportModal();
  });

  container.querySelector('#act-copy-link').addEventListener('click', () => {
    navigator.clipboard.writeText(window.location.href);
    closeActionsSheet();
    showToast('Page link copied to clipboard', 'success');
  });

  container.querySelector('#act-copy-content').addEventListener('click', () => {
    const textToCopy = `${note.title}\n\n${note.structuredNote || ''}\n\n${note.rawTranscript || ''}`;
    navigator.clipboard.writeText(textToCopy);
    closeActionsSheet();
    showToast('Page contents copied to clipboard', 'success');
  });

  container.querySelector('#act-duplicate').addEventListener('click', async () => {
    const dupe = {
      ...note,
      id: 'note_' + Date.now(),
      title: `${note.title} (Copy)`,
      createdAt: new Date().toISOString()
    };
    await saveNote(dupe);
    await refreshStateData();
    closeActionsSheet();
    showToast('Note duplicated successfully', 'success');
    renderEditor(dupe.id);
  });

  container.querySelector('#act-move-to').addEventListener('click', () => {
    closeActionsSheet();
    openModal(
      'Move Note to Subject',
      `
      <div class="space-y-3 text-xs">
        <label class="block font-semibold text-secondary">Select Destination Subject:</label>
        <select id="move-dest-subject" class="w-full p-2 bg-canvas border border-rule rounded-lg text-primary">
          ${state.subjects.map(s => `<option value="${s.id}" ${s.id === note.subjectId ? 'selected' : ''}>${escape(s.name)}</option>`).join('')}
        </select>
      </div>
      `,
      async (card) => {
        const destId = card.querySelector('#move-dest-subject').value;
        note.subjectId = destId;
        await saveNote(note);
        await refreshStateData();
        renderEditor(note.id);
        showToast('Note moved successfully', 'success');
        return true;
      },
      'Move'
    );
  });

  container.querySelector('#act-move-bin').addEventListener('click', () => {
    closeActionsSheet();
    openModal(
      'Move Note to Bin',
      `<p class="text-xs">Are you sure you want to delete <strong>"${escape(note.title)}"</strong>?</p>`,
      async () => {
        await deleteNote(note.id);
        await refreshStateData();
        showToast('Note moved to bin', 'info');
        switchView('library');
      },
      'Delete'
    );
  });

  // Add / Change Icon Picker
  const triggerIconPicker = () => {
    const icons = ['⚖️', '📜', '🏛️', '📚', '⚖', '✍️', '💼', '🎓', '🛡️', '🔍', '💡', '📌'];
    openModal(
      'Select Note Icon',
      `
      <div class="grid grid-cols-6 gap-3 text-2xl p-2 text-center">
        ${icons.map(ic => `<button class="pick-icon-btn p-2 hover:bg-canvas rounded-lg transition-transform active:scale-90" data-icon="${ic}">${ic}</button>`).join('')}
      </div>
      `
    );
    document.querySelectorAll('.pick-icon-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        note.icon = btn.dataset.icon;
        await saveNote(note);
        closeModal();
        renderEditor(note.id);
      });
    });
  };

  container.querySelector('#btn-add-icon')?.addEventListener('click', triggerIconPicker);
  container.querySelector('#notion-page-icon-btn')?.addEventListener('click', triggerIconPicker);
  container.querySelector('#act-add-icon')?.addEventListener('click', () => {
    closeActionsSheet();
    triggerIconPicker();
  });

  // Add / Change Cover Photo Picker
  const triggerCoverPicker = () => {
    const covers = [
      { name: 'Supreme Court Architecture', url: 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?auto=format&fit=crop&w=1200&q=80' },
      { name: 'Vintage Law Library', url: 'https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=1200&q=80' },
      { name: 'Legal Constitution Parchment', url: 'https://images.unsplash.com/photo-1450133064473-71024230f91b?auto=format&fit=crop&w=1200&q=80' },
      { name: 'Forest Green Minimal Canvas', url: 'https://images.unsplash.com/photo-1518531933037-91b2f5f229cc?auto=format&fit=crop&w=1200&q=80' }
    ];

    openModal(
      'Choose Cover Image',
      `
      <div class="space-y-3 text-xs">
        <div class="grid grid-cols-2 gap-2">
          ${covers.map(c => `
            <div class="cursor-pointer group relative rounded-lg overflow-hidden border border-rule pick-cover-card" data-url="${c.url}">
              <img src="${c.url}" class="h-20 w-full object-cover group-hover:scale-105 transition-transform" alt="${c.name}">
              <div class="p-1.5 bg-paper text-[10px] font-semibold text-primary truncate">${c.name}</div>
            </div>
          `).join('')}
        </div>
      </div>
      `
    );

    document.querySelectorAll('.pick-cover-card').forEach(card => {
      card.addEventListener('click', async () => {
        note.cover = card.dataset.url;
        await saveNote(note);
        closeModal();
        renderEditor(note.id);
      });
    });
  };

  container.querySelector('#btn-add-cover')?.addEventListener('click', triggerCoverPicker);
  container.querySelector('#btn-change-cover')?.addEventListener('click', triggerCoverPicker);
  container.querySelector('#act-add-cover')?.addEventListener('click', () => {
    closeActionsSheet();
    triggerCoverPicker();
  });
  container.querySelector('#btn-remove-cover')?.addEventListener('click', async () => {
    note.cover = null;
    await saveNote(note);
    renderEditor(note.id);
  });

  // Tag Manager: Add Tag
  container.querySelector('#btn-add-tag-prompt')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const tag = prompt('Enter new tag for this note (e.g. Article 102, Writ, Contract Act):');
    if (tag && tag.trim()) {
      if (!note.tags) note.tags = [];
      if (!note.tags.includes(tag.trim())) {
        note.tags.push(tag.trim());
        triggerAutosave();
        renderEditor(note.id);
      }
    }
  });

  // Remove Tag
  container.querySelectorAll('[data-remove-tag]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const t = btn.dataset.removeTag;
      note.tags = (note.tags || []).filter(item => item !== t);
      triggerAutosave();
      renderEditor(note.id);
    });
  });

  // '+ Add a property' Button (Screenshot 1)
  container.querySelector('#btn-add-property').addEventListener('click', () => {
    openModal(
      'Add a Property',
      `
      <div class="space-y-3 text-xs">
        <div>
          <label class="block font-semibold text-secondary mb-1">Property Name</label>
          <input type="text" id="new-prop-name" placeholder="e.g. Case Citation, Legal Issue, Professor" class="w-full p-2 bg-canvas border border-rule rounded-lg text-primary">
        </div>
        <div>
          <label class="block font-semibold text-secondary mb-1">Property Value</label>
          <input type="text" id="new-prop-val" placeholder="Value..." class="w-full p-2 bg-canvas border border-rule rounded-lg text-primary">
        </div>
      </div>
      `,
      async (card) => {
        const name = card.querySelector('#new-prop-name').value.trim();
        const value = card.querySelector('#new-prop-val').value.trim();
        if (!name) {
          showToast('Please provide a property name.', 'warning');
          return false;
        }
        if (!note.customProperties) note.customProperties = [];
        note.customProperties.push({ name, value });
        await saveNote(note);
        renderEditor(note.id);
        showToast(`Property "${name}" added!`, 'success');
        return true;
      },
      'Add Property'
    );
  });

  // Comments System (Screenshot 1: 'S Add a comment...')
  const commentInput = container.querySelector('#notion-comment-input');
  const commentSubmitBtn = container.querySelector('#notion-comment-submit-btn');

  const postComment = async () => {
    const text = commentInput.value.trim();
    if (!text) return;
    if (!note.commentsList) note.commentsList = [];
    note.commentsList.push({
      author: 'Shakawat',
      text,
      timestamp: new Date().toISOString()
    });
    commentInput.value = '';
    await saveNote(note);
    renderEditor(note.id);
    showToast('Comment added', 'success', 1500);
  };

  commentSubmitBtn.addEventListener('click', postComment);
  commentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') postComment();
  });

  container.querySelectorAll('[data-delete-comment-idx]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.deleteCommentIdx);
      note.commentsList.splice(idx, 1);
      await saveNote(note);
      renderEditor(note.id);
    });
  });

  // Formatting Ribbon Buttons (Screenshot 3 & 4)
  const execFormat = (cmd, val = null) => {
    if (state.activeNoteSplitMode === 'rich') {
      document.execCommand(cmd, false, val);
      const md = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
      note.structuredNote = md;
      if (markdownTextarea) markdownTextarea.value = md;
      triggerAutosave();
    } else if (markdownTextarea) {
      const start = markdownTextarea.selectionStart;
      const end = markdownTextarea.selectionEnd;
      const selected = markdownTextarea.value.substring(start, end);
      let rep = '';
      if (cmd === 'bold') rep = `**${selected}**`;
      else if (cmd === 'italic') rep = `*${selected}*`;
      else if (cmd === 'underline') rep = `<u>${selected}</u>`;
      else if (cmd === 'strikeThrough') rep = `~~${selected}~~`;
      markdownTextarea.value = markdownTextarea.value.substring(0, start) + rep + markdownTextarea.value.substring(end);
      markdownTextarea.focus();
      triggerAutosave();
    }
  };

  container.querySelector('#fmt-bold').addEventListener('click', () => execFormat('bold'));
  container.querySelector('#fmt-italic').addEventListener('click', () => execFormat('italic'));
  container.querySelector('#fmt-underline').addEventListener('click', () => execFormat('underline'));
  container.querySelector('#fmt-strike').addEventListener('click', () => execFormat('strikeThrough'));

  // Highlight selection with color
  container.querySelector('#fmt-highlight').addEventListener('click', () => {
    const colors = [
      { name: 'Yellow', code: '#fef08a' },
      { name: 'Green', code: '#bbf7d0' },
      { name: 'Blue', code: '#bfdbfe' },
      { name: 'Pink', code: '#fbcfe8' },
      { name: 'Orange', code: '#fed7aa' }
    ];
    openModal(
      'Text Highlight Color',
      `
      <div class="flex items-center justify-around p-3">
        ${colors.map(c => `
          <button class="pick-color-btn w-9 h-9 rounded-full border-2 border-rule transition-transform active:scale-95" style="background-color: ${c.code}" data-color="${c.code}" title="${c.name}"></button>
        `).join('')}
      </div>
      `
    );
    document.querySelectorAll('.pick-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        closeModal();
        if (state.activeNoteSplitMode === 'rich') {
          document.execCommand('hiliteColor', false, btn.dataset.color);
          const md = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
          note.structuredNote = md;
          if (markdownTextarea) markdownTextarea.value = md;
          triggerAutosave();
        }
      });
    });
  });

  // To-do inserter
  container.querySelector('#fmt-todo').addEventListener('click', () => {
    if (state.activeNoteSplitMode === 'rich') {
      insertBlockHtml(visualEditorSurface, `
        <div class="notion-todo-item flex items-start gap-2 my-1 text-xs sm:text-sm text-primary">
          <input type="checkbox" class="notion-todo-checkbox mt-1 w-4 h-4 rounded text-forest border-rule focus:ring-forest cursor-pointer">
          <div class="notion-todo-text flex-1 outline-none leading-relaxed">New law task / reading checklist item...</div>
        </div>
      `);
    } else if (markdownTextarea) {
      const start = markdownTextarea.selectionStart;
      markdownTextarea.value = markdownTextarea.value.substring(0, start) + '\n- [ ] ' + markdownTextarea.value.substring(start);
      triggerAutosave();
    }
  });

  // Ratio Decidendi quote inserter
  container.querySelector('#fmt-ratio').addEventListener('click', () => {
    if (state.activeNoteSplitMode === 'rich') {
      insertBlockHtml(visualEditorSurface, `
        <div class="notion-callout notion-ratio-callout my-3 p-3.5 bg-citation border-l-4 border-forest rounded-r-xl text-xs sm:text-sm text-primary flex items-start gap-2.5">
          <span class="text-base select-none shrink-0">⚖️</span>
          <div class="flex-1 leading-relaxed"><strong>Ratio Decidendi:</strong> The legal reasoning upon which the court decided this issue...</div>
        </div>
      `);
    } else if (markdownTextarea) {
      const start = markdownTextarea.selectionStart;
      markdownTextarea.value = markdownTextarea.value.substring(0, start) + '\n> **Ratio Decidendi:** *...*\n' + markdownTextarea.value.substring(start);
      triggerAutosave();
    }
  });

  // Statutory section callout inserter
  container.querySelector('#fmt-section').addEventListener('click', () => {
    if (state.activeNoteSplitMode === 'rich') {
      insertBlockHtml(visualEditorSurface, `
        <div class="notion-callout notion-statute-callout my-3 p-3.5 bg-callout border border-rule border-l-4 border-l-amber-600 rounded-r-xl text-xs sm:text-sm text-primary flex items-start gap-2.5">
          <span class="text-base select-none shrink-0">📜</span>
          <div class="flex-1 leading-relaxed">
            <strong>Statutory Section:</strong>
            <div>• <strong>Act:</strong> The Penal Code 1860 / Contract Act 1872</div>
            <div>• <strong>Section:</strong> Section </div>
            <div>• <strong>Key Elements:</strong> </div>
          </div>
        </div>
      `);
    } else if (markdownTextarea) {
      const start = markdownTextarea.selectionStart;
      markdownTextarea.value = markdownTextarea.value.substring(0, start) + '\n### Statutory Provision\n- **Act:** \n- **Section:** \n' + markdownTextarea.value.substring(start);
      triggerAutosave();
    }
  });

  // '+' Block Inserter Popup
  container.querySelector('#fmt-insert-block').addEventListener('click', () => {
    openModal(
      'Insert Notion Legal Block',
      `
      <div class="space-y-1.5 text-xs max-h-72 overflow-y-auto">
        ${NOTION_SLASH_COMMANDS.map(cmd => `
          <button class="notion-insert-modal-btn w-full p-2.5 bg-canvas hover:bg-card-hover rounded-lg text-left flex items-center justify-between transition-colors" data-cmd-id="${cmd.id}">
            <div class="flex items-center gap-2.5">
              <span class="text-lg">${cmd.icon}</span>
              <div>
                <div class="font-semibold text-primary">${cmd.title}</div>
                <div class="text-[10px] text-secondary">${cmd.desc}</div>
              </div>
            </div>
            <span class="text-secondary text-[11px] font-mono">&rarr;</span>
          </button>
        `).join('')}
      </div>
      `
    );

    document.querySelectorAll('.notion-insert-modal-btn').forEach(b => {
      b.addEventListener('click', () => {
        closeModal();
        const cmdId = b.dataset.cmdId;
        const cmd = NOTION_SLASH_COMMANDS.find(c => c.id === cmdId);
        if (cmd) {
          if (state.activeNoteSplitMode === 'rich') {
            cmd.action(visualEditorSurface);
            const md = notionHtmlToMarkdown(visualEditorSurface.innerHTML);
            note.structuredNote = md;
            if (markdownTextarea) markdownTextarea.value = md;
          } else if (markdownTextarea) {
            cmd.action(markdownTextarea);
          }
          triggerAutosave();
        }
      });
    });
  });

  // 'Aa' Style Picker modal
  container.querySelector('#fmt-style-picker').addEventListener('click', () => {
    openModal(
      'Turn Selection Into...',
      `
      <div class="space-y-2 text-xs">
        <button id="turn-p" class="w-full p-2.5 bg-canvas hover:bg-card-hover rounded-lg text-left text-primary font-medium">Text Paragraph</button>
        <button id="turn-h1" class="w-full p-2.5 bg-canvas hover:bg-card-hover rounded-lg text-left font-bold text-forest">Heading 1</button>
        <button id="turn-h2" class="w-full p-2.5 bg-canvas hover:bg-card-hover rounded-lg text-left font-semibold text-forest">Heading 2</button>
        <button id="turn-h3" class="w-full p-2.5 bg-canvas hover:bg-card-hover rounded-lg text-left font-semibold text-primary">Heading 3</button>
        <button id="turn-quote" class="w-full p-2.5 bg-canvas hover:bg-card-hover rounded-lg text-left italic text-secondary">Quote Block</button>
      </div>
      `
    );
    document.getElementById('turn-p')?.addEventListener('click', () => { closeModal(); execFormat('formatBlock', '<p>'); });
    document.getElementById('turn-h1')?.addEventListener('click', () => { closeModal(); execFormat('formatBlock', '<h1>'); });
    document.getElementById('turn-h2')?.addEventListener('click', () => { closeModal(); execFormat('formatBlock', '<h2>'); });
    document.getElementById('turn-h3')?.addEventListener('click', () => { closeModal(); execFormat('formatBlock', '<h3>'); });
    document.getElementById('turn-quote')?.addEventListener('click', () => { closeModal(); execFormat('formatBlock', '<blockquote>'); });
  });

  // Direct Voice Dictate trigger
  container.querySelector('#fmt-dictate').addEventListener('click', () => {
    switchView('voice');
  });

  // Undo / Redo
  container.querySelector('#fmt-undo').addEventListener('click', () => document.execCommand('undo'));
  container.querySelector('#fmt-redo').addEventListener('click', () => document.execCommand('redo'));

  // Copy page contents
  container.querySelector('#fmt-copy').addEventListener('click', () => {
    const textToCopy = visualEditorSurface ? visualEditorSurface.innerText : (note.structuredNote || '');
    navigator.clipboard.writeText(textToCopy);
    showToast('Page content copied', 'success', 1500);
  });

  // In-Page Search HUD Controller
  const searchHud = container.querySelector('#notion-search-hud');
  const searchInput = container.querySelector('#notion-search-hud-input');
  const searchCount = container.querySelector('#notion-search-hud-count');

  const openSearchHud = () => {
    searchHud.classList.remove('hidden');
    searchInput.focus();
  };
  const closeSearchHud = () => {
    searchHud.classList.add('hidden');
    searchEngine.clear();
  };

  container.querySelector('#notion-search-btn').addEventListener('click', openSearchHud);
  container.querySelector('#notion-search-close').addEventListener('click', closeSearchHud);

  searchInput.addEventListener('input', () => {
    const res = searchEngine.search(searchInput.value);
    searchCount.textContent = `${res.current} of ${res.count}`;
  });

  container.querySelector('#notion-search-next').addEventListener('click', () => {
    const cur = searchEngine.next();
    searchCount.textContent = `${cur} of ${searchEngine.matches.length}`;
  });

  container.querySelector('#notion-search-prev').addEventListener('click', () => {
    const cur = searchEngine.prev();
    searchCount.textContent = `${cur} of ${searchEngine.matches.length}`;
  });

  // Bottom Floating Popover Menu Toggle (Screenshot 1: FAB)
  const fabTrigger = container.querySelector('#notion-fab-trigger');
  const fabPopover = container.querySelector('#notion-floating-popover');
  fabTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    fabPopover.classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!fabPopover.contains(e.target) && e.target !== fabTrigger) {
      fabPopover.classList.add('hidden');
    }
  });

  // Popover Actions (Screenshot 1: AI Meeting Notes, Chat, Page, Summarize, Extract)
  container.querySelector('#pop-ai-meeting').addEventListener('click', () => {
    fabPopover.classList.add('hidden');
    switchView('voice');
  });

  container.querySelector('#pop-chat').addEventListener('click', () => {
    fabPopover.classList.add('hidden');
    switchView('ask', { initialQuery: note.title });
  });

  container.querySelector('#pop-subpage').addEventListener('click', () => {
    fabPopover.classList.add('hidden');
    createNewNote(note.subjectId);
  });

  container.querySelector('#pop-summarize').addEventListener('click', async () => {
    fabPopover.classList.add('hidden');
    showToast('Summarizing legal note...', 'info');
    const fullText = (note.structuredNote || '') + '\n' + (note.rawTranscript || '');
    const res = await organizeLegalNote(fullText, { mode: 'concise', language: state.outputLang });
    if (res.summary) {
      summaryTextarea.value = res.summary;
      note.summary = res.summary;
      triggerAutosave();
      showToast('Executive summary generated!', 'success');
    }
  });

  container.querySelector('#pop-extract').addEventListener('click', async () => {
    fabPopover.classList.add('hidden');
    const fullText = (note.structuredNote || '') + '\n' + (note.rawTranscript || '');
    const entities = extractLegalEntities(fullText);
    const added = [];
    if (!note.tags) note.tags = [];
    [...entities.sections, ...entities.cases].forEach(item => {
      if (!note.tags.includes(item)) {
        note.tags.push(item);
        added.push(item);
      }
    });
    if (added.length > 0) {
      await saveNote(note);
      renderEditor(note.id);
      showToast(`Discovered & added ${added.length} legal citations to tags!`, 'success');
    } else {
      showToast('No new statutory sections or cases identified in text.', 'info');
    }
  });

  // Capsule 'Ask AI' Bar with Inline Answer Card (Screenshot 1)
  const inlineAiInput = container.querySelector('#notion-ask-ai-inline-input');
  const aiResponseCard = container.querySelector('#notion-ai-response-card');
  const aiResponseText = container.querySelector('#notion-ai-response-text');

  const runInlineAiQuery = async (q) => {
    if (!q || !q.trim()) return;
    inlineAiInput.value = '';
    aiResponseCard.classList.remove('hidden');
    aiResponseText.innerHTML = '<span class="text-secondary animate-pulse">Analyzing note contents...</span>';

    try {
      const noteContext = `Topic: ${note.title}\nSubject: ${note.subjectId}\nContent:\n${note.structuredNote || ''}\nTranscript:\n${note.rawTranscript || ''}`;
      const answer = await queryMyNotebook(q, [noteContext], {
        localAiUrl: state.localAiUrl,
        localAiModel: state.localAiModel
      });
      aiResponseText.innerHTML = `<p>${escape(answer.answer || answer.text || 'Analysis completed.')}</p>`;
      if (answer.source) {
        aiResponseText.innerHTML += `<div class="mt-2 text-[10px] text-secondary">Source: ${escape(answer.source)}</div>`;
      }
    } catch (err) {
      aiResponseText.innerHTML = `<p class="text-rose-600">Could not complete query: ${escape(err.message)}</p>`;
    }
  };

  inlineAiInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runInlineAiQuery(inlineAiInput.value);
  });

  container.querySelector('#btn-close-ai-card').addEventListener('click', () => {
    aiResponseCard.classList.add('hidden');
  });

  container.querySelector('#btn-copy-ai-answer').addEventListener('click', () => {
    navigator.clipboard.writeText(aiResponseText.innerText);
    showToast('AI answer copied to clipboard', 'success');
  });

  container.querySelector('#btn-insert-ai-answer').addEventListener('click', () => {
    const textToInsert = `\n> **AI Analysis:** ${aiResponseText.innerText}\n`;
    if (state.activeNoteSplitMode === 'rich') {
      insertBlockHtml(visualEditorSurface, `
        <div class="notion-callout my-3 p-3 bg-canvas border border-rule rounded-xl text-xs sm:text-sm text-primary">
          <span class="text-base">🎩</span>
          <div class="mt-1 leading-relaxed">${escape(aiResponseText.innerText)}</div>
        </div>
      `);
    } else if (markdownTextarea) {
      markdownTextarea.value += textToInsert;
    }
    aiResponseCard.classList.add('hidden');
    triggerAutosave();
    showToast('AI analysis inserted into note', 'success');
  });

  // AI Organizer Modal Trigger
  container.querySelector('#editor-run-ai-btn').addEventListener('click', () => {
    const rawText = (rawTextarea && rawTextarea.value.trim()) || (markdownTextarea && markdownTextarea.value.trim()) || (visualEditorSurface && visualEditorSurface.innerText.trim());
    if (!rawText) {
      showToast('Please add some lecture notes or transcript text first.', 'warning');
      return;
    }

    const currentSub = state.subjects.find(s => s.id === container.querySelector('#note-subject-field').value);

    openModal(
      'AI Note Organizer & Legal Structurer',
      `
      <div class="space-y-4 text-xs">
        <p class="text-secondary leading-relaxed">
          Transforms messy classroom words, dictation, or raw notes into structured legal notes with Acts, Sections, Definitions, and Ratio Decidendi. Strictly preserves legal facts.
        </p>

        <div>
          <label class="block font-semibold text-primary mb-1">Explanation Depth</label>
          <div class="grid grid-cols-3 gap-2">
            <label class="p-2 border border-rule rounded-lg flex items-center gap-2 cursor-pointer hover:bg-canvas">
              <input type="radio" name="ai-depth" value="concise" ${state.aiMode === 'concise' ? 'checked' : ''}>
              <span>Concise</span>
            </label>
            <label class="p-2 border border-rule rounded-lg flex items-center gap-2 cursor-pointer hover:bg-canvas">
              <input type="radio" name="ai-depth" value="detailed" ${state.aiMode === 'detailed' ? 'checked' : ''}>
              <span>Detailed</span>
            </label>
            <label class="p-2 border border-rule rounded-lg flex items-center gap-2 cursor-pointer hover:bg-canvas">
              <input type="radio" name="ai-depth" value="simple" ${state.aiMode === 'simple' ? 'checked' : ''}>
              <span>Simple Language</span>
            </label>
          </div>
        </div>

        <div>
          <label class="block font-semibold text-primary mb-1">Output Language</label>
          <div class="grid grid-cols-3 gap-2">
            <label class="p-2 border border-rule rounded-lg flex items-center gap-2 cursor-pointer hover:bg-canvas">
              <input type="radio" name="ai-lang" value="bilingual" ${state.outputLang === 'bilingual' ? 'checked' : ''}>
              <span>Bilingual (দ্বিভাষিক)</span>
            </label>
            <label class="p-2 border border-rule rounded-lg flex items-center gap-2 cursor-pointer hover:bg-canvas">
              <input type="radio" name="ai-lang" value="bn" ${state.outputLang === 'bn' ? 'checked' : ''}>
              <span>Bangla (বাংলা)</span>
            </label>
            <label class="p-2 border border-rule rounded-lg flex items-center gap-2 cursor-pointer hover:bg-canvas">
              <input type="radio" name="ai-lang" value="en" ${state.outputLang === 'en' ? 'checked' : ''}>
              <span>English</span>
            </label>
          </div>
        </div>

        <div class="p-3 bg-citation border border-rule rounded-lg text-secondary text-[11px]">
          <strong>Fidelity Guarantee:</strong> LexNote will never fabricate statutory sections or cases. If an Act or Case is not mentioned in your notes, it will be marked as unverified.
        </div>
      </div>
      `,
      async (modalCard) => {
        const selectedDepth = modalCard.querySelector('input[name="ai-depth"]:checked')?.value || 'detailed';
        const selectedLang = modalCard.querySelector('input[name="ai-lang"]:checked')?.value || 'bilingual';

        state.aiMode = selectedDepth;
        state.outputLang = selectedLang;

        showToast('Organizing note with legal structuring engine...', 'info');

        try {
          const result = await organizeLegalNote(rawText, {
            mode: selectedDepth,
            language: selectedLang,
            subjectName: currentSub ? currentSub.name : 'Law Subject',
            topicName: container.querySelector('#note-title-field').value,
            localAiUrl: state.localAiUrl,
            localAiModel: state.localAiModel
          });

          note.structuredNote = result.structuredNote;
          note.summary = result.summary;

          if (markdownTextarea) markdownTextarea.value = result.structuredNote;
          if (visualEditorSurface) visualEditorSurface.innerHTML = markdownToNotionHtml(result.structuredNote);
          if (summaryTextarea) summaryTextarea.value = result.summary;

          if (rawTextarea && !rawTextarea.value.trim()) {
            rawTextarea.value = rawText;
          }

          triggerAutosave();
          showToast('Note structured successfully!', 'success');
          return true;
        } catch (err) {
          showToast(`Error organizing note: ${err.message}`, 'error');
          return false;
        }
      },
      'Organize Now'
    );
  });
}

function createNewNote(preselectedSubjectId = null) {
  const newNote = {
    id: 'note_' + Date.now(),
    title: 'Untitled Law Note',
    subjectId: preselectedSubjectId || state.subjects[0]?.id || 'sub_const',
    semester: '1st Year / 1st Sem',
    chapter: '',
    topic: '',
    lectureNo: `Lecture ${state.notes.length + 1}`,
    lectureDate: new Date().toISOString().split('T')[0],
    rawTranscript: '',
    structuredNote: '',
    summary: '',
    tags: [],
    bookmarked: false
  };

  state.notes.unshift(newNote);
  saveNote(newNote);
  switchView('editor', { noteId: newNote.id });
}

/**
 * Setup Speech Recognition & Dictation Engine
 */
function setupSpeechRecorder() {
  state.speechRecorder = new SpeechRecorder({
    language: state.speechLang,
    onTranscriptUpdate: ({ finalText, interimText, raw }) => {
      const liveTranscriptEl = document.getElementById('voice-live-transcript');
      if (liveTranscriptEl) {
        liveTranscriptEl.innerHTML = finalText + (interimText ? ` <span class="text-secondary italic opacity-75">${interimText}</span>` : '');
      }
      const rawInput = document.getElementById('voice-editable-transcript');
      if (rawInput) {
        rawInput.value = raw;
      }
    },
    onStateChange: ({ status, elapsedSeconds }) => {
      const recBtn = document.getElementById('voice-record-btn');
      const recIndicator = document.getElementById('voice-rec-indicator');
      const timerEl = document.getElementById('voice-timer');

      if (recBtn) {
        if (status === 'recording') {
          recBtn.innerHTML = `
            <svg class="w-4 h-4 fill-current text-white animate-pulse" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
            <span>Stop Recording</span>
          `;
          recBtn.className = 'flex items-center gap-2 px-5 py-2.5 bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold rounded-lg shadow-sm transition-all';
        } else {
          recBtn.innerHTML = `
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
            <span>Start Dictation</span>
          `;
          recBtn.className = 'flex items-center gap-2 px-5 py-2.5 bg-forest hover:bg-forest/90 text-white text-xs font-semibold rounded-lg shadow-sm transition-all';
        }
      }

      if (recIndicator) {
        recIndicator.classList.toggle('hidden', status !== 'recording');
      }

      if (timerEl && elapsedSeconds !== undefined) {
        const mins = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
        const secs = (elapsedSeconds % 60).toString().padStart(2, '0');
        timerEl.textContent = `${mins}:${secs}`;
      }
    },
    onError: (errorInfo) => {
      showToast(`${errorInfo.title}: ${errorInfo.message}`, 'error', 6000);
    },
    onAudioReady: ({ url, durationSeconds }) => {
      state.lastRecordedAudioUrl = url;
      const playerContainer = document.getElementById('voice-audio-player-container');
      const audioEl = document.getElementById('voice-audio-element');
      if (playerContainer && audioEl) {
        audioEl.src = url;
        playerContainer.classList.remove('hidden');
      }
      showToast(`Audio recording completed (${durationSeconds}s)`, 'success');
    }
  });
}

/**
 * View 4: Voice Notes & Dictation Studio
 */
function renderVoiceStudio() {
  const container = els.views.voice;
  const isSpeechApiSupported = SpeechRecorder.isSpeechSupported();

  container.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-rule">
        <div>
          <h1 class="font-serif text-2xl font-bold text-forest">Voice Notes & Dictation Studio</h1>
          <p class="text-xs text-secondary mt-0.5">Record law lectures in Bangla, English, or Banglish with instant transcription and audio playback.</p>
        </div>
        <button id="voice-open-diagnostic" class="text-xs text-forest hover:underline font-medium self-start sm:self-auto">
          Speech & Offline Engine Diagnostics &rarr;
        </button>
      </div>

      <!-- Warning if speech API unavailable in browser -->
      ${!isSpeechApiSupported ? `
        <div class="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200">
          <strong>Browser Notice:</strong> The native Web Speech API is not available in this browser. You can still record audio clips and manually transcribe, or run offline speech recognition using Vosk / whisper.cpp (see setup guide).
        </div>
      ` : ''}

      <!-- Microphone Permission Guidance Alert -->
      <div id="voice-permission-alert" class="hidden p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 rounded-xl space-y-2">
        <div class="flex items-center justify-between">
          <span class="font-semibold text-amber-900 dark:text-amber-200 text-xs flex items-center gap-1.5">
            <svg class="w-4 h-4 text-amber-700 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><line x1="2" x2="22" y1="2" y2="22"/></svg>
            Microphone Access Blocked
          </span>
          <button id="voice-dismiss-perm-btn" class="text-xs text-secondary hover:text-primary">&times;</button>
        </div>
        <p class="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
          Browser denied microphone access. To record lectures:
          <br>1. Click the <strong>lock / site settings icon (🔒)</strong> in the browser address bar.
          <br>2. Set <strong>Microphone</strong> to <strong>Allow</strong>.
          <br>3. Click <strong>"Retry Microphone"</strong> below. Or paste/type classroom notes directly into the editor.
        </p>
        <div class="flex items-center gap-3 pt-1">
          <button id="voice-retry-perm-btn" class="px-3 py-1 bg-forest text-white text-xs font-medium rounded hover:bg-forest/90 transition-colors">
            Retry Microphone
          </button>
        </div>
      </div>

      <!-- Dictation Control Console -->
      <div class="p-6 bg-paper border border-rule rounded-xl space-y-6">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <!-- Language Selector -->
          <div class="flex items-center gap-3">
            <span class="text-xs font-semibold text-secondary">Language:</span>
            <div class="flex items-center p-1 bg-canvas border border-rule rounded-lg text-xs font-medium">
              <button id="voice-lang-bn" class="px-3 py-1 rounded-md transition-colors ${state.speechLang === 'bn-BD' ? 'bg-paper text-primary shadow-xs font-semibold' : 'text-secondary hover:text-primary'}">
                বাংলা (Bangla)
              </button>
              <button id="voice-lang-en" class="px-3 py-1 rounded-md transition-colors ${state.speechLang === 'en-US' ? 'bg-paper text-primary shadow-xs font-semibold' : 'text-secondary hover:text-primary'}">
                English
              </button>
              <button id="voice-lang-mixed" class="px-3 py-1 rounded-md transition-colors ${state.speechLang === 'mixed' ? 'bg-paper text-primary shadow-xs font-semibold' : 'text-secondary hover:text-primary'}">
                Banglish (Bilingual)
              </button>
            </div>
          </div>

          <!-- Timer & Recording Status -->
          <div class="flex items-center gap-3">
            <div id="voice-rec-indicator" class="hidden flex items-center gap-1.5 text-xs text-rose-700 font-semibold animate-pulse">
              <span class="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
              <span>RECORDING</span>
            </div>
            <div id="voice-timer" class="font-mono text-sm font-bold text-forest bg-canvas px-3 py-1 rounded-md border border-rule tabular-nums">
              00:00
            </div>
          </div>
        </div>

        <!-- Live Audio Soundwave Canvas -->
        <div class="h-20 bg-canvas border border-rule rounded-lg overflow-hidden flex items-center justify-center p-2 relative">
          <canvas id="voice-visualizer-canvas" width="600" height="80" class="w-full h-full"></canvas>
        </div>

        <!-- Recording Trigger Buttons -->
        <div class="flex items-center justify-between gap-4 flex-wrap">
          <div class="flex items-center gap-3">
            <button id="voice-record-btn" class="flex items-center gap-2 px-5 py-2.5 bg-forest hover:bg-forest/90 text-white text-xs font-semibold rounded-lg shadow-sm transition-all active:scale-[0.99]">
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
              <span>Start Dictation</span>
            </button>

            <button id="voice-clear-btn" class="px-3.5 py-2 text-xs font-medium text-secondary hover:text-primary rounded-lg border border-rule bg-canvas transition-colors">
              Clear
            </button>
          </div>

          <button id="voice-create-note-btn" class="flex items-center gap-2 px-4 py-2.5 bg-champagne text-forest text-xs font-semibold rounded-lg hover:bg-champagne/80 shadow-xs transition-all">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            <span>Convert Transcript to Law Note</span>
          </button>
        </div>
      </div>

      <!-- Playback Section for Lecture Audio (Shows after recording) -->
      <div id="voice-audio-player-container" class="${state.lastRecordedAudioUrl ? '' : 'hidden'} p-4 bg-paper border border-rule rounded-xl space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-forest">Recorded Classroom Audio Clip</span>
          <span class="text-[11px] text-secondary">Listen back while reviewing transcript</span>
        </div>
        <audio id="voice-audio-element" controls class="w-full h-10 mt-1" src="${state.lastRecordedAudioUrl || ''}"></audio>
      </div>

      <!-- Live Transcript & Uncertainty Editor -->
      <div class="p-6 bg-paper border border-rule rounded-xl space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="font-serif text-base font-bold text-forest">Live Spoken Transcript</h2>
            <p class="text-[11px] text-secondary">Words highlighted in soft amber have lower speech confidence. Click to edit or correct.</p>
          </div>
          <span class="text-[11px] font-mono text-secondary">Auto-retained</span>
        </div>

        <div id="voice-live-transcript" class="min-h-32 p-4 bg-citation border border-rule rounded-lg text-sm leading-relaxed text-primary select-text">
          <span class="text-secondary italic">Your spoken lecture transcript will appear here in real time...</span>
        </div>

        <!-- Editable raw transcript textarea for manual adjustment -->
        <div>
          <label class="block text-xs font-semibold text-secondary mb-1">Manual Transcript Editor (Direct Corrections)</label>
          <textarea id="voice-editable-transcript" rows="6" placeholder="You can freely edit or paste additional lecture notes here..." class="w-full p-3 bg-canvas border border-rule rounded-lg text-xs leading-relaxed text-primary focus:outline-none focus:border-forest"></textarea>
        </div>
      </div>
    </div>
  `;

  const canvas = container.querySelector('#voice-visualizer-canvas');
  const recordBtn = container.querySelector('#voice-record-btn');
  const clearBtn = container.querySelector('#voice-clear-btn');
  const createNoteBtn = container.querySelector('#voice-create-note-btn');
  const editableEl = container.querySelector('#voice-editable-transcript');

  // Language selectors
  const langBtns = {
    'bn-BD': container.querySelector('#voice-lang-bn'),
    'en-US': container.querySelector('#voice-lang-en'),
    'mixed': container.querySelector('#voice-lang-mixed')
  };

  Object.entries(langBtns).forEach(([langKey, btn]) => {
    btn.addEventListener('click', () => {
      state.speechLang = langKey;
      saveSetting('speechLang', langKey);
      state.speechRecorder.setLanguage(langKey);
      renderVoiceStudio();
    });
  });

  // Permission banner dismiss and retry buttons
  const permAlert = container.querySelector('#voice-permission-alert');
  const dismissPermBtn = container.querySelector('#voice-dismiss-perm-btn');
  const retryPermBtn = container.querySelector('#voice-retry-perm-btn');

  if (dismissPermBtn && permAlert) {
    dismissPermBtn.addEventListener('click', () => permAlert.classList.add('hidden'));
  }

  const triggerRecordingStart = async () => {
    if (!state.speechRecorder.isRecording) {
      const res = await state.speechRecorder.startRecording(canvas);
      if (res && res.success === false) {
        if (permAlert) permAlert.classList.remove('hidden');
      } else {
        if (permAlert) permAlert.classList.add('hidden');
      }
    } else {
      state.speechRecorder.stopRecording();
    }
  };

  if (retryPermBtn) {
    retryPermBtn.addEventListener('click', triggerRecordingStart);
  }

  // Record / Stop click
  recordBtn.addEventListener('click', triggerRecordingStart);

  // Clear click
  clearBtn.addEventListener('click', () => {
    state.speechRecorder.clearTranscript();
    editableEl.value = '';
    container.querySelector('#voice-live-transcript').innerHTML = '<span class="text-secondary italic">Cleared. Ready to record...</span>';
  });

  // Convert to Law Note
  createNoteBtn.addEventListener('click', () => {
    const text = editableEl.value.trim() || state.speechRecorder.finalTranscript.trim();
    if (!text) {
      showToast('Please record or enter lecture text first.', 'warning');
      return;
    }

    // Create note with raw transcript populated
    const newNote = {
      id: 'note_' + Date.now(),
      title: 'Voice Lecture Note (' + new Date().toLocaleDateString('en-GB') + ')',
      subjectId: state.subjects[0]?.id || 'sub_const',
      semester: '1st Year / 1st Sem',
      chapter: '',
      topic: '',
      lectureNo: `Lecture ${state.notes.length + 1}`,
      lectureDate: new Date().toISOString().split('T')[0],
      sourceType: 'voice',
      audioDuration: container.querySelector('#voice-timer').textContent,
      rawTranscript: text,
      structuredNote: '',
      summary: '',
      tags: ['Voice Note', state.speechLang],
      bookmarked: false
    };

    state.notes.unshift(newNote);
    saveNote(newNote);
    switchView('editor', { noteId: newNote.id });
    showToast('Voice lecture transferred to notebook editor!', 'success');
  });

  // Click on uncertain word to edit inline
  container.querySelector('#voice-live-transcript').addEventListener('click', (e) => {
    const target = e.target.closest('.uncertain-word');
    if (!target) return;
    const oldWord = target.dataset.word || target.textContent;
    const newWord = prompt('Edit speech recognized word:', oldWord);
    if (newWord !== null && newWord.trim() !== '') {
      target.textContent = newWord.trim();
      target.classList.remove('uncertain-word');
      // Update textarea
      editableEl.value = container.querySelector('#voice-live-transcript').innerText;
    }
  });

  // Open Diagnostic modal
  container.querySelector('#voice-open-diagnostic').addEventListener('click', () => {
    openSpeechDiagnosticModal();
  });
}

function openSpeechDiagnosticModal() {
  openModal(
    'Speech & Offline AI Diagnostic Guide',
    `
    <div class="space-y-4 text-xs leading-relaxed">
      <div>
        <h4 class="font-bold text-forest text-sm mb-1">1. Native Browser Speech Recognition</h4>
        <p class="text-secondary">
          LexNote uses the standardized <strong>Web Speech API</strong>, which runs 100% free of charge directly in modern browsers (Google Chrome, Microsoft Edge, Safari). Chrome and Edge include native support for <strong>Bangla (bn-BD)</strong> and <strong>English (en-US, en-GB)</strong>.
        </p>
      </div>

      <div class="p-3 bg-citation border border-rule rounded-lg">
        <h4 class="font-bold text-forest mb-1">2. Completely Offline Speech with Vosk / whisper.cpp</h4>
        <p class="text-secondary mb-2">
          If you are in an air-gapped environment without any internet connection, you can process audio files using free, open-source local offline speech engines:
        </p>
        <div class="font-mono bg-paper p-2.5 rounded border border-rule space-y-1 text-[11px]">
          <div># Option A: Vosk Offline Bangla & English</div>
          <div>pip install vosk sounddevice</div>
          <div># Download free Bangla model: vosk-model-bn-0.42</div>
          <div>python -m vosk.transcribe lecture.wav</div>
          <div class="pt-1"># Option B: whisper.cpp (Ultra-fast C/C++ offline Whisper)</div>
          <div>git clone https://github.com/ggerganov/whisper.cpp</div>
          <div>./main -m models/ggml-small.bin -f lecture.wav -l bn</div>
        </div>
      </div>

      <div>
        <h4 class="font-bold text-forest text-sm mb-1">3. Privacy Guarantee</h4>
        <p class="text-secondary">
          All audio recorded via LexNote stays in your local browser memory (IndexedDB Blobs). No lecture recordings or student notes are ever sent to third-party subscription servers or monetized endpoints.
        </p>
      </div>
    </div>
    `
  );
}

/**
 * View 5: Document Import & Free OCR
 */
function renderDocuments() {
  const container = els.views.documents;

  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-rule">
        <div>
          <h1 class="font-serif text-2xl font-bold text-forest">Document Import & Free OCR</h1>
          <p class="text-xs text-secondary mt-0.5">Extract text from course syllabus PDFs, Acts, scanned judicial reports, and lecture handouts.</p>
        </div>
      </div>

      <!-- Upload Zone -->
      <div id="doc-drop-zone" class="p-8 bg-paper hover:bg-card-hover border-2 border-dashed border-rule rounded-xl text-center cursor-pointer transition-colors relative">
        <input type="file" id="doc-file-input" accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp" class="absolute inset-0 opacity-0 cursor-pointer">
        <div class="space-y-2 pointer-events-none">
          <div class="w-12 h-12 mx-auto rounded-full bg-canvas flex items-center justify-center text-forest">
            <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
          </div>
          <h3 class="font-serif text-base font-bold text-forest">Click or Drag & Drop Law Documents Here</h3>
          <p class="text-xs text-secondary">Supports PDF (.pdf), Text (.txt, .md), and Scanned Photos (.jpg, .png, .webp) up to 25 MB.</p>
          <div class="text-[11px] text-forest font-medium">100% Free Client-Side PDF.js & Tesseract.js (English & Bengali OCR)</div>
        </div>
      </div>

      <!-- Extraction Progress Bar (Hidden by default) -->
      <div id="doc-progress-container" class="hidden p-4 bg-paper border border-rule rounded-xl space-y-2">
        <div class="flex items-center justify-between text-xs font-semibold">
          <span id="doc-progress-msg" class="text-forest">Extracting legal text...</span>
          <span id="doc-progress-pct" class="font-mono text-secondary">0%</span>
        </div>
        <div class="w-full bg-canvas h-2 rounded-full overflow-hidden border border-rule">
          <div id="doc-progress-bar" class="h-full bg-forest rounded-full transition-all duration-200" style="width: 0%"></div>
        </div>
      </div>

      <!-- Extracted Text Workspace (Hidden until file parsed) -->
      <div id="doc-extracted-workspace" class="hidden p-6 bg-paper border border-rule rounded-xl space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-rule">
          <div>
            <h2 id="doc-extracted-title" class="font-serif text-lg font-bold text-forest">Document Preview</h2>
            <div id="doc-extracted-meta" class="text-xs text-secondary mt-0.5"></div>
          </div>
          <div class="flex items-center gap-2">
            <button id="doc-save-as-note-btn" class="px-4 py-2 bg-forest text-white text-xs font-semibold rounded-lg hover:bg-forest/90 transition-all shadow-xs">
              Convert to Law Note
            </button>
            <button id="doc-save-library-btn" class="px-3.5 py-2 bg-paper border border-rule text-primary text-xs font-medium rounded-lg hover:bg-canvas transition-colors">
              Save in Documents
            </button>
          </div>
        </div>

        <textarea id="doc-extracted-text" rows="12" class="w-full p-4 bg-canvas border border-rule rounded-lg text-sm font-sans leading-relaxed text-primary focus:outline-none focus:border-forest"></textarea>
      </div>

      <!-- Previously Saved Documents Library -->
      <div class="space-y-4">
        <h2 class="font-serif text-lg font-bold text-forest">Imported Law Documents</h2>
        ${state.documents.length === 0 ? `
          <div class="p-8 text-center bg-paper border border-rule rounded-xl">
            <p class="text-xs text-secondary">No documents uploaded yet. Upload course handouts or judgments above.</p>
          </div>
        ` : `
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            ${state.documents.map(doc => `
              <div class="p-4 bg-paper hover:bg-card-hover border border-rule rounded-xl transition-all space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div class="space-y-0.5">
                    <h3 class="font-serif text-base font-semibold text-primary truncate">${escape(doc.name)}</h3>
                    <div class="text-[11px] text-secondary flex items-center gap-1">
                      <span class="uppercase">${escape(doc.type)}</span>
                      <span class="meta-sep"></span>
                      <span>${doc.pageCount || 1} pages</span>
                      <span class="meta-sep"></span>
                      <span>${formatFriendlyDate(doc.createdAt)}</span>
                    </div>
                  </div>
                  <button data-delete-doc-id="${doc.id}" class="text-secondary hover:text-rose-700 p-1" title="Delete document">
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
                <p class="text-xs text-secondary line-clamp-2">${escape(doc.extractedText)}</p>
                <div class="pt-2 flex items-center justify-between text-xs">
                  <button data-use-doc-id="${doc.id}" class="text-xs font-semibold text-forest hover:underline">Use in Law Note &rarr;</button>
                </div>
              </div>
            `).join('')}
          </div>
        `}
      </div>
    </div>
  `;

  const dropZone = container.querySelector('#doc-drop-zone');
  const fileInput = container.querySelector('#doc-file-input');
  const progressContainer = container.querySelector('#doc-progress-container');
  const progressMsg = container.querySelector('#doc-progress-msg');
  const progressPct = container.querySelector('#doc-progress-pct');
  const progressBar = container.querySelector('#doc-progress-bar');
  const workspace = container.querySelector('#doc-extracted-workspace');
  const textEl = container.querySelector('#doc-extracted-text');
  const titleEl = container.querySelector('#doc-extracted-title');
  const metaEl = container.querySelector('#doc-extracted-meta');

  let currentParsedDoc = null;

  const handleFile = async (file) => {
    try {
      validateUploadedFile(file);
    } catch (err) {
      showToast(err.message, 'error', 5000);
      return;
    }

    progressContainer.classList.remove('hidden');
    workspace.classList.add('hidden');

    try {
      const result = await extractTextFromFile(file, ({ progress, message }) => {
        progressBar.style.width = `${progress}%`;
        progressPct.textContent = `${progress}%`;
        progressMsg.textContent = message;
      });

      currentParsedDoc = result;

      // Populate preview
      titleEl.textContent = result.fileName;
      metaEl.textContent = `Extracted ${result.pageCount} page(s) · Type: ${result.fileType.toUpperCase()}`;
      textEl.value = result.text;

      progressContainer.classList.add('hidden');
      workspace.classList.remove('hidden');

      showToast(`Document "${result.fileName}" parsed successfully!`, 'success');
    } catch (err) {
      progressContainer.classList.add('hidden');
      showToast(`Extraction error: ${err.message}`, 'error', 6000);
    }
  };

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  });

  // Convert to note
  container.querySelector('#doc-save-as-note-btn')?.addEventListener('click', () => {
    if (!currentParsedDoc) return;
    const newNote = {
      id: 'note_' + Date.now(),
      title: currentParsedDoc.fileName.replace(/\.[^/.]+$/, ''),
      subjectId: state.subjects[0]?.id || 'sub_const',
      semester: '1st Year / 1st Sem',
      chapter: '',
      topic: 'Document Import',
      lectureNo: 'Handout',
      lectureDate: new Date().toISOString().split('T')[0],
      sourceType: 'ocr',
      rawTranscript: currentParsedDoc.text,
      structuredNote: '',
      summary: '',
      tags: ['Document', currentParsedDoc.fileType],
      bookmarked: false
    };

    state.notes.unshift(newNote);
    saveNote(newNote);
    switchView('editor', { noteId: newNote.id });
  });

  // Save in Document Store
  container.querySelector('#doc-save-library-btn')?.addEventListener('click', async () => {
    if (!currentParsedDoc) return;
    await saveDocument({
      name: currentParsedDoc.fileName,
      type: currentParsedDoc.fileType,
      pageCount: currentParsedDoc.pageCount,
      extractedText: textEl.value
    });
    await refreshStateData();
    renderDocuments();
    showToast('Document saved in library!', 'success');
  });

  // Delete document
  container.querySelectorAll('[data-delete-doc-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteDocId;
      await deleteDocument(id);
      await refreshStateData();
      renderDocuments();
      showToast('Document removed', 'info');
    });
  });

  // Use document in new note
  container.querySelectorAll('[data-use-doc-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.useDocId;
      const doc = state.documents.find(d => d.id === id);
      if (doc) {
        const newNote = {
          id: 'note_' + Date.now(),
          title: doc.name.replace(/\.[^/.]+$/, ''),
          subjectId: state.subjects[0]?.id || 'sub_const',
          semester: '1st Year / 1st Sem',
          chapter: '',
          topic: 'Document',
          lectureNo: 'Reading',
          lectureDate: new Date().toISOString().split('T')[0],
          sourceType: 'ocr',
          rawTranscript: doc.extractedText,
          structuredNote: '',
          summary: '',
          tags: ['Document', doc.type],
          bookmarked: false
        };
        state.notes.unshift(newNote);
        saveNote(newNote);
        switchView('editor', { noteId: newNote.id });
      }
    });
  });
}

/**
 * View 6: Ask My Notebook (Grounded Local RAG Search)
 */
function renderAskMyNotebook(initialQuery = '') {
  const container = els.views.ask;

  container.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div class="pb-4 border-b border-rule">
        <h1 class="font-serif text-2xl font-bold text-forest">Ask My Notebook</h1>
        <p class="text-xs text-secondary mt-0.5">
          Ask questions across your lecture notes, imported documents, and FIRAC case briefs. Supports Bangla and English.
        </p>
      </div>

      <!-- Search / Ask Input -->
      <div class="p-5 bg-paper border border-rule rounded-xl space-y-3">
        <div class="relative">
          <input type="text" id="ask-input" value="${escape(initialQuery)}" placeholder="e.g. Explain Article 102 writ jurisdiction, or What are the essentials of Section 10 Contract Act?" class="w-full pl-4 pr-24 py-3 bg-canvas border border-rule rounded-lg text-sm text-primary focus:outline-none focus:border-forest font-sans">
          <button id="ask-submit-btn" class="absolute right-2 top-2 px-4 py-1.5 bg-forest text-white text-xs font-semibold rounded-md hover:bg-forest/90 transition-all shadow-xs">
            Ask Note
          </button>
        </div>

        <!-- LLB Quick Query Chips (Interactive Buttons per constitution) -->
        <div class="flex items-center gap-1.5 flex-wrap text-xs text-secondary pt-1">
          <span class="font-semibold text-secondary">Quick Questions:</span>
          <button class="quick-ask-chip px-2.5 py-1 bg-canvas hover:bg-card-hover border border-rule rounded text-[11px] text-primary transition-colors">
            Article 102 Writs
          </button>
          <button class="quick-ask-chip px-2.5 py-1 bg-canvas hover:bg-card-hover border border-rule rounded text-[11px] text-primary transition-colors">
            Section 10 Contract Act
          </button>
          <button class="quick-ask-chip px-2.5 py-1 bg-canvas hover:bg-card-hover border border-rule rounded text-[11px] text-primary transition-colors">
            Negligence & Donoghue v Stevenson
          </button>
          <button class="quick-ask-chip px-2.5 py-1 bg-canvas hover:bg-card-hover border border-rule rounded text-[11px] text-primary transition-colors">
            Locus Standi & PIL
          </button>
        </div>
      </div>

      <!-- Grounded Answer Result Container -->
      <div id="ask-result-container" class="space-y-4">
        <!-- Results injected here -->
      </div>
    </div>
  `;

  const inputEl = container.querySelector('#ask-input');
  const submitBtn = container.querySelector('#ask-submit-btn');
  const resultContainer = container.querySelector('#ask-result-container');

  const executeAsk = (query) => {
    if (!query || !query.trim()) {
      showToast('Please enter a legal query.', 'warning');
      return;
    }

    const { answer, citations, hasVerifiedMatch } = queryMyNotebook(
      query,
      state.notes,
      state.documents,
      state.research
    );

    resultContainer.innerHTML = `
      <div class="p-6 bg-paper border border-rule rounded-xl space-y-4">
        <div class="flex items-center justify-between pb-3 border-b border-rule">
          <div class="flex items-center gap-2">
            <span class="inline-block w-2.5 h-2.5 rounded-full ${hasVerifiedMatch ? 'bg-forest' : 'bg-amber-500'}"></span>
            <span class="text-xs font-semibold uppercase tracking-wider ${hasVerifiedMatch ? 'text-forest' : 'text-amber-800'}">
              ${hasVerifiedMatch ? 'Verified from Your Notebook' : 'No Saved Authority Found'}
            </span>
          </div>
          <span class="text-[11px] text-secondary font-mono">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>

        <div class="text-sm leading-relaxed text-primary whitespace-pre-line space-y-2 font-sans">
          ${escape(answer)}
        </div>

        ${citations.length > 0 ? `
          <div class="pt-4 mt-4 border-t border-rule space-y-2">
            <h4 class="text-xs font-semibold uppercase tracking-wider text-secondary">Verified Supporting Sources</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              ${citations.map(c => `
                <div class="p-2.5 bg-citation border border-rule rounded-lg text-xs flex items-center justify-between">
                  <div class="truncate mr-2">
                    <div class="font-semibold text-primary truncate">${escape(c.title)}</div>
                    <div class="text-[10px] text-secondary truncate">${escape(c.type)} · ${escape(c.context)}</div>
                  </div>
                  <button data-cite-id="${c.id}" class="cite-open-btn text-forest hover:underline font-semibold shrink-0">View &rarr;</button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;

    resultContainer.querySelectorAll('.cite-open-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.citeId;
        const foundNote = state.notes.find(n => n.id === id);
        if (foundNote) {
          switchView('editor', { noteId: id });
        } else {
          switchView('library');
        }
      });
    });
  };

  submitBtn.addEventListener('click', () => executeAsk(inputEl.value));
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') executeAsk(inputEl.value);
  });

  container.querySelectorAll('.quick-ask-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      inputEl.value = chip.textContent.trim();
      executeAsk(inputEl.value);
    });
  });

  if (initialQuery) {
    executeAsk(initialQuery);
  }
}

/**
 * View 7: Legal Research & FIRAC Case Briefs
 */
function renderResearch() {
  const container = els.views.research;

  container.innerHTML = `
    <div class="max-w-5xl mx-auto space-y-6">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-rule">
        <div>
          <h1 class="font-serif text-2xl font-bold text-forest">Case Briefs & Legal Research</h1>
          <p class="text-xs text-secondary mt-0.5">Structure case analysis using the FIRAC method: Facts, Issues, Ruling, Reasoning (Ratio), and Legal Principle.</p>
        </div>
        <button id="res-new-btn" class="flex items-center gap-2 px-3.5 py-2 bg-forest text-white text-xs font-semibold rounded-lg hover:bg-forest/90 shadow-sm transition-all self-start sm:self-auto">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          <span>New FIRAC Brief</span>
        </button>
      </div>

      <!-- Search cases -->
      <div class="relative w-full max-w-md">
        <input type="search" id="res-search-input" placeholder="Search case law by name, citation, or legal ratio..." class="w-full pl-8 pr-3 py-1.5 text-xs bg-paper border border-rule rounded-md focus:outline-none focus:border-forest text-primary">
        <svg class="w-3.5 h-3.5 text-secondary absolute left-2.5 top-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      </div>

      <!-- Case Briefs List -->
      <div id="res-list-container" class="space-y-4">
        ${state.research.map(item => `
          <div class="p-6 bg-paper border border-rule rounded-xl space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-3 border-b border-rule">
              <div>
                <div class="flex items-center gap-2 flex-wrap mb-1">
                  <h3 class="font-serif text-lg font-bold text-forest">${escape(item.title)}</h3>
                  <span class="text-xs font-mono px-2 py-0.5 rounded ${item.verified ? 'bg-forest/10 text-forest font-semibold' : 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300'}">
                    ${item.verified ? '✓ Official Report' : 'Draft / Unverified'}
                  </span>
                </div>
                <!-- Unboxed metadata -->
                <div class="text-xs text-secondary flex items-center flex-wrap gap-1">
                  <span class="font-mono font-medium">${escape(item.citation || 'Unreported')}</span>
                  <span class="meta-sep"></span>
                  <span>${escape(item.court || 'Court of Record')}</span>
                  ${item.year ? `<span class="meta-sep"></span><span class="font-mono">${escape(item.year)}</span>` : ''}
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <button data-edit-res-id="${item.id}" class="text-xs font-semibold text-forest hover:underline">Edit</button>
                <button data-delete-res-id="${item.id}" class="text-secondary hover:text-rose-700 p-1" title="Delete brief">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              </div>
            </div>

            <!-- FIRAC Breakdown Grid -->
            <div class="space-y-3 text-xs leading-relaxed">
              <div>
                <strong class="text-forest uppercase text-[11px] tracking-wider block mb-0.5">Facts of the Case (F):</strong>
                <p class="text-primary">${escape(item.facts)}</p>
              </div>

              <div>
                <strong class="text-forest uppercase text-[11px] tracking-wider block mb-0.5">Legal Issues & Questions (I):</strong>
                <p class="text-primary">${escape(item.issues)}</p>
              </div>

              <div>
                <strong class="text-forest uppercase text-[11px] tracking-wider block mb-0.5">Ruling & Decision (R):</strong>
                <p class="text-primary font-medium">${escape(item.decision)}</p>
              </div>

              <div class="p-3 bg-citation border border-rule rounded-lg">
                <strong class="text-forest uppercase text-[11px] tracking-wider block mb-0.5">Ratio Decidendi / Reasoning (A):</strong>
                <p class="text-primary italic">${escape(item.reasoning)}</p>
              </div>

              <div class="p-3 bg-callout border border-rule rounded-lg">
                <strong class="text-forest uppercase text-[11px] tracking-wider block mb-0.5">Legal Principle / Takeaway (C):</strong>
                <p class="text-primary font-medium">${escape(item.principle)}</p>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  // Attach Handlers
  container.querySelector('#res-new-btn').addEventListener('click', () => openFiracEditorModal());

  container.querySelectorAll('[data-edit-res-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.editResId;
      const item = state.research.find(r => r.id === id);
      if (item) openFiracEditorModal(item);
    });
  });

  container.querySelectorAll('[data-delete-res-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.deleteResId;
      await deleteResearchItem(id);
      await refreshStateData();
      renderResearch();
      showToast('FIRAC brief deleted', 'info');
    });
  });
}

function openFiracEditorModal(existing = null) {
  const isEdit = !!existing;
  const data = existing || {
    title: '',
    citation: '',
    court: 'Supreme Court of Bangladesh',
    year: '2026',
    actName: '',
    sectionNumber: '',
    facts: '',
    issues: '',
    decision: '',
    reasoning: '',
    principle: '',
    verified: true
  };

  openModal(
    isEdit ? 'Edit Case Brief' : 'New FIRAC Case Brief',
    `
    <div class="space-y-3 text-xs">
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block font-semibold text-secondary mb-1">Case Name</label>
          <input type="text" id="firac-title" value="${escape(data.title)}" placeholder="e.g. Carlill v Carbolic Smoke Ball" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
        <div>
          <label class="block font-semibold text-secondary mb-1">Citation</label>
          <input type="text" id="firac-citation" value="${escape(data.citation)}" placeholder="e.g. 49 DLR (AD) 1" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="block font-semibold text-secondary mb-1">Court</label>
          <input type="text" id="firac-court" value="${escape(data.court)}" placeholder="e.g. Appellate Division / House of Lords" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
        <div>
          <label class="block font-semibold text-secondary mb-1">Year</label>
          <input type="text" id="firac-year" value="${escape(data.year)}" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
      </div>

      <div>
        <label class="block font-semibold text-secondary mb-1">Facts of the Case (F)</label>
        <textarea id="firac-facts" rows="3" class="w-full p-2 bg-canvas border border-rule rounded-md text-primary">${escape(data.facts)}</textarea>
      </div>

      <div>
        <label class="block font-semibold text-secondary mb-1">Legal Issues (I)</label>
        <textarea id="firac-issues" rows="2" class="w-full p-2 bg-canvas border border-rule rounded-md text-primary">${escape(data.issues)}</textarea>
      </div>

      <div>
        <label class="block font-semibold text-secondary mb-1">Decision / Ruling (R)</label>
        <textarea id="firac-decision" rows="2" class="w-full p-2 bg-canvas border border-rule rounded-md text-primary">${escape(data.decision)}</textarea>
      </div>

      <div>
        <label class="block font-semibold text-secondary mb-1">Ratio Decidendi / Reasoning (A)</label>
        <textarea id="firac-reasoning" rows="3" class="w-full p-2 bg-canvas border border-rule rounded-md text-primary">${escape(data.reasoning)}</textarea>
      </div>

      <div>
        <label class="block font-semibold text-secondary mb-1">Legal Principle (C)</label>
        <textarea id="firac-principle" rows="2" class="w-full p-2 bg-canvas border border-rule rounded-md text-primary">${escape(data.principle)}</textarea>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <input type="checkbox" id="firac-verified" ${data.verified ? 'checked' : ''} class="rounded text-forest">
        <label for="firac-verified" class="text-xs text-primary">Verified with Official Law Report / Gazette</label>
      </div>
    </div>
    `,
    async (modalCard) => {
      const title = modalCard.querySelector('#firac-title').value.trim();
      if (!title) {
        showToast('Please enter a case name.', 'warning');
        return false;
      }

      const itemToSave = {
        ...data,
        title,
        citation: modalCard.querySelector('#firac-citation').value.trim(),
        court: modalCard.querySelector('#firac-court').value.trim(),
        year: modalCard.querySelector('#firac-year').value.trim(),
        facts: modalCard.querySelector('#firac-facts').value.trim(),
        issues: modalCard.querySelector('#firac-issues').value.trim(),
        decision: modalCard.querySelector('#firac-decision').value.trim(),
        reasoning: modalCard.querySelector('#firac-reasoning').value.trim(),
        principle: modalCard.querySelector('#firac-principle').value.trim(),
        verified: modalCard.querySelector('#firac-verified').checked
      };

      await saveResearchItem(itemToSave);
      await refreshStateData();
      renderResearch();
      showToast('FIRAC brief saved successfully', 'success');
      return true;
    },
    'Save Brief'
  );
}

/**
 * View 8: Legal Terminology Dictionary (120+ Terms)
 */
function renderDictionary() {
  const container = els.views.dictionary;

  let query = '';
  let field = state.dictionaryFilter || 'all';

  const renderList = () => {
    const results = searchDictionary(query, field);

    container.innerHTML = `
      <div class="max-w-5xl mx-auto space-y-6">
        <!-- Header -->
        <div class="pb-4 border-b border-rule">
          <h1 class="font-serif text-2xl font-bold text-forest">English–Bangla Legal Dictionary</h1>
          <p class="text-xs text-secondary mt-0.5">Authoritative terminology lexicon covering Constitutional Law, Contract, Tort, Penal Code, Muslim Law, Land Law, and Civil Procedure.</p>
        </div>

        <!-- Search & Filter Ribbon -->
        <div class="space-y-3">
          <div class="relative">
            <input type="search" id="dict-search-input" value="${escape(query)}" placeholder="Search by English term, Bangla (e.g. হেবিয়াস কর্পাস), or section number..." class="w-full pl-9 pr-4 py-2.5 bg-paper border border-rule rounded-lg text-xs text-primary focus:outline-none focus:border-forest font-sans">
            <svg class="w-4 h-4 text-secondary absolute left-3 top-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </div>

          <!-- Branch Filter Tabs (Functional segmented buttons per constitution) -->
          <div class="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-medium">
            ${[
              { key: 'all', label: 'All Branches' },
              { key: 'Constitutional', label: 'Constitutional' },
              { key: 'Criminal', label: 'Criminal / Penal' },
              { key: 'Contract', label: 'Contract Law' },
              { key: 'Tort', label: 'Tort Law' },
              { key: 'Muslim', label: 'Muslim Law' },
              { key: 'Labour', label: 'Labour Law' },
              { key: 'Land', label: 'Land Law' },
              { key: 'Banking', label: 'Banking' }
            ].map(tab => `
              <button data-field-tab="${tab.key}" class="dict-tab-btn px-3 py-1.5 rounded-md whitespace-nowrap transition-colors ${
                field === tab.key ? 'bg-forest text-white shadow-xs font-semibold' : 'bg-paper text-secondary hover:text-primary border border-rule'
              }">
                ${tab.label}
              </button>
            `).join('')}
          </div>
        </div>

        <!-- Terms Results Count -->
        <div class="text-xs text-secondary font-mono">
          Showing ${results.length} legal terms
        </div>

        <!-- Dictionary Cards Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          ${results.map(item => `
            <div class="p-5 bg-paper border border-rule rounded-xl space-y-3 transition-all hover:bg-card-hover">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h3 class="font-serif text-lg font-bold text-forest">${escape(item.term)}</h3>
                  <div class="text-sm font-bangla font-semibold text-primary mt-0.5">${escape(item.termBn)}</div>
                  <div class="text-[11px] text-secondary font-mono">${escape(item.transliteration)}</div>
                </div>
                <button data-copy-term="${escape(item.term)} - ${escape(item.termBn)}" class="copy-term-btn p-1 text-secondary hover:text-forest transition-colors" title="Copy Term">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </button>
              </div>

              <div class="space-y-2 text-xs leading-relaxed">
                <div>
                  <span class="font-semibold text-secondary text-[11px] uppercase">English: </span>
                  <span class="text-primary">${escape(item.definitionEn)}</span>
                </div>
                <div class="font-bangla">
                  <span class="font-semibold text-secondary text-[11px] uppercase">বাংলা: </span>
                  <span class="text-primary">${escape(item.definitionBn)}</span>
                </div>
              </div>

              ${item.statutoryReference ? `
                <div class="pt-2 mt-2 border-t border-rule text-[11px] text-secondary flex items-center gap-1.5">
                  <span class="font-semibold text-forest">Statute / Case:</span>
                  <span class="font-mono text-primary truncate">${escape(item.statutoryReference)}</span>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
    `;

    // Handlers
    const searchInput = container.querySelector('#dict-search-input');
    searchInput.addEventListener('input', (e) => {
      query = e.target.value;
      renderList();
    });

    container.querySelectorAll('.dict-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        field = btn.dataset.fieldTab;
        state.dictionaryFilter = field;
        renderList();
      });
    });

    container.querySelectorAll('.copy-term-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const text = btn.dataset.copyTerm;
        navigator.clipboard.writeText(text);
        showToast('Legal term copied to clipboard', 'success', 2000);
      });
    });
  };

  renderList();
}

/**
 * View 9: Settings, Local AI Setup & Backup/Sync
 */
function renderSettings() {
  const container = els.views.settings;

  container.innerHTML = `
    <div class="max-w-4xl mx-auto space-y-6">
      <!-- Header -->
      <div class="pb-4 border-b border-rule">
        <h1 class="font-serif text-2xl font-bold text-forest">Notebook Settings & Offline Sync</h1>
        <p class="text-xs text-secondary mt-0.5">Manage storage, theme, local AI models, and complete notebook backups.</p>
      </div>

      <!-- Theme & Display Preferences -->
      <div class="p-6 bg-paper border border-rule rounded-xl space-y-4">
        <h2 class="font-serif text-base font-bold text-forest">Theme & Aesthetic</h2>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs font-semibold text-primary">Interface Theme</div>
            <div class="text-[11px] text-secondary">Switch between Warm Ivory and Dark Scholar theme.</div>
          </div>
          <button id="settings-theme-btn" class="px-4 py-2 border border-rule rounded-lg text-xs font-medium bg-canvas hover:bg-card-hover transition-colors">
            ${state.theme === 'dark' ? '☀️ Switch to Warm Ivory (Light)' : '🌙 Switch to Dark Scholar'}
          </button>
        </div>
      </div>

      <!-- Optional Local AI (Ollama) Settings -->
      <div class="p-6 bg-paper border border-rule rounded-xl space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-serif text-base font-bold text-forest">Local AI Engine (Optional)</h2>
          <span class="text-xs font-mono text-forest">100% Free & Private</span>
        </div>
        <p class="text-xs text-secondary leading-relaxed">
          LexNote includes a <strong>built-in deterministic legal parser</strong> that organizes notes without any external dependencies. If you also have Ollama installed locally on your computer, LexNote can connect to it directly via localhost.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label class="block font-semibold text-secondary mb-1">Local Ollama Endpoint</label>
            <input type="text" id="settings-ai-url" value="${escape(state.localAiUrl)}" placeholder="http://localhost:11434" class="w-full px-3 py-1.5 bg-canvas border border-rule rounded-md text-primary">
          </div>
          <div>
            <label class="block font-semibold text-secondary mb-1">Ollama Model Name</label>
            <input type="text" id="settings-ai-model" value="${escape(state.localAiModel)}" placeholder="llama3 / mistral / qwen2.5" class="w-full px-3 py-1.5 bg-canvas border border-rule rounded-md text-primary">
          </div>
        </div>

        <div class="flex items-center gap-3 pt-2">
          <button id="settings-save-ai-btn" class="px-4 py-2 bg-forest text-white text-xs font-semibold rounded-lg hover:bg-forest/90 transition-all shadow-xs">
            Save AI Settings
          </button>
          <button id="settings-test-ai-btn" class="px-3.5 py-2 border border-rule bg-canvas text-primary text-xs font-medium rounded-lg hover:bg-card-hover transition-colors">
            Test Local Connection
          </button>
          <span id="settings-ai-status" class="text-xs text-secondary"></span>
        </div>
      </div>

      <!-- Full Data Backup & Restore -->
      <div class="p-6 bg-paper border border-rule rounded-xl space-y-4">
        <h2 class="font-serif text-base font-bold text-forest">Data Backup & Cross-Device Sync</h2>
        <p class="text-xs text-secondary leading-relaxed">
          Your law notes, subjects, and case briefs are saved locally in your browser's IndexedDB. Download a full JSON backup to transfer your notebook to another laptop or keep safe offline.
        </p>

        <div class="flex items-center gap-3 flex-wrap pt-2">
          <button id="settings-backup-export" class="flex items-center gap-2 px-4 py-2 bg-forest text-white text-xs font-semibold rounded-lg hover:bg-forest/90 transition-all shadow-xs">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            <span>Download Full Backup (JSON)</span>
          </button>

          <label class="flex items-center gap-2 px-4 py-2 border border-rule bg-canvas hover:bg-card-hover text-primary text-xs font-semibold rounded-lg cursor-pointer transition-colors">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
            <span>Restore from Backup File</span>
            <input type="file" id="settings-backup-import" accept=".json" class="hidden">
          </label>
        </div>
      </div>

      <!-- Project Source Code Package (.ZIP) -->
      <div class="p-6 bg-paper border border-forest/30 rounded-xl space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="font-serif text-base font-bold text-forest">Complete Project Source Code (.ZIP)</h2>
          <span class="px-2 py-0.5 text-[10px] font-mono bg-forest/10 text-forest rounded border border-forest/20">Ready to Run</span>
        </div>
        <p class="text-xs text-secondary leading-relaxed">
          Download the entire source code archive of this Law Notebook Editor. Contains all frontend modules, Notion-style legal editor, IndexedDB database logic, Web Speech dictation, PDF OCR engine, Legal Dictionary, PWA assets, and Vite dev server.
        </p>

        <div class="flex items-center gap-3 pt-1">
          <a href="/law-notebook-editor.zip" download="law-notebook-editor.zip" class="flex items-center gap-2 px-4 py-2.5 bg-forest text-white text-xs font-semibold rounded-lg hover:bg-forest/90 transition-all shadow-sm">
            <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            <span>Download All Files in ZIP format (law-notebook-editor.zip)</span>
          </a>
        </div>

        <div class="p-3 bg-canvas border border-rule rounded-lg text-xs space-y-1 font-mono text-secondary">
          <div class="font-semibold text-primary font-sans text-xs mb-1">Quick local setup:</div>
          <div>1. Unzip <span class="text-forest font-semibold">law-notebook-editor.zip</span></div>
          <div>2. Run <span class="text-forest font-semibold">npm install</span></div>
          <div>3. Run <span class="text-forest font-semibold">npm run dev</span></div>
          <div>4. Open <span class="text-forest font-semibold">http://localhost:3000</span></div>
        </div>
      </div>

      <!-- Reset & Clear -->
      <div class="p-6 bg-paper border border-rose-200 dark:border-rose-950 rounded-xl space-y-3">
        <h2 class="font-serif text-base font-bold text-rose-800 dark:text-rose-400">Danger Zone</h2>
        <p class="text-xs text-secondary">Reset the database to initial pre-seeded sample LLB curriculum data.</p>
        <button id="settings-reset-db-btn" class="px-4 py-2 bg-rose-800 text-white text-xs font-medium rounded-lg hover:bg-rose-900 transition-colors">
          Reset Database to Defaults
        </button>
      </div>
    </div>
  `;

  // Handlers
  container.querySelector('#settings-theme-btn').addEventListener('click', () => {
    setTheme(state.theme === 'dark' ? 'light' : 'dark');
    renderSettings();
  });

  container.querySelector('#settings-save-ai-btn').addEventListener('click', async () => {
    const url = container.querySelector('#settings-ai-url').value.trim();
    const model = container.querySelector('#settings-ai-model').value.trim();
    state.localAiUrl = url;
    state.localAiModel = model;
    await saveSetting('localAiUrl', url);
    await saveSetting('localAiModel', model);
    showToast('AI engine settings saved', 'success');
  });

  container.querySelector('#settings-test-ai-btn').addEventListener('click', async () => {
    const statusEl = container.querySelector('#settings-ai-status');
    const url = container.querySelector('#settings-ai-url').value.trim();
    statusEl.textContent = 'Testing connection...';

    try {
      const resp = await fetch(url.replace(/\/$/, '') + '/api/tags', { method: 'GET' });
      if (resp.ok) {
        statusEl.innerHTML = '<span class="text-forest font-semibold">✓ Connected to local Ollama!</span>';
        showToast('Successfully connected to local Ollama!', 'success');
      } else {
        throw new Error(`Status ${resp.status}`);
      }
    } catch (err) {
      statusEl.innerHTML = '<span class="text-secondary">Ollama is not running on localhost. Built-in offline engine active.</span>';
      showToast('Ollama not reachable on localhost:11434. The built-in offline legal structuring engine remains active.', 'info', 5000);
    }
  });

  // Export JSON Backup
  container.querySelector('#settings-backup-export').addEventListener('click', async () => {
    const backup = await exportAllData();
    const str = JSON.stringify(backup, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lexnote_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    showToast('Full notebook backup downloaded!', 'success');
  });

  // Import JSON Backup
  container.querySelector('#settings-backup-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await importAllData(json);
      await refreshStateData();
      showToast(`Restored ${res.importedNotes} notes and ${res.importedResearch} FIRAC briefs!`, 'success');
      switchView('library');
    } catch (err) {
      showToast(`Restore error: ${err.message}`, 'error', 5000);
    }
  });

  // Reset DB
  container.querySelector('#settings-reset-db-btn').addEventListener('click', () => {
    openModal(
      'Reset Notebook Database',
      '<p>Are you sure you want to reset all records to the original LLB sample curriculum data? All customized notes will be deleted.</p>',
      async () => {
        indexedDB.deleteDatabase('LexNoteDB');
        showToast('Database reset. Reloading...', 'info');
        setTimeout(() => location.reload(), 800);
      },
      'Reset Everything'
    );
  });
}

/**
 * Android APK & PWA Installation Modal
 */
function openApkDownloadModal() {
  const currentAppUrl = window.location.href.split('#')[0];
  const pwaBuilderUrl = `https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(currentAppUrl)}`;

  openModal(
    'Install LexNote on Android / Get APK',
    `
    <div class="space-y-4 text-xs leading-relaxed">
      <!-- Method 1: Direct Android WebAPK (Recommended) -->
      <div class="p-3.5 bg-callout border border-rule rounded-xl space-y-2">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-forest text-white flex items-center justify-center font-bold text-xs shrink-0">1</span>
          <h4 class="font-serif text-sm font-bold text-forest">Direct Android WebAPK (Instant Install)</h4>
        </div>
        <p class="text-secondary">
          Android converts LexNote into a native <strong>WebAPK</strong> without requiring manual file downloading. It appears directly in your phone's App Drawer with the LexNote gold-and-forest scales icon and launches without browser address bars.
        </p>
        <div class="p-2.5 bg-paper border border-rule rounded-lg text-primary space-y-1">
          <div><strong>On Android (Chrome / Edge / Samsung Internet):</strong></div>
          <ol class="list-decimal list-inside space-y-0.5 text-secondary">
            <li>Tap the browser menu <strong>(⋮)</strong> in the top-right corner.</li>
            <li>Tap <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</li>
            <li>Android will generate and install the native WebAPK automatically!</li>
          </ol>
        </div>
      </div>

      <!-- Method 2: 1-Click Standalone Signed APK via PWABuilder -->
      <div class="p-3.5 bg-citation border border-rule rounded-xl space-y-2">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-champagne text-forest flex items-center justify-center font-bold text-xs shrink-0">2</span>
          <h4 class="font-serif text-sm font-bold text-forest">Download Standalone .APK File (PWABuilder)</h4>
        </div>
        <p class="text-secondary">
          Need a standalone <code>.apk</code> file to sideload or distribute to other law students? Microsoft's free, open-source <strong>PWABuilder</strong> packages this web app into a signed Android APK in seconds:
        </p>
        <a href="${pwaBuilderUrl}" target="_blank" rel="noopener noreferrer" class="inline-flex items-center justify-center gap-2 w-full py-2 px-3 bg-forest text-white font-medium rounded-lg hover:bg-forest/90 transition-colors shadow-xs">
          <span>Package & Download .APK on PWABuilder &rarr;</span>
        </a>
      </div>

      <!-- Method 3: Developer Capacitor Android Build -->
      <div class="p-3 bg-paper border border-rule rounded-xl space-y-1.5">
        <div class="flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-canvas border border-rule text-secondary flex items-center justify-center font-bold text-xs shrink-0">3</span>
          <h4 class="font-semibold text-primary">Developer Local Build (Capacitor)</h4>
        </div>
        <p class="text-secondary">To build a signed release APK using Android Studio / Gradle:</p>
        <div class="font-mono bg-canvas p-2 rounded text-[10px] text-secondary overflow-x-auto space-y-0.5">
          <div>npm install @capacitor/core @capacitor/android</div>
          <div>npx cap init LexNote com.lexnote.app</div>
          <div>npx cap add android</div>
          <div>npx cap open android</div>
        </div>
      </div>
    </div>
    `
  );
}

/**
 * Setup Global UI Event Listeners
 */
function setupEventListeners() {
  // Mobile Menu Drawer Toggle
  if (els.mobileMenuToggle) {
    els.mobileMenuToggle.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) {
        sidebar.classList.toggle('hidden');
        sidebar.classList.toggle('fixed');
        sidebar.classList.toggle('inset-y-0');
        sidebar.classList.toggle('left-0');
        sidebar.classList.toggle('shadow-2xl');
      }
    });
  }

  // Brand Link
  document.getElementById('brand-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    switchView('dashboard');
  });

  // Theme Toggle Button in sidebar
  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener('click', () => {
      setTheme(state.theme === 'dark' ? 'light' : 'dark');
    });
  }

  // Quick Create Note Button in sidebar
  document.getElementById('quick-create-note-btn')?.addEventListener('click', () => {
    createNewNote();
  });

  // Top Bar Quick Record Button
  document.getElementById('quick-record-top-btn')?.addEventListener('click', () => {
    switchView('voice');
  });

  // Global Search Input
  if (els.globalSearchInput) {
    els.globalSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = els.globalSearchInput.value.trim();
        if (query) {
          switchView('ask', { initialQuery: query });
        }
      }
    });
  }

  // PWA & Android WebAPK Install Prompt Handler
  let deferredInstallPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    showToast('LexNote installed successfully as an Android app!', 'success');
  });

  document.getElementById('pwa-install-top-btn')?.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('Installing LexNote onto your device...', 'info');
        deferredInstallPrompt = null;
        return;
      }
    }
    // Show full APK options modal
    openApkDownloadModal();
  });

  // Sidebar Nav Items
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
      // If mobile, close sidebar
      const sidebar = document.getElementById('sidebar');
      if (sidebar && sidebar.classList.contains('fixed')) {
        sidebar.classList.add('hidden');
        sidebar.classList.remove('fixed');
      }
    });
  });

  // Mobile Bottom Nav Buttons
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) switchView(view);
    });
  });

  // Top Bar 4-5 Navigation Links
  document.querySelectorAll('header nav a[data-nav]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const view = link.dataset.nav;
      if (view) switchView(view);
    });
  });

  // Add Subject Modal Trigger
  document.getElementById('add-subject-modal-trigger')?.addEventListener('click', () => {
    openModal(
      'Add New Law Subject',
      `
      <div class="space-y-3 text-xs">
        <div>
          <label class="block font-semibold text-secondary mb-1">Subject Name (English)</label>
          <input type="text" id="new-sub-name" placeholder="e.g. Criminal Law" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
        <div>
          <label class="block font-semibold text-secondary mb-1">Subject Name (Bangla / বাংলা)</label>
          <input type="text" id="new-sub-name-bn" placeholder="e.g. ফৌজদারি আইন" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
        <div>
          <label class="block font-semibold text-secondary mb-1">Semester / Year</label>
          <input type="text" id="new-sub-semester" placeholder="e.g. 2nd Year / 1st Sem" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
        <div>
          <label class="block font-semibold text-secondary mb-1">Description / Core Topics</label>
          <input type="text" id="new-sub-desc" placeholder="e.g. Penal Code 1860, Offenses against property & person" class="w-full px-2.5 py-1.5 bg-canvas border border-rule rounded-md text-primary">
        </div>
      </div>
      `,
      async (modalCard) => {
        const name = modalCard.querySelector('#new-sub-name').value.trim();
        if (!name) {
          showToast('Please enter a subject name.', 'warning');
          return false;
        }

        const newSub = {
          id: 'sub_' + Date.now(),
          name,
          nameBn: modalCard.querySelector('#new-sub-name-bn').value.trim() || name,
          semester: modalCard.querySelector('#new-sub-semester').value.trim() || 'General',
          description: modalCard.querySelector('#new-sub-desc').value.trim() || ''
        };

        await saveSubject(newSub);
        await refreshStateData();
        showToast(`Subject "${name}" added!`, 'success');
        return true;
      },
      'Create Subject'
    );
  });

  // Keyboard Shortcuts: Ctrl+S to save note, Esc to close modal
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const statusEl = document.getElementById('editor-autosave-status');
      if (statusEl) {
        showToast('Law note saved to IndexedDB', 'success', 1500);
      }
    }
    if (e.key === 'Escape') {
      closeModal();
    }
  });
}

// Start Application reliably regardless of document readyState
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', () => {
    initApp();
  });
} else {
  // DOM is already parsed (interactive or complete)
  initApp();
}

// Safety timeout: ensure initial-loader is dismissed even if async indexing lags
setTimeout(() => {
  const loader = document.getElementById('initial-loader');
  if (loader) {
    loader.classList.add('opacity-0');
    setTimeout(() => {
      try { loader.remove(); } catch { /* ignore */ }
    }, 250);
  }
}, 800);

