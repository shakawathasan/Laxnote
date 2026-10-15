/**
 * LexNote — Interactive Notion-Style Document Editor Engine
 * Full visual block editor supporting headings, interactive to-dos, toggles,
 * legal Ratio Decidendi callouts, statutory sections, slash commands (/),
 * in-page search, and inline AI assistance.
 */

import { organizeLegalNote } from './ai-engine.js';
import { escape } from './ui.js';

/**
 * Convert Markdown text into Interactive Notion-style HTML DOM structure
 */
export function markdownToNotionHtml(markdown) {
  if (!markdown || !markdown.trim()) {
    return '<p class="notion-block" data-type="p"><br></p>';
  }

  const lines = markdown.split(/\r?\n/);
  const htmlParts = [];
  let inBulletList = false;
  let inNumberedList = false;

  const closeOpenLists = () => {
    if (inBulletList) {
      htmlParts.push('</ul>');
      inBulletList = false;
    }
    if (inNumberedList) {
      htmlParts.push('</ol>');
      inNumberedList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Empty line
    if (!trimmed) {
      closeOpenLists();
      continue;
    }

    // Divider Line
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      closeOpenLists();
      htmlParts.push('<hr class="notion-hr my-4 border-rule">');
      continue;
    }

    // Heading 1
    if (rawLine.startsWith('# ')) {
      closeOpenLists();
      const content = parseInlineFormatting(rawLine.substring(2));
      htmlParts.push(`<h1 class="notion-h1 text-2xl font-bold text-forest mt-6 mb-2 tracking-tight">${content}</h1>`);
      continue;
    }

    // Heading 2
    if (rawLine.startsWith('## ')) {
      closeOpenLists();
      const content = parseInlineFormatting(rawLine.substring(3));
      htmlParts.push(`<h2 class="notion-h2 text-xl font-bold text-forest mt-5 mb-2 tracking-tight">${content}</h2>`);
      continue;
    }

    // Heading 3
    if (rawLine.startsWith('### ')) {
      closeOpenLists();
      const content = parseInlineFormatting(rawLine.substring(4));
      htmlParts.push(`<h3 class="notion-h3 text-base font-semibold text-primary mt-4 mb-1.5">${content}</h3>`);
      continue;
    }

    // Ratio Decidendi Legal Callout Block: > **Ratio Decidendi:** ... or > **Ratio:** ...
    if (rawLine.startsWith('> **Ratio') || (rawLine.startsWith('>') && rawLine.toLowerCase().includes('ratio'))) {
      closeOpenLists();
      const quoteText = rawLine.replace(/^>\s*/, '');
      const content = parseInlineFormatting(quoteText);
      htmlParts.push(`
        <div class="notion-callout notion-ratio-callout my-3 p-3.5 bg-citation border-l-4 border-forest rounded-r-xl text-xs sm:text-sm text-primary flex items-start gap-2.5">
          <span class="text-base select-none shrink-0">⚖️</span>
          <div class="flex-1 leading-relaxed">${content}</div>
        </div>
      `);
      continue;
    }

    // Statutory Section Callout: Starts with ### Statutory or includes Act & Section
    if (rawLine.startsWith('> [!SECTION]') || rawLine.startsWith('> **Section') || rawLine.startsWith('> **Statutory')) {
      closeOpenLists();
      const quoteText = rawLine.replace(/^>\s*/, '');
      const content = parseInlineFormatting(quoteText);
      htmlParts.push(`
        <div class="notion-callout notion-statute-callout my-3 p-3.5 bg-callout border border-rule border-l-4 border-l-amber-600 rounded-r-xl text-xs sm:text-sm text-primary flex items-start gap-2.5">
          <span class="text-base select-none shrink-0">📜</span>
          <div class="flex-1 leading-relaxed">${content}</div>
        </div>
      `);
      continue;
    }

    // Generic Blockquote
    if (rawLine.startsWith('> ')) {
      closeOpenLists();
      const quoteText = rawLine.substring(2);
      const content = parseInlineFormatting(quoteText);
      htmlParts.push(`
        <blockquote class="notion-quote my-3 pl-4 border-l-3 border-champagne text-secondary italic text-xs sm:text-sm leading-relaxed">
          ${content}
        </blockquote>
      `);
      continue;
    }

    // Interactive To-do list item: - [ ] or - [x]
    const todoMatch = rawLine.match(/^-\s*\[([ xX])\]\s*(.*)$/);
    if (todoMatch) {
      closeOpenLists();
      const isChecked = todoMatch[1].toLowerCase() === 'x';
      const text = parseInlineFormatting(todoMatch[2]);
      htmlParts.push(`
        <div class="notion-todo-item flex items-start gap-2 my-1 text-xs sm:text-sm ${isChecked ? 'completed text-secondary line-through' : 'text-primary'}">
          <input type="checkbox" ${isChecked ? 'checked' : ''} class="notion-todo-checkbox mt-1 w-4 h-4 rounded text-forest border-rule focus:ring-forest cursor-pointer">
          <div class="notion-todo-text flex-1 outline-none leading-relaxed">${text || '<br>'}</div>
        </div>
      `);
      continue;
    }

    // Toggle list: <details><summary>Title</summary>Content</details> or - ▶ Title
    if (rawLine.startsWith('- ▶ ') || rawLine.startsWith('- > ')) {
      closeOpenLists();
      const title = parseInlineFormatting(rawLine.substring(4));
      htmlParts.push(`
        <details class="notion-toggle-item my-2 p-2.5 bg-canvas/60 border border-rule/70 rounded-lg group">
          <summary class="font-semibold text-xs sm:text-sm text-primary cursor-pointer select-none hover:text-forest flex items-center gap-1.5">
            ${title}
          </summary>
          <div class="notion-toggle-content mt-2 pl-4 text-xs sm:text-sm text-primary space-y-1">
            <p>Write notes inside this toggle section...</p>
          </div>
        </details>
      `);
      continue;
    }

    // Bullet List Item: - or *
    const bulletMatch = rawLine.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      if (inNumberedList) {
        htmlParts.push('</ol>');
        inNumberedList = false;
      }
      if (!inBulletList) {
        htmlParts.push('<ul class="notion-bullet-list list-disc pl-5 my-2 space-y-1 text-xs sm:text-sm text-primary">');
        inBulletList = true;
      }
      htmlParts.push(`<li>${parseInlineFormatting(bulletMatch[1])}</li>`);
      continue;
    }

    // Numbered List Item: 1. , 2.
    const numMatch = rawLine.match(/^\d+\.\s+(.*)$/);
    if (numMatch) {
      if (inBulletList) {
        htmlParts.push('</ul>');
        inBulletList = false;
      }
      if (!inNumberedList) {
        htmlParts.push('<ol class="notion-numbered-list list-decimal pl-5 my-2 space-y-1 text-xs sm:text-sm text-primary">');
        inNumberedList = true;
      }
      htmlParts.push(`<li>${parseInlineFormatting(numMatch[1])}</li>`);
      continue;
    }

    // Regular Paragraph
    closeOpenLists();
    const content = parseInlineFormatting(rawLine);
    htmlParts.push(`<p class="notion-p my-2 text-xs sm:text-sm leading-relaxed text-primary">${content}</p>`);
  }

  closeOpenLists();
  return htmlParts.join('\n');
}

