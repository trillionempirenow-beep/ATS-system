import { Suspense, lazy, type ComponentType, type ReactNode } from 'react';
import { PageSpinner } from '@/components/ui/Feedback';

/** Code-split each page; named exports are wrapped for React.lazy. */
export function page<T extends Record<string, ComponentType>>(load: () => Promise<T>, name: keyof T): ReactNode {
  const Component = lazy(async () => ({ default: (await load())[name] as ComponentType }));
  return <Suspense fallback={<PageSpinner />}><Component /></Suspense>;
}
