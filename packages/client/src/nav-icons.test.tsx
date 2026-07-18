import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  BotIcon,
  CaretDownIcon,
  CaretRightIcon,
  InboxIcon,
  DoorIcon,
  MessageActivityIcon,
  PencilIcon,
  PlusIcon,
  SendArrowIcon,
  SidebarHideIcon,
  SidebarShowIcon,
  ThinkingBubbleIcon,
  ToolGearIcon,
  TrashIcon,
} from './nav-icons';

describe('nav-icons', () => {
  it('renders all sidebar and composer icons', () => {
    const { container } = render(
      <>
        <DoorIcon />
        <InboxIcon />
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
    expect(container.querySelectorAll('svg')).toHaveLength(11);
  });

  it('renders live activity icons', () => {
    const { container } = render(
      <>
        <ThinkingBubbleIcon />
        <ToolGearIcon />
        <MessageActivityIcon />
      </>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(3);
  });
});
