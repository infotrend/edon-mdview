// Interface languages, shared by the main process (menus, system dialogs) and the window (bundled).
const DICTIONARIES = {
  it: require('./it'),
  en: require('./en'),
};

const LANGUAGES = Object.keys(DICTIONARIES);
const DEFAULT_LANGUAGE = 'en';

const isLanguage = (value) => typeof value === 'string' && LANGUAGES.includes(value);

/** Italian systems (it, it-IT, it_CH…) get Italian; every other system language gets English. */
function languageForSystem(systemLanguage) {
  return /^it(?:[-_]|$)/i.test(String(systemLanguage || '').trim()) ? 'it' : DEFAULT_LANGUAGE;
}

/** A language picked by the user always wins over the one deduced from the system. */
function resolveLanguage({ saved, system } = {}) {
  return isLanguage(saved) ? saved : languageForSystem(system);
}

function translate(language, key, parameters) {
  const dictionary = DICTIONARIES[isLanguage(language) ? language : DEFAULT_LANGUAGE];
  const text = Object.hasOwn(dictionary, key) ? dictionary[key] : DICTIONARIES[DEFAULT_LANGUAGE][key];
  if (typeof text !== 'string') return key;
  if (!parameters) return text;
  return text.replace(/\{(\w+)\}/g, (placeholder, name) => (Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder));
}

module.exports = { DICTIONARIES, LANGUAGES, DEFAULT_LANGUAGE, isLanguage, languageForSystem, resolveLanguage, translate };
