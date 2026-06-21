import { useMemo } from 'react';
import {
  csvColumnCount,
  csvDelimiterFromAttachment,
  limitCsvPreviewRows,
  parseCsv,
  padRow,
} from './csv-preview';

export function CsvPreview({ text, name }: { text: string; name: string }) {
  const delimiter = csvDelimiterFromAttachment(name);
  const parsed = useMemo(() => parseCsv(text, delimiter), [delimiter, text]);
  const { rows, truncated } = useMemo(() => limitCsvPreviewRows(parsed), [parsed]);
  const columnCount = useMemo(() => csvColumnCount(rows), [rows]);

  if (rows.length === 0) {
    return <p className="attachment-drawer-csv-empty">No data</p>;
  }

  const [header, ...body] = rows;
  const headerCells = padRow(header, columnCount);

  return (
    <div className="attachment-drawer-csv-wrap">
      {truncated ? (
        <p className="attachment-drawer-csv-truncated">
          Showing first {rows.length.toLocaleString()} rows.
        </p>
      ) : null}
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
