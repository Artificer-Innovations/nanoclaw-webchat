import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JsonPreview, parseJsonForPreview } from './JsonPreview';

describe('JsonPreview', () => {
  it('parses valid JSON', () => {
    expect(parseJsonForPreview('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonForPreview('not json')).toBeNull();
  });

  it('renders a tree for valid JSON', () => {
    render(<JsonPreview text='{"name":"Alpha","count":2}' />);
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('"Alpha"')).toBeInTheDocument();
    expect(screen.getByText('count')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('falls back to raw text for invalid JSON', () => {
    render(<JsonPreview text="not-json" />);
    expect(screen.getByText('not-json')).toHaveClass('attachment-drawer-raw');
  });

  it('expands nested JSON nodes', () => {
    render(<JsonPreview text='{"items":[{"id":1}],"empty":null}' />);
    fireEvent.click(screen.getByText('items'));
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('id')).toBeInTheDocument();
    expect(screen.getByText('null')).toBeInTheDocument();
  });
});
