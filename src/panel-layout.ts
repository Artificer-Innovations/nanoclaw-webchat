import {
  ATTACHMENT_DRAWER_MIN_WIDTH,
  clampAttachmentDrawerWidth,
  maxAttachmentDrawerWidth,
} from './attachment-drawer-layout';
import {
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  maxSidebarWidth,
} from './sidebar-layout';

/** Room for timestamp + sender labels before message body text wraps. */
export const CHAT_METADATA_RESERVE = 96;

export interface PanelLayoutInput {
  viewportWidth: number;
  sidebarWidth: number;
  drawerWidth: number;
  sidebarCollapsed: boolean;
  drawerOpen: boolean;
}

export interface PanelLayoutResult {
  sidebarWidth: number;
  drawerWidth: number;
}

export function chatPanelWidth({
  viewportWidth,
  sidebarWidth,
  drawerWidth,
  sidebarCollapsed,
  drawerOpen,
}: PanelLayoutInput): number {
  const side = sidebarCollapsed ? 0 : sidebarWidth;
  const drawer = drawerOpen ? drawerWidth : 0;
  return viewportWidth - side - drawer;
}

export function balancedSidePanelWidth(viewportWidth: number): number {
  return Math.floor((viewportWidth - CHAT_METADATA_RESERVE) / 3);
}

export function minChatPanelWidth(sidebarWidth: number, drawerWidth: number): number {
  return Math.max(sidebarWidth, drawerWidth) + CHAT_METADATA_RESERVE;
}

export function maxSidebarWidthForLayout(
  viewportWidth: number,
  drawerWidth: number,
  drawerOpen: boolean,
): number {
  if (!drawerOpen) {
    return maxSidebarWidth(viewportWidth);
  }
  const byChatVsSidebar = Math.floor((viewportWidth - drawerWidth) / 2);
  const byChatVsDrawer = viewportWidth - 2 * drawerWidth;
  const byContentReserve = Math.floor((viewportWidth - drawerWidth - CHAT_METADATA_RESERVE) / 2);
  return Math.max(
    0,
    Math.min(maxSidebarWidth(viewportWidth), byChatVsSidebar, byChatVsDrawer, byContentReserve),
  );
}

export function maxDrawerWidthForLayout(
  viewportWidth: number,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
): number {
  if (sidebarCollapsed) {
    const byChatVsDrawer = Math.floor(viewportWidth / 2);
    const byContentReserve = Math.floor((viewportWidth - CHAT_METADATA_RESERVE) / 2);
    return Math.max(
      0,
      Math.min(maxAttachmentDrawerWidth(viewportWidth), byChatVsDrawer, byContentReserve),
    );
  }
  const byChatVsDrawer = Math.floor((viewportWidth - sidebarWidth) / 2);
  const byChatVsSidebar = viewportWidth - 2 * sidebarWidth;
  const byContentReserve = Math.floor((viewportWidth - sidebarWidth - CHAT_METADATA_RESERVE) / 2);
  return Math.max(
    0,
    Math.min(maxAttachmentDrawerWidth(viewportWidth), byChatVsDrawer, byChatVsSidebar, byContentReserve),
  );
}

function layoutNeedsThreePanelBalance(
  viewportWidth: number,
  sidebarWidth: number,
  drawerWidth: number,
): boolean {
  const chat = viewportWidth - sidebarWidth - drawerWidth;
  return chat < minChatPanelWidth(sidebarWidth, drawerWidth);
}

function reconcileThreePanels(
  viewportWidth: number,
  inputSidebar: number,
  inputDrawer: number,
): PanelLayoutResult {
  // Shrink-only: never widen stored widths; sub-minimum results are intentional on narrow viewports.
  let sidebar = Math.min(clampSidebarWidth(inputSidebar, viewportWidth), inputSidebar);
  let drawer = Math.min(clampAttachmentDrawerWidth(inputDrawer, viewportWidth), inputDrawer);

  const target = balancedSidePanelWidth(viewportWidth);
  sidebar = Math.min(sidebar, target);
  drawer = Math.min(drawer, target);

  drawer = Math.min(drawer, maxDrawerWidthForLayout(viewportWidth, sidebar, false), inputDrawer);
  sidebar = Math.min(sidebar, maxSidebarWidthForLayout(viewportWidth, drawer, true), inputSidebar);

  return { sidebarWidth: sidebar, drawerWidth: drawer };
}

export function reconcilePanelWidths(input: PanelLayoutInput): PanelLayoutResult {
  const { viewportWidth, sidebarCollapsed, drawerOpen } = input;
  let sidebar = sidebarCollapsed ? 0 : input.sidebarWidth;
  let drawer = drawerOpen ? input.drawerWidth : 0;

  if (!drawerOpen && sidebarCollapsed) {
    return { sidebarWidth: 0, drawerWidth: 0 };
  }

  if (!drawerOpen && !sidebarCollapsed) {
    let nextSidebar = input.sidebarWidth;
    if (viewportWidth - nextSidebar < nextSidebar) {
      nextSidebar = Math.min(
        nextSidebar,
        Math.max(
          SIDEBAR_MIN_WIDTH,
          Math.min(maxSidebarWidth(viewportWidth), Math.floor(viewportWidth / 2)),
        ),
      );
    } else {
      nextSidebar = Math.min(clampSidebarWidth(nextSidebar, viewportWidth), nextSidebar);
    }
    return { sidebarWidth: nextSidebar, drawerWidth: 0 };
  }

  if (drawerOpen && sidebarCollapsed) {
    drawer = Math.min(clampAttachmentDrawerWidth(drawer, viewportWidth), input.drawerWidth);
    const chat = viewportWidth - drawer;
    if (chat < drawer + CHAT_METADATA_RESERVE) {
      drawer = Math.min(drawer, maxDrawerWidthForLayout(viewportWidth, 0, true));
    }
    return { sidebarWidth: 0, drawerWidth: drawer };
  }

  if (layoutNeedsThreePanelBalance(viewportWidth, sidebar, drawer)) {
    return reconcileThreePanels(viewportWidth, input.sidebarWidth, input.drawerWidth);
  }

  sidebar = Math.min(clampSidebarWidth(sidebar, viewportWidth), input.sidebarWidth);
  drawer = Math.min(clampAttachmentDrawerWidth(drawer, viewportWidth), input.drawerWidth);
  drawer = Math.min(drawer, maxDrawerWidthForLayout(viewportWidth, sidebar, false), input.drawerWidth);
  sidebar = Math.min(sidebar, maxSidebarWidthForLayout(viewportWidth, drawer, true), input.sidebarWidth);

  return { sidebarWidth: sidebar, drawerWidth: drawer };
}

function clampToEffectiveRange(width: number, min: number, max: number): number {
  const effectiveMin = Math.min(min, max);
  return Math.round(Math.min(max, Math.max(effectiveMin, width)));
}

export function clampSidebarWidthForLayout(
  width: number,
  viewportWidth: number,
  drawerWidth: number,
  drawerOpen: boolean,
): number {
  const max = maxSidebarWidthForLayout(viewportWidth, drawerWidth, drawerOpen);
  return clampToEffectiveRange(width, SIDEBAR_MIN_WIDTH, max);
}

export function clampDrawerWidthForLayout(
  width: number,
  viewportWidth: number,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
): number {
  const max = maxDrawerWidthForLayout(viewportWidth, sidebarWidth, sidebarCollapsed);
  return clampToEffectiveRange(width, ATTACHMENT_DRAWER_MIN_WIDTH, max);
}
