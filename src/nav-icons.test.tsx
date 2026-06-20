import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  BotIcon,
  CaretDownIcon,
  CaretRightIcon,
  DoorIcon,
  PencilIcon,
  PlusIcon,
  SendArrowIcon,
  TrashIcon,
} from './nav-icons';

describe('nav-icons', () => {
  it('renders all sidebar and composer icons', () => {
    const { container } = render(
      <>
        <DoorIcon />
        <BotIcon />
        <PlusIcon />
        <TrashIcon />
        <PencilIcon />
        <CaretRightIcon />
        <CaretDownIcon />
        <SendArrowIcon />
      </>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(8);
  });
});
