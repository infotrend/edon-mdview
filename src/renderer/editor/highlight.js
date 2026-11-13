const hljs = require('highlight.js');

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" };
const plain = (value) => ({ type: 'root', children: value ? [{ type: 'text', value }] : [] });

/** Converts highlight.js markup (nested `<span class>` and escaped text only) into the tree the editor plugin expects. */
function toTree(html) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  const pattern = /<span class="([^"]*)">|<\/span>|[^<]+/g;
  let match;
  while ((match = pattern.exec(html))) {
    const parent = stack[stack.length - 1];
    if (match[0] === '</span>') {
      if (stack.length > 1) stack.pop();
    } else if (match[1] !== undefined) {
      const element = { type: 'element', tagName: 'span', properties: { className: match[1].split(/\s+/).filter(Boolean) }, children: [] };
      parent.children.push(element);
      stack.push(element);
    } else {
      parent.children.push({ type: 'text', value: match[0].replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]) });
    }
  }
  return root;
}

/**
 * Adapter with the lowlight interface used by the code block extension, backed by the highlight.js
 * instance the reader already bundles. Blocks without a known language stay plain, as in reading mode.
 */
const highlighter = {
  highlight(language, value) {
    try {
      return toTree(hljs.highlight(value, { language, ignoreIllegals: true }).value);
    } catch {
      return plain(value);
    }
  },
  highlightAuto: plain,
  listLanguages: () => hljs.listLanguages(),
  registered: (language) => Boolean(language && hljs.getLanguage(language)),
};

module.exports = { highlighter, toTree };
