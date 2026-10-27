import { LinkedInLogo, ThreadsLogo, XLogo } from '../platform-logos';

/** Keep list-row logos independent of the interactive preview/image bundle. */
export function PlatformLogo({ platform }: { platform: string }) {
  return platform === 'LinkedIn' ? <LinkedInLogo /> : platform === 'Threads' ? <ThreadsLogo /> : platform === 'X' ? <XLogo /> : null;
}
