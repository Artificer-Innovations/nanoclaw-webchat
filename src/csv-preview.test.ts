import { describe, expect, it } from 'vitest';
import {
  csvColumnCount,
  csvDelimiterFromAttachment,
  isCsvAttachment,
  parseCsv,
  padRow,
  renderCsvTableHtml,
} from './csv-preview';

describe('csv-preview', () => {
  it('detects csv and tsv attachments', () => {
    expect(isCsvAttachment('text/csv', 'data.csv')).toBe(true);
    expect(isCsvAttachment('text/tab-separated-values', 'data.tsv')).toBe(true);
    expect(isCsvAttachment('application/octet-stream', 'data.csv')).toBe(true);
    expect(isCsvAttachment('text/plain', 'notes.txt')).toBe(false);
  });

  it('parses quoted csv fields and escaped quotes', () => {
    expect(parseCsv('a,b\n"c,d","e""f"')).toEqual([
      ['a', 'b'],
      ['c,d', 'e"f'],
    ]);
  });

  it('parses tsv with tab delimiter', () => {
    expect(parseCsv('a\tb\n1\t2', '\t')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(csvDelimiterFromAttachment('data.tsv')).toBe('\t');
  });

  it('parses windows and classic mac line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('parses trailing row without a newline', () => {
    expect(parseCsv('solo')).toEqual([['solo']]);
  });

  it('returns empty rows for blank csv content', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n')).toEqual([]);
  });

  it('pads rows and counts columns', () => {
    expect(padRow(['a'], 3)).toEqual(['a', '', '']);
    expect(csvColumnCount([['a', 'b'], ['c']])).toBe(2);
  });

  it('renders csv tables with escaped html', () => {
    const html = renderCsvTableHtml([
      ['Name', 'Value'],
      ['<tag>', 'a&b'],
    ]);
    expect(html).toContain('<table class="csv-table">');
    expect(html).toContain('&lt;tag&gt;');
    expect(html).toContain('a&amp;b');
    expect(renderCsvTableHtml([])).toContain('No data');
  });
});
