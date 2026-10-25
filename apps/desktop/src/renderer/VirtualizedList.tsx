import { cloneElement, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, LiHTMLAttributes, ReactElement, ReactNode } from 'react';

export const SAVED_SESSION_CATALOG_VIRTUALIZATION_THRESHOLD = 80;

const VIRTUAL_OVERSCAN = 8;
const FOCUSABLE_ROW_CONTROL = 'button:not(:disabled), summary[role="button"]';

type VirtualRowProps = LiHTMLAttributes<HTMLLIElement> & {
  readonly 'data-virtual-index'?: number;
};

interface PendingFocus {
  readonly index: number;
  readonly edge: 'first' | 'last';
}

interface VirtualizedListProps<T> {
  readonly items: readonly T[];
  readonly label: string;
  readonly className: string;
  readonly rowHeight: number;
  readonly threshold: number;
  readonly ariaSetSize?: number;
  readonly renderItem: (item: T, index: number) => ReactElement<VirtualRowProps>;
  readonly isItemFocusable: (item: T) => boolean;
  readonly renderNonVirtualizedRows: () => ReactNode;
}

function visibleFocusableControls(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_ROW_CONTROL))
    .filter(control => control.getClientRects().length > 0);
}

function findFocusableItemIndex<T>(items: readonly T[], isItemFocusable: (item: T) => boolean,
  startIndex: number, step: -1 | 1): number | undefined {
  for (let index = startIndex; index >= 0 && index < items.length; index += step) {
    const item = items[index];
    if (item !== undefined && isItemFocusable(item)) return index;
  }
  return undefined;
}

export function VirtualizedList<T>({ items, label, className, rowHeight, threshold, ariaSetSize,
  renderItem, isItemFocusable, renderNonVirtualizedRows }: VirtualizedListProps<T>): ReactElement {
  const list = useRef<HTMLUListElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 320 });
  const virtualized = items.length > threshold;
  const firstIndex = virtualized ? Math.max(0, Math.floor(viewport.scrollTop / rowHeight) - VIRTUAL_OVERSCAN) : 0;
  const endIndex = virtualized
    ? Math.min(items.length, Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + VIRTUAL_OVERSCAN)
    : items.length;

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
  }, [endIndex, firstIndex, items, virtualized]);

  useLayoutEffect(() => {
    if (!virtualized) return;
    const element = list.current;
    if (!element) return;
    const maximumScrollTop = Math.max(0, items.length * rowHeight - element.clientHeight);
    if (element.scrollTop > maximumScrollTop) element.scrollTop = maximumScrollTop;
  }, [items.length, rowHeight, virtualized]);

  function moveFocusAcrossVirtualWindow(event: ReactKeyboardEvent<HTMLUListElement>): void {
    if (!virtualized || event.key !== 'Tab') return;
    const controls = visibleFocusableControls(event.currentTarget);
    const boundary = event.shiftKey ? controls[0] : controls.at(-1);
    if (!boundary || document.activeElement !== boundary) return;
    const row = boundary.closest<HTMLElement>('[data-virtual-index]');
    const rowIndex = Number(row?.dataset.virtualIndex);
    const step = event.shiftKey ? -1 : 1;
    if (!Number.isInteger(rowIndex)) return;
    const nextIndex = findFocusableItemIndex(items, isItemFocusable, rowIndex + step, step);
    if (nextIndex === undefined) return;

    event.preventDefault();
    pendingFocus.current = { index: nextIndex, edge: event.shiftKey ? 'last' : 'first' };
    const element = event.currentTarget;
    element.scrollTop = nextIndex * rowHeight;
    setViewport({ scrollTop: element.scrollTop, height: element.clientHeight });
  }

  if (!virtualized) {
    return <ul className={className} aria-label={label}>{renderNonVirtualizedRows()}</ul>;
  }

  const positionedRows = items.slice(firstIndex, endIndex).map((item, offset) => {
    const index = firstIndex + offset;
    const row = renderItem(item, index);
    const style: CSSProperties = {
      ...row.props.style,
      position: 'absolute',
      top: index * rowHeight,
      right: 0,
      left: 0,
      height: rowHeight
    };
    return cloneElement(row, {
      key: row.key ?? `virtual-row-${index}`,
      style,
      'data-virtual-index': index,
      'aria-posinset': index + 1,
      'aria-setsize': ariaSetSize ?? items.length
    });
  });

  return <ul ref={list} className={`${className} is-virtualized`} aria-label={label}
    onKeyDown={moveFocusAcrossVirtualWindow}>
    <li className="virtualized-list-spacer" aria-hidden="true" style={{ height: items.length * rowHeight }} />
    {positionedRows}
  </ul>;
}
