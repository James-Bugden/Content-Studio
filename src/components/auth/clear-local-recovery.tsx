'use client';

import { useEffect } from 'react';
import { clearLocalRecovery } from '@/lib/client/local-recovery';

/** Rendered on the signed-out login page: a second, JS-mount clear of `cs:` keys (SEC-09). */
export function ClearLocalRecovery() {
  useEffect(() => {
    clearLocalRecovery();
  }, []);
  return null;
}
