import { z } from 'zod';

/** Acme assistant: one turn of the conversation, typed or spoken. */
export const assistantMessageSchema = z
  .object({
    text: z.string().trim().max(2000).optional().default(''),
    /** A hold-to-talk recording, base64 (about a minute of speech at most). */
    audio: z.string().max(1_400_000).optional(),
    audioMime: z.string().max(80).optional(),
    /** The last few turns, so "move her" and "yes, that one" make sense. */
    history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).max(12).optional().default([]),
    /** The page the person is on, e.g. "/app/candidates/42". */
    page: z.string().max(200).optional().default(''),
  })
  .refine((v) => v.text || v.audio, { message: 'Say or type something first.' });
export type AssistantMessageInput = z.input<typeof assistantMessageSchema>;

/** A change the assistant prepared. Nothing happens until the person confirms it. */
export interface AssistantActionDto {
  /** Signed and short-lived; sent back to confirm. */
  token: string;
  kind: AssistantActionKind;
  title: string;
  lines: string[];
  confirmLabel: string;
}

export type AssistantActionKind = 'move_stage' | 'schedule_interview' | 'send_email' | 'create_job' | 'approve_job' | 'reject_job';

export interface AssistantReplyDto {
  reply: string;
  /** What the person said, when they used the mic. */
  transcript: string | null;
  /** The reply read aloud (base64), when they used the mic and a voice is set up. */
  audio: string | null;
  audioMime: string | null;
  actions: AssistantActionDto[];
}

export const assistantTokenSchema = z.object({ token: z.string().min(10).max(4000) });

export interface AssistantConfirmDto {
  message: string;
  /** Present when the change can be reversed (stage moves). */
  undoToken: string | null;
  link: string | null;
}
