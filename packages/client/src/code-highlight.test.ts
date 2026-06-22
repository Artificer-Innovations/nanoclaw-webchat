import { describe, expect, it } from 'vitest';
import { highlightCodeHtml, registerAllHighlightLanguages, registerHighlightLanguage } from './code-highlight';

describe('code-highlight', () => {
  it('highlights known languages', () => {
    const html = highlightCodeHtml('const x = 1;', 'typescript');
    expect(html).toContain('hljs');
    expect(html).toContain('x');
  });

  it('registers languages idempotently', () => {
    registerHighlightLanguage('javascript');
    registerHighlightLanguage('javascript');
    registerAllHighlightLanguages();
    expect(highlightCodeHtml('function test() {}', 'javascript')).toContain('hljs');
    expect(highlightCodeHtml('public class Main {}', 'csharp')).toContain('hljs');
    expect(highlightCodeHtml('<template></template>', 'html')).toContain('hljs');
    expect(highlightCodeHtml('[section]\nkey=value', 'hcl')).toContain('hljs');
    expect(highlightCodeHtml('{% block body %}{% endblock %}', 'django')).toContain('hljs');
    expect(highlightCodeHtml('.class { color: red }', 'stylus')).toContain('hljs');
  });

  it('auto-detects when language is unknown', () => {
    const html = highlightCodeHtml('const x = 1;', 'not-a-language');
    expect(html).toContain('hljs');
  });

  it('auto-detects when language is null', () => {
    const html = highlightCodeHtml('SELECT 1;', null);
    expect(html).toContain('hljs');
  });
});
