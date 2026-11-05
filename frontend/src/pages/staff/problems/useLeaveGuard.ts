import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirm } from '../../../components';

/**
 * Warns before leaving with unsaved changes. The app uses <BrowserRouter> (no data router, so no
 * useBlocker): reload and close use beforeunload, and in-app links are caught in the capture phase.
 * The browser Back button is not intercepted.
 */
export function useLeaveGuard(dirty: boolean, message = 'Your changes on this page have not been saved.') {
  const nav = useNavigate();
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const here = window.location.pathname + window.location.search;
      const to = url.pathname + url.search + url.hash;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      void confirm({
        title: 'Leave without saving?',
        message: `${message} If you leave now, they are lost.`,
        confirmLabel: 'Leave and discard changes',
        cancelLabel: 'Stay on this page',
        danger: true,
      }).then((ok) => {
        if (ok && window.location.pathname + window.location.search === here) {
          dirtyRef.current = false;
          nav(to);
        }
      });
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [message, nav]);
}