/**
 * Parse inline bold, italic, underline, strikethrough, highlights, and code
 */
function parseInlineFormatting(text) {
  if (!text) return '';

  return text
    // Escaped HTML entities first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold italic: ***text***
    .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
    // Bold: **text**
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Underline: <u>text</u> or __text__
    .replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/g, '<u>$1</u>')
    .replace(/__(.*?)__/g, '<u>$1</u>')
    // Strikethrough: ~~text~~
    .replace(/~~(.*?)~~/g, '<del class="opacity-75">$1</del>')
    // Inline code: `text`
    .replace(/`(.*?)`/g, '<code class="px-1 py-0.5 bg-canvas font-mono text-[11px] rounded border border-rule/60 text-forest">$1</code>')
    // Highlights: ==text==
    .replace(/==(.*?)==/g, '<mark class="bg-champagne/40 text-primary px-0.5 rounded">$1</mark>');
}

/**
 * Convert edited Notion HTML back to standardized Markdown
 */
export function notionHtmlToMarkdown(htmlString) {
  if (!htmlString || !htmlString.trim()) return '';

  const div = document.createElement('div');
  div.innerHTML = htmlString;

  let markdown = '';

  const serializeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const tag = node.tagName.toLowerCase();
    const childText = Array.from(node.childNodes).map(serializeNode).join('');

    switch (tag) {
      case 'h1':
        return `\n# ${childText.trim()}\n\n`;
      case 'h2':
        return `\n## ${childText.trim()}\n\n`;
      case 'h3':
        return `\n### ${childText.trim()}\n\n`;
      case 'p':
        return childText.trim() ? `${childText.trim()}\n\n` : '\n';
      case 'strong':
      case 'b':
        return `**${childText}**`;
      case 'em':
      case 'i':
        return `*${childText}*`;
      case 'u':
        return `<u>${childText}</u>`;
      case 'del':
      case 's':
      case 'strike':
        return `~~${childText}~~`;
      case 'mark':
        return `==${childText}==`;
      case 'code':
        return `\`${childText}\``;
      case 'hr':
        return '\n---\n\n';
      case 'blockquote':
        return `\n> ${childText.trim()}\n\n`;
      case 'ul':
        return '\n' + Array.from(node.children).map(li => `- ${serializeNode(li).trim()}`).join('\n') + '\n\n';
      case 'ol':
        return '\n' + Array.from(node.children).map((li, idx) => `${idx + 1}. ${serializeNode(li).trim()}`).join('\n') + '\n\n';
      case 'li':
        return childText;
      case 'div':
        // Check for todo item
        if (node.classList.contains('notion-todo-item')) {
          const checkbox = node.querySelector('input[type="checkbox"]');
          const isChecked = checkbox && checkbox.checked;
          const textEl = node.querySelector('.notion-todo-text');
          const itemText = textEl ? Array.from(textEl.childNodes).map(serializeNode).join('').trim() : childText.trim();
          return `- [${isChecked ? 'x' : ' '}] ${itemText}\n`;
        }
        // Ratio Callout
        if (node.classList.contains('notion-ratio-callout')) {
          return `\n> **Ratio Decidendi:** *${childText.trim().replace(/^⚖️\s*/, '')}*\n\n`;
        }
        // Statutory Callout
        if (node.classList.contains('notion-statute-callout')) {
          return `\n> **Statutory Section:** ${childText.trim().replace(/^📜\s*/, '')}\n\n`;
        }
        return childText ? `${childText}\n` : '';
      case 'details':
        const summary = node.querySelector('summary');
        const summaryText = summary ? summary.textContent.trim() : 'Toggle Section';
        const contentDiv = node.querySelector('.notion-toggle-content');
        const contentText = contentDiv ? Array.from(contentDiv.childNodes).map(serializeNode).join('').trim() : '';
        return `\n- ▶ ${summaryText}\n${contentText ? '  ' + contentText : ''}\n\n`;
      default:
        return childText;
    }
  };

  markdown = Array.from(div.childNodes).map(serializeNode).join('');
  // Normalize triple newlines to double newlines
  return markdown.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Slash Commands Menu Definition
 */
