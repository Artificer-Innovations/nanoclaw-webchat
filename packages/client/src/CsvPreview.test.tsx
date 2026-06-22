import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CsvPreview } from './CsvPreview';

describe('CsvPreview', () => {
  it('renders csv rows as a table with a sticky header row', () => {
    render(<CsvPreview name="data.csv" text={'Name,Count\nAlpha,1\nBeta,2'} />);
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Count' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '2' })).toBeInTheDocument();
  });

  it('shows empty state for blank csv files', () => {
    render(<CsvPreview name="empty.csv" text={''} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('shows a truncation notice for large csv files', () => {
    const rows = Array.from({ length: 1001 }, (_, index) => String(index)).join('\n');
    render(<CsvPreview name="large.csv" text={`h\n${rows}`} />);
    expect(screen.getByText('Showing first 1,000 data rows.')).toBeInTheDocument();
  });
});
