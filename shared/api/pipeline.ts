import { z } from 'zod';
import { STAGES, type BoardStage, type Stage } from '../domain/pipeline.js';
import type { DeliveryReport } from './envelope.js';

export const pipelineQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  job: z.coerce.number().int().positive().optional(),
  dept: z.coerce.number().int().positive().optional(),
});

export interface PipelineCardDto {
  applicationId: number;
  candidateId: number;
  name: string;
  email: string;
  avatarUrl: string | null;
  jobTitle: string;
  stage: Stage;
  appliedAt: string;
  updatedAt: string;
  aiScore: number | null;
  rating: number;
  noteCount: number;
  latestNote: string | null;
  screeningScore: number | null;
  interviewScore: number | null;
  primaryDocumentId: number | null;
  hasResume: boolean;
}

export interface PipelineDto {
  columns: Record<BoardStage, PipelineCardDto[]>;
  jobs: Array<{ id: number; title: string }>;
  departments: Array<{ id: number; name: string }>;
}

export const stageMoveSchema = z.object({
  stage: z.enum(STAGES),
  override: z.boolean().optional().default(false),
  notifyApplicant: z.boolean().optional().default(false),
});
export type StageMoveInput = z.input<typeof stageMoveSchema>;

export interface StageMoveResultDto extends DeliveryReport {
  from: Stage;
  to: Stage;
  override: boolean;
}