export const NOTION_SLASH_COMMANDS = [
  {
    id: 'text',
    title: 'Text',
    desc: 'Just start writing with plain text.',
    icon: '📝',
    action: (editor) => insertBlockHtml(editor, '<p class="notion-p my-2 text-xs sm:text-sm text-primary">Start typing...</p>')
  },
  {
    id: 'h1',
    title: 'Heading 1',
    desc: 'Big section heading.',
    icon: '🏷️',
    action: (editor) => insertBlockHtml(editor, '<h1 class="notion-h1 text-2xl font-bold text-forest mt-6 mb-2">Heading 1</h1>')
  },
  {
    id: 'h2',
    title: 'Heading 2',
    desc: 'Medium subsection heading.',
    icon: '📑',
    action: (editor) => insertBlockHtml(editor, '<h2 class="notion-h2 text-xl font-bold text-forest mt-5 mb-2">Heading 2</h2>')
  },
  {
    id: 'h3',
    title: 'Heading 3',
    desc: 'Small topic heading.',
    icon: '📌',
    action: (editor) => insertBlockHtml(editor, '<h3 class="notion-h3 text-base font-semibold text-primary mt-4 mb-1.5">Heading 3</h3>')
  },
  {
    id: 'todo',
    title: 'To-do list',
    desc: 'Track tasks with an interactive checkbox.',
    icon: '☑️',
    action: (editor) => insertBlockHtml(editor, `
      <div class="notion-todo-item flex items-start gap-2 my-1 text-xs sm:text-sm text-primary">
        <input type="checkbox" class="notion-todo-checkbox mt-1 w-4 h-4 rounded text-forest border-rule focus:ring-forest cursor-pointer">
        <div class="notion-todo-text flex-1 outline-none leading-relaxed">To-do item...</div>
      </div>
    `)
  },
  {
    id: 'bullet',
    title: 'Bulleted list',
    desc: 'Create a simple bulleted list.',
    icon: '•',
    action: (editor) => insertBlockHtml(editor, '<ul class="notion-bullet-list list-disc pl-5 my-2 text-xs sm:text-sm text-primary"><li>List item</li></ul>')
  },
  {
    id: 'numbered',
    title: 'Numbered list',
    desc: 'Create a list with numbering.',
    icon: '1.',
    action: (editor) => insertBlockHtml(editor, '<ol class="notion-numbered-list list-decimal pl-5 my-2 text-xs sm:text-sm text-primary"><li>First step</li></ol>')
  },
  {
    id: 'toggle',
    title: 'Toggle list',
    desc: 'Toggles can hide and show content.',
    icon: '▶️',
    action: (editor) => insertBlockHtml(editor, `
      <details class="notion-toggle-item my-2 p-2.5 bg-canvas/60 border border-rule/70 rounded-lg group" open>
        <summary class="font-semibold text-xs sm:text-sm text-primary cursor-pointer select-none hover:text-forest">Toggle Heading</summary>
        <div class="notion-toggle-content mt-2 pl-4 text-xs sm:text-sm text-primary">
          <p>Hidden notes inside toggle block...</p>
        </div>
      </details>
    `)
  },
  {
    id: 'ratio',
    title: 'Ratio Decidendi Quote',
    desc: 'Highlight binding legal rationale & case principle.',
    icon: '⚖️',
    action: (editor) => insertBlockHtml(editor, `
      <div class="notion-callout notion-ratio-callout my-3 p-3.5 bg-citation border-l-4 border-forest rounded-r-xl text-xs sm:text-sm text-primary flex items-start gap-2.5">
        <span class="text-base select-none shrink-0">⚖️</span>
        <div class="flex-1 leading-relaxed"><strong>Ratio Decidendi:</strong> The legal principle underlying this court decision...</div>
      </div>
    `)
  },
  {
    id: 'section',
    title: 'Statutory Section Callout',
    desc: 'Cite an Act, Section, and key legal ingredients.',
    icon: '📜',
    action: (editor) => insertBlockHtml(editor, `
      <div class="notion-callout notion-statute-callout my-3 p-3.5 bg-callout border border-rule border-l-4 border-l-amber-600 rounded-r-xl text-xs sm:text-sm text-primary flex items-start gap-2.5">
        <span class="text-base select-none shrink-0">📜</span>
        <div class="flex-1 leading-relaxed">
          <strong>Statutory Provision:</strong>
          <div>• <strong>Act:</strong> The Penal Code 1860 / Contract Act 1872</div>
          <div>• <strong>Section:</strong> Section </div>
          <div>• <strong>Essential Elements:</strong> </div>
        </div>
      </div>
    `)
  },
  {
    id: 'callout',
    title: 'Callout',
    desc: 'Make writing stand out with an icon background.',
    icon: '💡',
    action: (editor) => insertBlockHtml(editor, `
      <div class="notion-callout my-3 p-3.5 bg-canvas border border-rule rounded-xl text-xs sm:text-sm text-primary flex items-start gap-2.5">
        <span class="text-base select-none shrink-0">💡</span>
        <div class="flex-1 leading-relaxed">Important classroom observation or tutor remark...</div>
      </div>
    `)
  },
  {
    id: 'quote',
    title: 'Quote',
    desc: 'Capture a judicial dictum or scholarly quote.',
    icon: '“',
    action: (editor) => insertBlockHtml(editor, '<blockquote class="notion-quote my-3 pl-4 border-l-3 border-champagne text-secondary italic text-xs sm:text-sm leading-relaxed">“The law is reason free from passion.” — Aristotle</blockquote>')
  },
  {
    id: 'divider',
    title: 'Divider',
    desc: 'Visually divide blocks with a line.',
    icon: '➖',
    action: (editor) => insertBlockHtml(editor, '<hr class="notion-hr my-4 border-rule">')
  }
];

