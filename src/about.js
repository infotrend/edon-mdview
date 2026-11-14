// Fixed product facts shown in the About dialog. None of these is translated.
const PRODUCT_NAME = 'EDON MDView';
const DEVELOPER = 'INFOTREND SRL';
const LICENSE = 'FSL-1.1-MIT';
// The only address the app opens in the browser on its own behalf (About dialog link).
const WEBSITE_URL = 'https://edon.systems';

// Main open source software the project is built with. `package` is the entry in package.json whose
// node_modules/<package>/package.json declares `license`; a unit test keeps the two in step.
const CREDITS = [
  { name: 'Electron', package: 'electron', license: 'MIT' },
  { name: 'Tiptap', package: '@tiptap/core', license: 'MIT' },
  { name: 'ProseMirror', package: 'prosemirror-markdown', license: 'MIT' },
  { name: 'markdown-it', package: 'markdown-it', license: 'MIT' },
  { name: 'markdown-it-anchor', package: 'markdown-it-anchor', license: 'Unlicense' },
  { name: 'markdown-it-footnote', package: 'markdown-it-footnote', license: 'MIT' },
  { name: 'markdown-it-task-lists', package: 'markdown-it-task-lists', license: 'ISC' },
  { name: 'DOMPurify', package: 'dompurify', license: 'MPL-2.0 OR Apache-2.0' },
  { name: 'highlight.js', package: 'highlight.js', license: 'BSD-3-Clause' },
  { name: 'esbuild', package: 'esbuild', license: 'MIT' },
  { name: 'electron-builder', package: 'electron-builder', license: 'MIT' },
];

module.exports = { PRODUCT_NAME, DEVELOPER, LICENSE, WEBSITE_URL, CREDITS };
