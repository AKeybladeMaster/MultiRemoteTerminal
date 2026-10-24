import type { WebContents } from 'electron';

type RendererLifecycleSource = Pick<WebContents, 'isDestroyed' | 'once' | 'removeListener'>;

export function bindRendererRequestCancellation(sender: RendererLifecycleSource, cancellation: AbortController): () => void {
  const cancel = () => cancellation.abort();
  if (sender.isDestroyed()) {
    cancel();
    return () => {};
  }
  sender.once('destroyed', cancel);
  sender.once('render-process-gone', cancel);
  return () => {
    sender.removeListener('destroyed', cancel);
    sender.removeListener('render-process-gone', cancel);
  };
}
