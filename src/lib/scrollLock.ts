/**
 * Page scroll lock shared by everything that covers the page (dialogs, drawers, the call stage).
 *
 * Each holder takes the lock and gets back its own release. Scrolling stays locked while
 * anyone holds it and comes back when the last holder lets go, whatever order they close in.
 * (Saving and restoring body.style.overflow per holder breaks when two close together, e.g. the
 * "End the meeting?" dialog and the call stage unmounting at once: the page stayed locked.)
 */
let holders = 0;
let saved = '';

export function lockScroll(): () => void {
  if (holders === 0) {
    saved = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  holders++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) document.body.style.overflow = saved;
  };
}
