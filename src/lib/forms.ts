import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Maps a 422 from the API onto the form's fields. Returns the message to show
 * in a form-level notice when the error is not tied to a single field.
 */
export function applyServerErrors<T extends FieldValues>(e: unknown, setError: UseFormSetError<T>, known: ReadonlyArray<string>): string | null {
  if (e instanceof ApiError) {
    let placed = false;
    for (const [field, message] of Object.entries(e.fields)) {
      if (known.includes(field)) {
        setError(field as Path<T>, { type: 'server', message });
        placed = true;
      }
    }
    if (placed && e.code === 'validation_failed') return null;
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}
