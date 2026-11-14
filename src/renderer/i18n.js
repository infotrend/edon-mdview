const { translate, isLanguage, DEFAULT_LANGUAGE } = require('../i18n');

// Attributes that carry a dictionary key and the attribute each one fills in.
const TRANSLATED_ATTRIBUTES = {
  'data-i18n-title': 'title',
  'data-i18n-label': 'aria-label',
  'data-i18n-placeholder': 'placeholder',
};
const TRANSLATED_SELECTOR = ['[data-i18n]', ...Object.keys(TRANSLATED_ATTRIBUTES).map((name) => `[${name}]`)].join(', ');

let language = DEFAULT_LANGUAGE;

function setLanguage(next) {
  language = isLanguage(next) ? next : DEFAULT_LANGUAGE;
  return language;
}

const getLanguage = () => language;
const t = (key, parameters) => translate(language, key, parameters);
/** BCP 47 tag used to format numbers and times in the current language. */
const locale = () => t('locale');

function readParameters(element) {
  const raw = element.getAttribute('data-i18n-params');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Fills every element that declares a dictionary key with the text of the current language.
 * Translations are always written as text or attribute values, never as HTML. Elements inside
 * `skip` (the open document) are left alone: a document may carry `data-*` attributes of its own.
 */
function applyTranslations(root, skip) {
  for (const element of root.querySelectorAll(TRANSLATED_SELECTOR)) {
    if (skip && element.closest(skip)) continue;
    if (element.hasAttribute('data-i18n')) element.textContent = t(element.getAttribute('data-i18n'), readParameters(element));
    for (const [source, target] of Object.entries(TRANSLATED_ATTRIBUTES)) {
      if (element.hasAttribute(source)) element.setAttribute(target, t(element.getAttribute(source)));
    }
  }
}

module.exports = { t, locale, getLanguage, setLanguage, applyTranslations };
