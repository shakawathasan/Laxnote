/**
 * LexNote UI View Templates & Rendering Helpers
 * Clean, accessible DOM generators adhering to the Frontend Design Constitution.
 */

// Toast notification helper
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-lg text-xs font-medium shadow-lg border transition-all duration-300 transform translate-y-2 opacity-0 ${
    type === 'error'
      ? 'bg-rose-900/90 text-white border-rose-700'
      : type === 'success'
      ? 'bg-[#23483F] text-white border-[#345548]'
      : type === 'warning'
      ? 'bg-amber-900/90 text-white border-amber-700'
      : 'bg-paper text-primary border-rule'
  }`;

  let icon = `
    <svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
    </svg>
  `;
  if (type === 'error') {
    icon = `
      <svg class="w-4 h-4 shrink-0 text-rose-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    `;
  } else if (type === 'success') {
    icon = `
      <svg class="w-4 h-4 shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    `;
  } else if (type === 'warning') {
    icon = `
      <svg class="w-4 h-4 shrink-0 text-amber-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
    `;
  }

  toast.innerHTML = `
    ${icon}
    <div class="flex-1">${message}</div>
    <button class="toast-close ml-2 text-current opacity-70 hover:opacity-100">&times;</button>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  const removeToast = () => {
    toast.classList.add('opacity-0', 'translate-y-2');
    setTimeout(() => toast.remove(), 300);
  };

  toast.querySelector('.toast-close').addEventListener('click', removeToast);
  setTimeout(removeToast, duration);
}

// Modal Dialog Helper
export function openModal(title, contentHtml, onConfirm = null, confirmText = 'Save') {
  const container = document.getElementById('modal-container');
  const card = document.getElementById('modal-card');
  if (!container || !card) return;

  card.innerHTML = `
    <div class="flex items-center justify-between pb-3 mb-4 border-b border-rule">
      <h3 class="font-serif text-lg font-bold text-forest">${title}</h3>
      <button id="modal-close-btn" class="p-1 text-secondary hover:text-primary rounded-md text-xl">&times;</button>
    </div>
    <div class="modal-body text-sm mb-6 max-h-[70vh] overflow-y-auto">
      ${contentHtml}
    </div>
    <div class="flex items-center justify-end gap-3 pt-3 border-t border-rule">
      <button id="modal-cancel-btn" class="px-3.5 py-1.5 text-xs font-medium text-secondary hover:text-primary rounded-md border border-rule transition-colors">
        Cancel
      </button>
      ${onConfirm ? `
      <button id="modal-confirm-btn" class="px-4 py-1.5 text-xs font-medium bg-forest text-white rounded-md hover:bg-forest/90 transition-colors shadow-sm">
        ${confirmText}
      </button>` : ''}
    </div>
  `;

  container.classList.remove('hidden');

  const closeModal = () => {
    container.classList.add('hidden');
  };

  card.querySelector('#modal-close-btn').addEventListener('click', closeModal);
  card.querySelector('#modal-cancel-btn').addEventListener('click', closeModal);

  if (onConfirm) {
    card.querySelector('#modal-confirm-btn').addEventListener('click', async () => {
      try {
        const shouldClose = await onConfirm(card);
        if (shouldClose !== false) closeModal();
      } catch (err) {
        showToast(err.message || 'Action failed', 'error');
      }
    });
  }

  // Close on outside click
  container.onclick = (e) => {
    if (e.target === container) closeModal();
  };
}

export function closeModal() {
  const container = document.getElementById('modal-container');
  if (container) container.classList.add('hidden');
}

// Format relative date
export function formatFriendlyDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Escape HTML
export function escape(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
