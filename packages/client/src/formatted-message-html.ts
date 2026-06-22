import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormattedMessage } from './FormattedMessage';

export function renderFormattedMessageHtml(text: string): string {
  return renderToStaticMarkup(createElement(FormattedMessage, { text }));
}
