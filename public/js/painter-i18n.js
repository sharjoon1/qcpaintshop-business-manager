(function() {
  const STORAGE_KEY = 'painter_lang';
  let translations = {};
  let currentLang = localStorage.getItem(STORAGE_KEY) || 'ta'; // Default Tamil

  async function loadTranslations(lang) {
    try {
      const res = await fetch(`/i18n/painter-${lang}.json`);
      translations = await res.json();
      currentLang = lang;
      localStorage.setItem(STORAGE_KEY, lang);
      applyTranslations();
    } catch (err) {
      console.error('i18n load failed:', err);
    }
  }

  // Get translation by dot-notation key
  function t(key) {
    const keys = key.split('.');
    let val = translations;
    for (const k of keys) { val = val?.[k]; }
    return val || key;
  }

  // Apply translations to all elements with data-i18n attribute
  function applyTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const translated = t(key);
      if (translated !== key) {
        if (el.tagName === 'INPUT' && el.hasAttribute('placeholder')) {
          el.placeholder = translated;
        } else {
          el.textContent = translated;
        }
      }
    });
    // Also apply to data-i18n-placeholder
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const translated = t(key);
      if (translated !== key) el.placeholder = translated;
    });
    // Update toggle button text
    const toggleBtn = document.getElementById('langToggle');
    if (toggleBtn) {
      toggleBtn.textContent = currentLang === 'ta' ? 'EN' : 'தமிழ்';
    }
  }

  function toggleLanguage() {
    loadTranslations(currentLang === 'ta' ? 'en' : 'ta');
  }

  function getLang() { return currentLang; }

  // Auto-load on script include
  document.addEventListener('DOMContentLoaded', () => loadTranslations(currentLang));

  // Expose globally
  window.painterI18n = { t, loadTranslations, toggleLanguage, getLang, applyTranslations };
})();
