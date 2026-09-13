// tests/unit/renderMarkdown.test.js
import { describe, it, expect, vi } from 'vitest';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&' + 'amp;')
    .replace(/</g, '&' + 'lt;')
    .replace(/>/g, '&' + 'gt;')
    .replace(/"/g, '&' + 'quot;');
}

function renderMarkdown(src) {
  if (!src) return "";
  let text = String(src).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(/^(\s*)(\d+[.)])\s+/gm, "$1- ");

  const codeBlocks = [];
  let md = text.replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    codeBlocks.push(code);
    return "\u0000C" + (codeBlocks.length - 1) + "\u0000";
  });
  let html = escapeHtml(md);
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  html = html.replace(
    /\[([^\]]+)\]\((https?:[^)\s]*|#[^)\s]*)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );

  const lines = html.split("\n");
  const out = [];
  let para = [];
  let listTag = null;
  let items = [];
  const flushPara = () => {
    if (para.length) {
      out.push("<p>" + para.join("<br>") + "</p>");
      para = [];
    }
  };
  const flushList = () => {
    if (listTag) {
      out.push(
        "<" + listTag + ">" + items.map((i) => "<li>" + i + "</li>").join("") +
          "</" + listTag + ">"
      );
      listTag = null;
      items = [];
    }
  };

  for (const raw of lines) {
    const t = raw.trim();
    if (!t) {
      flushPara();
      flushList();
      continue;
    }
    const codeM = t.match(/^\u0000C(\d+)\u0000$/);
    if (codeM) {
      flushPara();
      flushList();
      const code = codeBlocks[+codeM[1]] || "";
      out.push("<pre><code>" + escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
      continue;
    }
    const h = t.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      const lv = h[1].length + 1;
      out.push("<h" + lv + ">" + h[2] + "</h" + lv + ">");
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) {
      flushPara();
      flushList();
      out.push("<hr>");
      continue;
    }
    if (/^&gt;\s?/.test(t)) {
      flushPara();
      flushList();
      out.push("<blockquote>" + t.replace(/^&gt;\s?/, "") + "</blockquote>");
      continue;
    }
    const li = t.match(/^[-*+]\s+(.*)$/) || t.match(/^\d+[.)]\s+(.*)$/);
    if (li) {
      flushPara();
      const tag = /^\d/.test(t) ? "ol" : "ul";
      if (listTag && listTag !== tag) flushList();
      if (!listTag) listTag = tag;
      items.push(li[1]);
      continue;
    }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return out.join("\n");
}

describe('renderMarkdown', () => {
  describe('paragraphs', () => {
    it('single paragraph', () => {
      expect(renderMarkdown('Olá mundo')).toBe('<p>Olá mundo</p>');
    });

    it('multiple paragraphs separated by blank line', () => {
      const result = renderMarkdown('Primeira linha\n\nSegunda linha');
      expect(result).toContain('<p>Primeira linha</p>');
      expect(result).toContain('<p>Segunda linha</p>');
    });

    it('single line breaks become <br>', () => {
      const result = renderMarkdown('Linha 1\nLinha 2');
      expect(result).toBe('<p>Linha 1<br>Linha 2</p>');
    });
  });

  describe('lists', () => {
    it('bullet list', () => {
      const result = renderMarkdown('- Item 1\n- Item 2');
      expect(result).toBe('<ul><li>Item 1</li><li>Item 2</li></ul>');
    });

    it('numbered list converted to bullets', () => {
      const result = renderMarkdown('1. Primeiro\n2. Segundo');
      expect(result).toBe('<ul><li>Primeiro</li><li>Segundo</li></ul>');
    });

    it('mixed content with list', () => {
      const result = renderMarkdown('Intro\n\n- Item\n\nOutro');
      expect(result).toContain('<p>Intro</p>');
      expect(result).toContain('<ul><li>Item</li></ul>');
      expect(result).toContain('<p>Outro</p>');
    });
  });

  describe('inline formatting', () => {
    it('bold', () => {
      expect(renderMarkdown('**negrito**')).toBe('<p><strong>negrito</strong></p>');
    });

    it('italic', () => {
      expect(renderMarkdown('*itálico*')).toBe('<p><em>itálico</em></p>');
    });

    it('inline code', () => {
      expect(renderMarkdown('`code`')).toBe('<p><code>code</code></p>');
    });

    it('links', () => {
      const result = renderMarkdown('[link](https://example.com)');
      expect(result).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">link</a>');
    });
  });

  describe('blocks', () => {
    it('code block', () => {
      const result = renderMarkdown('```js\nconst x = 1\n```');
      expect(result).toContain('<pre><code>const x = 1</code></pre>');
    });

    it('blockquote', () => {
      const result = renderMarkdown('> cita');
      expect(result).toBe('<blockquote>cita</blockquote>');
    });

    it('heading', () => {
      expect(renderMarkdown('## Título')).toBe('<h3>Título</h3>');
      expect(renderMarkdown('### Sub')).toBe('<h4>Sub</h4>');
    });

    it('hr', () => {
      expect(renderMarkdown('---')).toBe('<hr>');
    });
  });

  describe('empty/edge cases', () => {
    it('empty string', () => {
      expect(renderMarkdown('')).toBe('');
    });

    it('null', () => {
      expect(renderMarkdown(null)).toBe('');
    });

    it('whitespace only', () => {
      expect(renderMarkdown('   \n\n  ')).toBe('');
    });
  });
});