const MarkdownIt = require('markdown-it');
const anchor = require('markdown-it-anchor');
const footnote = require('markdown-it-footnote');
const taskLists = require('markdown-it-task-lists');
const hljs = require('highlight.js');

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\-_ ]/gu, '')
    .replace(/\s/g, '-') || 'sezione';
}

function createMarkdownRenderer(purifier) {
  const markdown = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(code, language) {
      if (language && hljs.getLanguage(language)) {
        try {
          return hljs.highlight(code, { language, ignoreIllegals: true }).value;
        } catch {
          return '';
        }
      }
      return '';
    },
  });

  const defaultValidateLink = markdown.validateLink;
  markdown.validateLink = (url) => /^mdview:/i.test(url) || defaultValidateLink.call(markdown, url);
  markdown
    .use(anchor, { slugify, tabIndex: false, uniqueSlugStartIndex: 2 })
    .use(footnote)
    .use(taskLists, { enabled: false, label: true, labelAfter: true });

  return (source) => purifier.sanitize(markdown.render(source), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|mdview):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}

module.exports = { createMarkdownRenderer, slugify };
