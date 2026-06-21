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
  SidebarHideIcon,
  SidebarShowIcon,
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
        <SidebarHideIcon />
        <SidebarShowIcon />
      </>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(10);
  });
});
