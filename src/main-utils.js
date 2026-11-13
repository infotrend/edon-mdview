const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdown', '.mkd', '.txt']);

function isMarkdownPath(filePath) {
  return typeof filePath === 'string' && MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function cleanLocalReference(reference) {
  const withoutFragment = reference.split('#', 1)[0].split('?', 1)[0];
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    return withoutFragment;
  }
}

function resolveLocalPath(currentDocument, reference) {
  if (!currentDocument || typeof reference !== 'string' || !reference.trim()) return null;

  let value = reference.trim();
  if (/^(https?|data|mailto|tel):/i.test(value)) return null;

  if (/^mdview:/i.test(value)) {
    try {
      value = new URL(value).searchParams.get('path') || '';
    } catch {
      return null;
    }
  } else if (/^file:/i.test(value)) {
    try {
      value = fileURLToPath(value);
    } catch {
      return null;
    }
  } else {
    value = cleanLocalReference(value);
  }

  if (!value || value.includes('\0')) return null;
  const root = path.dirname(path.resolve(currentDocument));
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value.replaceAll('/', path.sep));
  return isPathInside(root, resolved) ? resolved : null;
}

function resolveLinkedDocument(currentDocument, reference) {
  const resolved = resolveLocalPath(currentDocument, reference);
  return resolved && isMarkdownPath(resolved) ? resolved : null;
}

function toResourceUrl(filePath) {
  return `mdview://local/resource?path=${encodeURIComponent(path.resolve(filePath))}`;
}

module.exports = {
  MARKDOWN_EXTENSIONS,
  isMarkdownPath,
  isPathInside,
  resolveLocalPath,
  resolveLinkedDocument,
  toResourceUrl,
};
