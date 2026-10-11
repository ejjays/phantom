import {
  Event as EventShim,
  EventTarget as EventTargetShim,
} from 'event-target-shim';

// hermes lacks Event/EventTarget; web-streams-polyfill references them
const globalRef = globalThis as unknown as {
  Event?: unknown;
  EventTarget?: unknown;
};
if (!globalRef.Event) globalRef.Event = EventShim;
if (!globalRef.EventTarget) globalRef.EventTarget = EventTargetShim;
