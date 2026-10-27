import { platformName } from '@/domain/display';
import { LinkedInLogo, ThreadsLogo, XLogo } from './platform-logos';

/** Static metadata for the home and calendar lists. */
export function ListPlatform({ platform, compact = false }: { platform: string; compact?: boolean }) {
  const name = platformName(platform);
  const Logo = name === 'X' ? XLogo : name === 'Threads' ? ThreadsLogo : name === 'LinkedIn' ? LinkedInLogo : null;
  return <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap align-middle text-xs font-semibold text-ink">
    {Logo ? <Logo width={16} height={16} /> : null}
    <span className={compact ? 'sr-only' : ''}>{name}</span>
  </span>;
}

export function ListPill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'attention' | 'block' | 'green' }) {
  const tones = { neutral: 'bg-primary-soft text-ink', attention: 'bg-attention-soft text-attention', block: 'bg-block-soft text-block', green: 'bg-green-soft text-green' };
  return <span className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}
