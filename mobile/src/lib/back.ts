import { BackHandler } from 'react-native';
import { useEffect, useRef } from 'react';

type BackCb = () => boolean | void;

interface Entry {
  cb: BackCb;
  pri: number;
}

// highest priority runs first; first `true` consumes the press
const handlers: Entry[] = [];
let installed = false;

function dispatch() {
  const sorted = [...handlers].sort((a, b) => b.pri - a.pri);
  for (const h of sorted) {
    if (h.cb()) return true;
  }
  return false;
}

function ensureInstalled() {
  if (installed) return;
  installed = true;
  BackHandler.addEventListener('hardwareBackPress', dispatch);
}

// screens register inner-state back handling at higher priority; the
// app-level "go home" fallback registers at a negative priority so it
// only fires when nothing else consumed the press
export function useBackHandler(cb: BackCb, priority = 0) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    ensureInstalled();
    const entry: Entry = { cb: () => ref.current(), pri: priority };
    handlers.push(entry);
    return () => {
      const i = handlers.indexOf(entry);
      if (i >= 0) handlers.splice(i, 1);
    };
  }, [priority]);
}
