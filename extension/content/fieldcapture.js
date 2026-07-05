// Captures answers the user types into apply forms so Job Finder can autofill
// them next time (PLAN.md §6.7). Off by default; never captures passwords or
// hidden/file fields.

function jfLabelFor(el) {
  if (el.id) {
    const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (l && l.textContent.trim()) return l.textContent.trim();
  }
  const wrap = el.closest('label');
  if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
  return el.name || el.getAttribute('aria-label') || el.placeholder || '';
}

chrome.storage.local.get('fieldCapture').then(({ fieldCapture }) => {
  if (!fieldCapture) return;
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const fields = [];
    for (const el of form.querySelectorAll('input, textarea, select')) {
      const type = (el.type || '').toLowerCase();
      if (['password', 'hidden', 'file', 'submit', 'button', 'checkbox', 'radio'].includes(type)) continue;
      const value = el.value;
      if (!value || !String(value).trim()) continue;
      const label = jfLabelFor(el);
      if (!label || label.length > 120) continue;
      fields.push({ label: label.replace(/\s+/g, ' ').trim(), value: String(value).slice(0, 2000) });
    }
    if (fields.length) chrome.runtime.sendMessage({ cmd: 'pushFields', fields });
  }, true);
});
