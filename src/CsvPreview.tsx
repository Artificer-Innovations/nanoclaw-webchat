import { useMemo } from 'react';
import { csvColumnCount, csvDelimiterFromAttachment, parseCsv, padRow } from './csv-preview';

export function CsvPreview({ text, name }: { text: string; name: string }) {
  const delimiter = csvDelimiterFromAttachment(name);
  const rows = useMemo(() => parseCsv(text, delimiter), [delimiter, text]);
  const columnCount = useMemo(() => csvColumnCount(rows), [rows]);

  if (rows.length === 0) {
    return <p className="attachment-drawer-csv-empty">No data</p>;
  }

  const [header, ...body] = rows;
  const headerCells = padRow(header, columnCount);

  return (
    <div className="attachment-drawer-csv-wrap">
      <table className="attachment-drawer-csv">
        <thead>
          <tr>
            {headerCells.map((cell, index) => (
              <th key={index} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((rawRow, rowIndex) => {
            const cells = padRow(rawRow, columnCount);
            return (
              <tr key={rowIndex}>
                {cells.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