/**
 * Insert HTML block into the editor at cursor position or append
 */
export function insertBlockHtml(editorEl, html) {
  if (!editorEl) return;
  editorEl.focus();

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const range = sel.getRangeAt(0);
    range.deleteContents();

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html.trim();
    const frag = document.createDocumentFragment();
    let node, lastNode;
    while ((node = tempDiv.firstChild)) {
      lastNode = frag.appendChild(node);
    }
    range.insertNode(frag);

    if (lastNode) {
      range.setStartAfter(lastNode);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } else {
    editorEl.insertAdjacentHTML('beforeend', html);
  }

  // Trigger input event so autosave is dispatched
  editorEl.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * In-Page Search and Highlighter Engine
 */
export class PageSearchEngine {
  constructor(containerEl) {
    this.container = containerEl;
    this.matches = [];
    this.currentIndex = -1;
    this.query = '';
  }

  search(query) {
    this.clear();
    this.query = (query || '').trim();
    if (!this.query || !this.container) return { count: 0, current: 0 };

    const walker = document.createTreeWalker(
      this.container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          const parent = node.parentElement;
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE' || parent.classList.contains('search-highlight'))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    let currentNode;
    while ((currentNode = walker.nextNode())) {
      textNodes.push(currentNode);
    }

    const regex = new RegExp(this.escapeRegExp(this.query), 'gi');

    textNodes.forEach(node => {
      const text = node.textContent;
      if (!regex.test(text)) return;
      regex.lastIndex = 0;

      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      let match;

      while ((match = regex.exec(text)) !== null) {
        // Text before match
        if (match.index > lastIdx) {
          frag.appendChild(document.createTextNode(text.substring(lastIdx, match.index)));
        }
        // Highlight mark
        const mark = document.createElement('mark');
        mark.className = 'search-highlight bg-amber-200 dark:bg-amber-900/60 text-primary px-0.5 rounded transition-colors';
        mark.textContent = match[0];
        frag.appendChild(mark);
        this.matches.push(mark);

        lastIdx = regex.lastIndex;
      }

      if (lastIdx < text.length) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      }

      node.parentNode.replaceChild(frag, node);
    });

    if (this.matches.length > 0) {
      this.currentIndex = 0;
      this.highlightActiveMatch();
    }

    return {
      count: this.matches.length,
      current: this.matches.length > 0 ? this.currentIndex + 1 : 0
    };
  }

  next() {
    if (this.matches.length === 0) return 0;
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    this.highlightActiveMatch();
    return this.currentIndex + 1;
  }

  prev() {
    if (this.matches.length === 0) return 0;
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    this.highlightActiveMatch();
    return this.currentIndex + 1;
  }

  highlightActiveMatch() {
    this.matches.forEach((m, idx) => {
      if (idx === this.currentIndex) {
        m.classList.add('bg-amber-400', 'dark:bg-amber-500', 'font-bold');
        m.classList.remove('bg-amber-200', 'dark:bg-amber-900/60');
        m.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        m.classList.remove('bg-amber-400', 'dark:bg-amber-500', 'font-bold');
        m.classList.add('bg-amber-200', 'dark:bg-amber-900/60');
      }
    });
  }

  clear() {
    if (!this.container) return;
    const marks = this.container.querySelectorAll('.search-highlight');
    marks.forEach(m => {
      const text = document.createTextNode(m.textContent);
      m.parentNode.replaceChild(text, m);
    });
    this.matches = [];
    this.currentIndex = -1;
    this.query = '';
    // Normalize adjacent text nodes
    this.container.normalize();
  }

  escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
