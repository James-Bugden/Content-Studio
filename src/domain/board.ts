import type { GateStatus } from './gates';
import type { NextStep, Thumb } from './next-steps';

/** Board read model types (UX redesign), shared by server and client. */
export type PostSummary = {
  libraryId: string;
  title: string;
  platform: string;
  source: string;
  hook: string;
  preview: string;
  thumb: Thumb;
  status: GateStatus | 'scheduled';
  step: NextStep;
  scheduledAs: string[];
  reviewStatus: string;
};

export type SlotSummary = {
  contentId: string;
  isoDate: string;
  slot: string;
  platform: 'X' | 'Threads' | 'LinkedIn';
  time: string;
  hook: string;
  statusLabel: string;
  thumb: Thumb | null;
  libraryId: string | null;
  parentContentId: string;
  step: NextStep;
  empty: boolean;
};

export type Task = {
  key: string;
  step: NextStep;
  title: string;
  platform: string;
  when?: { isoDate: string; time: string };
  target: { post: string } | { slot: string };
};

export type Board = {
  today: string;
  now: string;
  posts: PostSummary[];
  slots: SlotSummary[];
  window: { from: string; to: string };
  tasks: Task[];
  counts: { review: number; images: number; ready: number; openSlotsThisWeek: number; problems: number };
};

