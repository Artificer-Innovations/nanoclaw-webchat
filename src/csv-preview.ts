import { attachmentExtension } from './attachment-code';
import { escapeHtml } from './attachment-text-popout';

export function isCsvAttachment(mimeType: string, name = ''): boolean {
  if (
    mimeType === 'text/csv' ||
    mimeType === 'application/csv' ||
    mimeType === 'text/tab-separated-values'
  ) {
    return true;
  }
  const ext = attachmentExtension(name);
  return ext === '.csv' || ext === '.tsv';
}

export function csvDelimiterFromAttachment(name: string): string {
  return attachmentExtension(name) === '.tsv' ? '\t' : ',';
}

/** Parse RFC 4180-style CSV/TSV into rows of fields. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\r' && next === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
    } else if (char === '\n' || char === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length > 0 && rows.every((cells) => cells.length === 1 && cells[0] === '')) {
    return [];
  }

  return rows;
}

export function padRow(row: string[], columnCount: number): string[] {
  if (row.length >= columnCount) return row;
  return [...row, ...Array.from({ length: columnCount - row.length }, () => '')];
}

export function csvColumnCount(rows: string[][]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

export function renderCsvTableHtml(rows: string[][]): string {
  if (rows.length === 0) {
    return '<p class="csv-empty">No data</p>';
  }

  const columnCount = csvColumnCount(rows);
  const [header, ...body] = rows;
  const headerCells = padRow(header, columnCount);
  const headHtml = headerCells.map((cell) => `<th scope="col">${escapeHtml(cell)}</th>`).join('');
  const bodyHtml = body
    .map((rawRow) => {
      const cells = padRow(rawRow, columnCount)
        .map((cell) => `<td>${escapeHtml(cell)}</td>`)
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');

  return `<div class="csv-table-wrap"><table class="csv-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}
