import { hmac } from '../lib/crypto.js';

/**
 * Channel names double as capabilities: they carry an HMAC of the id, so only
 * a caller the API handed the name to can subscribe. The API only issues a
 * room name to staff and to a candidate who has been admitted.
 */
const tag = (scope: string, id: number): string => hmac(`${scope}:${id}`).slice(0, 22);

export const channels = {
  user: (userId: number) => `user-${userId}-${tag('user', userId)}`,
  /** Everyone in the call: staff and the admitted candidate. Signalling, chat, presence. */
  room: (interviewId: number) => `room-${interviewId}-${tag('room', interviewId)}`,
  /** Staff only: entry requests, assistant notes. */
  staff: (interviewId: number) => `staff-${interviewId}-${tag('staff', interviewId)}`,
  /** The candidate's waiting room: admission and end-of-meeting events. */
  lobby: (interviewId: number) => `lobby-${interviewId}-${tag('lobby', interviewId)}`,
};

export const EVENTS = {
  notificationNew: 'notification:new',
  entryRequested: 'entry:requested',
  entryAdmitted: 'entry:admitted',
  roomState: 'room:state',
  roomEnded: 'room:ended',
  assistantNote: 'assistant:note',
} as const;
