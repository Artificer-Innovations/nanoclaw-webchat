import { describe, expect, it } from 'vitest';
import { ATTACHMENT_DRAWER_MIN_WIDTH } from './attachment-drawer-layout';
import { SIDEBAR_MIN_WIDTH } from './sidebar-layout';
import {
  CHAT_METADATA_RESERVE,
  balancedSidePanelWidth,
  chatPanelWidth,
  clampDrawerWidthForLayout,
  clampSidebarWidthForLayout,
  maxDrawerWidthForLayout,
  maxSidebarWidthForLayout,
  minChatPanelWidth,
  reconcilePanelWidths,
} from './panel-layout';

describe('panel-layout', () => {
  it('computes chat width from visible panels', () => {
    expect(
      chatPanelWidth({
        viewportWidth: 1200,
        sidebarWidth: 240,
        drawerWidth: 400,
        sidebarCollapsed: false,
        drawerOpen: true,
      }),
    ).toBe(560);
  });

  it('shrinks oversized panels without widening narrower ones', () => {
    const result = reconcilePanelWidths({
      viewportWidth: 900,
      sidebarWidth: 220,
      drawerWidth: 480,
      sidebarCollapsed: false,
      drawerOpen: true,
    });

    expect(result.sidebarWidth).toBe(220);
    expect(result.drawerWidth).toBe(268);
    expect(result.sidebarWidth).toBeLessThanOrEqual(220);
    expect(result.drawerWidth).toBeLessThanOrEqual(480);
  });

  it('balances all three panels with extra room reserved for chat metadata', () => {
    const result = reconcilePanelWidths({
      viewportWidth: 900,
      sidebarWidth: 400,
      drawerWidth: 420,
      sidebarCollapsed: false,
      drawerOpen: true,
    });

    const side = balancedSidePanelWidth(900);
    expect(result).toEqual({ sidebarWidth: side, drawerWidth: side });
    expect(
      chatPanelWidth({
        viewportWidth: 900,
        sidebarWidth: result.sidebarWidth,
        drawerWidth: result.drawerWidth,
        sidebarCollapsed: false,
        drawerOpen: true,
      }),
    ).toBeGreaterThanOrEqual(minChatPanelWidth(result.sidebarWidth, result.drawerWidth));
  });

  it('keeps chat visible on very narrow three-panel layouts', () => {
    const result = reconcilePanelWidths({
      viewportWidth: 560,
      sidebarWidth: 280,
      drawerWidth: 400,
      sidebarCollapsed: false,
      drawerOpen: true,
    });

    const chat = chatPanelWidth({
      viewportWidth: 560,
      sidebarWidth: result.sidebarWidth,
      drawerWidth: result.drawerWidth,
      sidebarCollapsed: false,
      drawerOpen: true,
    });

    expect(chat).toBeGreaterThan(0);
    expect(chat).toBeGreaterThanOrEqual(minChatPanelWidth(result.sidebarWidth, result.drawerWidth));
  });

  it('shrinks the attachment drawer when it is wider than the chat panel', () => {
    const result = reconcilePanelWidths({
      viewportWidth: 900,
      sidebarWidth: 0,
      drawerWidth: 520,
      sidebarCollapsed: true,
      drawerOpen: true,
    });

    expect(result.drawerWidth).toBe(402);
    expect(
      chatPanelWidth({
        viewportWidth: 900,
        sidebarWidth: 0,
        drawerWidth: result.drawerWidth,
        sidebarCollapsed: true,
        drawerOpen: true,
      }),
    ).toBeGreaterThanOrEqual(result.drawerWidth + CHAT_METADATA_RESERVE);
  });

  it('shrinks the sidebar when it is wider than the chat panel', () => {
    const result = reconcilePanelWidths({
      viewportWidth: 900,
      sidebarWidth: 500,
      drawerWidth: 0,
      sidebarCollapsed: false,
      drawerOpen: false,
    });

    expect(result.sidebarWidth).toBe(450);
    expect(
      chatPanelWidth({
        viewportWidth: 900,
        sidebarWidth: result.sidebarWidth,
        drawerWidth: 0,
        sidebarCollapsed: false,
        drawerOpen: false,
      }),
    ).toBeGreaterThanOrEqual(result.sidebarWidth);
  });

  it('caps an oversized sidebar against the viewport when only chat and sidebar are visible', () => {
    const result = reconcilePanelWidths({
      viewportWidth: 400,
      sidebarWidth: 260,
      drawerWidth: 0,
      sidebarCollapsed: false,
      drawerOpen: false,
    });

    expect(result.sidebarWidth).toBe(200);
  });

  it('caps sidebar and drawer widths for layout constraints', () => {
    expect(maxSidebarWidthForLayout(1200, 400, true)).toBe(352);
    expect(maxDrawerWidthForLayout(1200, 240, false)).toBe(432);
    expect(maxDrawerWidthForLayout(900, 0, true)).toBe(402);
  });

  it('clamps widths using layout-aware limits', () => {
    expect(
      clampSidebarWidthForLayout(500, 900, 420, true),
    ).toBe(maxSidebarWidthForLayout(900, 420, true));
    expect(
      clampDrawerWidthForLayout(520, 900, 300, false),
    ).toBe(maxDrawerWidthForLayout(900, 300, false));
  });

  it('allows side panels to shrink below configured minimums when the viewport is too narrow', () => {
    expect(clampDrawerWidthForLayout(280, 500, 220, false)).toBe(60);
  });

  it('leaves balanced sidebar and chat widths unchanged when only the sidebar is open', () => {
    const result = reconcilePanelWidths({
      viewportWidth: 1200,
      sidebarWidth: 240,
      drawerWidth: 0,
      sidebarCollapsed: false,
      drawerOpen: false,
    });

    expect(result).toEqual({ sidebarWidth: 240, drawerWidth: 0 });
  });

  it('returns zero widths when both panels are hidden', () => {
    expect(
      reconcilePanelWidths({
        viewportWidth: 1200,
        sidebarWidth: 240,
        drawerWidth: 480,
        sidebarCollapsed: true,
        drawerOpen: false,
      }),
    ).toEqual({ sidebarWidth: 0, drawerWidth: 0 });
  });

  it('uses balanced side panel helper', () => {
    expect(balancedSidePanelWidth(901)).toBe(268);
    expect(SIDEBAR_MIN_WIDTH).toBeGreaterThan(0);
    expect(ATTACHMENT_DRAWER_MIN_WIDTH).toBeGreaterThan(0);
  });
});
