import { cloneElement, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, LiHTMLAttributes, ReactElement, ReactNode } from 'react';

const VIRTUALIZATION_THRESHOLD = 80;
const VIRTUAL_ROW_HEIGHT = 52;
const VIRTUAL_OVERSCAN = 8;
const FOCUSABLE_ROW_CONTROL = 'button:not(:disabled), summary[role="button"]';

function visibleFocusableControls(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_ROW_CONTROL))
    .filter(control => control.getClientRects().length > 0);
}

type VirtualRowProps = LiHTMLAttributes<HTMLLIElement> & {
  readonly 'data-virtual-index'?: number;
};

interface PendingFocus {
  readonly index: number;
  readonly edge: 'first' | 'last';
}

interface SavedSessionCatalogListProps {
  readonly virtualRows: readonly ReactElement[];
  readonly renderNestedRows: () => readonly ReactNode[];
}

export function SavedSessionCatalogList({ virtualRows, renderNestedRows }: SavedSessionCatalogListProps): ReactElement {
  const list = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 320 });
  const virtualized = virtualRows.length > VIRTUALIZATION_THRESHOLD;
  const firstIndex = virtualized ? Math.max(0, Math.floor(viewport.scrollTop / VIRTUAL_ROW_HEIGHT) - VIRTUAL_OVERSCAN) : 0;
  const endIndex = virtualized
    ? Math.min(virtualRows.length, Math.ceil((viewport.scrollTop + viewport.height) / VIRTUAL_ROW_HEIGHT) + VIRTUAL_OVERSCAN)
    : virtualRows.length;

  useLayoutEffect(() => {
    if (!virtualized) return;
    const element = list.current;
    if (!element) return;

    const updateViewport = () => {
      const nextViewport = { scrollTop: element.scrollTop, height: element.clientHeight };
      setViewport(current => current.scrollTop === nextViewport.scrollTop && current.height === nextViewport.height
        ? current : nextViewport);
    };
    updateViewport();
    element.addEventListener('scroll', updateViewport, { passive: true });
    const observer = new ResizeObserver(updateViewport);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', updateViewport);
      observer.disconnect();
    };
  }, [virtualized]);

  useLayoutEffect(() => {
    const target = pendingFocus.current;
    if (!virtualized || !target || target.index < firstIndex || target.index >= endIndex) return;
    const row = list.current?.querySelector<HTMLElement>(`[data-virtual-index="${target.index}"]`);
    const controls = row ? visibleFocusableControls(row) : [];
    const control = target.edge === 'first' ? controls[0] : controls.at(-1);
    if (!control) return;
    pendingFocus.current = null;
    control.focus();
  }, [endIndex, firstIndex, virtualized]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const element = list.current;
    if (!element) return;
    const maximumScrollTop = Math.max(0, virtualRows.length * VIRTUAL_ROW_HEIGHT - element.clientHeight);
    if (element.scrollTop > maximumScrollTop) element.scrollTop = maximumScrollTop;
  }, [virtualRows.length, virtualized]);

  function moveFocusAcrossVirtualWindow(event: ReactKeyboardEvent<HTMLUListElement>): void {
    if (!virtualized || event.key !== 'Tab') return;
    const controls = visibleFocusableControls(event.currentTarget);
    const boundary = event.shiftKey ? controls[0] : controls[controls.length - 1];
    if (!boundary || document.activeElement !== boundary) return;
    const row = boundary.closest<HTMLElement>('[data-virtual-index]');
    const rowIndex = Number(row?.dataset.virtualIndex);
    const nextIndex = rowIndex + (event.shiftKey ? -1 : 1);
    if (!Number.isInteger(rowIndex) || nextIndex < 0 || nextIndex >= virtualRows.length) return;

    event.preventDefault();
    pendingFocus.current = { index: nextIndex, edge: event.shiftKey ? 'last' : 'first' };
    const element = event.currentTarget;
    element.scrollTop = nextIndex * VIRTUAL_ROW_HEIGHT;
    setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
  }

  if (!virtualized) {
    return <ul className="saved-session-list" aria-label="Saved sessions and folders">{renderNestedRows()}</ul>;
  }

  const positionedRows = virtualRows.slice(firstIndex, endIndex).map((row, offset) => {
    const index = firstIndex + offset;
    const props = row.props as VirtualRowProps;
    const style: CSSProperties = {
      ...props.style,
      position: 'absolute',
      top: index * VIRTUAL_ROW_HEIGHT,
      right: 0,
      left: 0,
      height: VIRTUAL_ROW_HEIGHT
    };
    return cloneElement(row as ReactElement<VirtualRowProps>, {
      key: row.key ?? `saved-row-${index}`,
      style,
      'data-virtual-index': index,
      'aria-posinset': index + 1,
      'aria-setsize': virtualRows.length
    });
  });

  return <ul ref={list} className="saved-session-list is-virtualized" aria-label="Saved sessions and folders"
    onKeyDown={moveFocusAcrossVirtualWindow}>
    <li className="saved-session-virtual-space" aria-hidden="true" style={{ height: virtualRows.length * VIRTUAL_ROW_HEIGHT }} />
    {positionedRows}
  </ul>;
}
