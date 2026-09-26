import { sha256 } from '../../lib/crypto.js';

/** Avatar URLs point at the API, which checks access and redirects to a short-lived signed URL. */
const version = (stored: string) => sha256(stored).slice(0, 10);

export const avatarUrlForUser = (userId: number, stored: string | null): string | null =>
  stored ? `/api/v1/media/users/${userId}/photo?v=${version(stored)}` : null;

export const avatarUrlForCandidate = (candidateId: number, stored: string | null): string | null =>
  stored ? `/api/v1/media/candidates/${candidateId}/photo?v=${version(stored)}` : null;
