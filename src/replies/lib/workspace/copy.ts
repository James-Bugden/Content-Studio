/**
 * Every user-facing string in the workspace, in one place (D12).
 *
 * Two reasons this is a module rather than text scattered through components.
 * First, D12 specifies exact copy and it should be possible to diff the app
 * against the specification. Second, and more importantly, the rule that "all
 * success and error copy is tied to actual state" is only checkable if the states
 * and their strings sit side by side: it is obvious here that there is no string
 * for "Draft saved" that a component could reach for while text merely sits in
 * browser memory.
 *
 * The interface is English in v1. Personal replies follow the owner's own voice,
 * which is a different register and lives in the generation prompts, not here.
 */

export const SOURCE = {
  heading: 'What are you replying to?',
  label: "Paste the post or comment you're replying to",
  urlLabel: 'Post link',
  parentLabel: 'Add parent-post context',
  parentHint: 'The post this comment is under, if you are replying to a comment.',
  submit: 'Get reply ideas',
  submitHint: 'Ctrl or Cmd, then Enter',
  empty: 'Paste the post or comment first.',
  keywordMode: 'Search by keyword',
  keywordSubmit: 'Search my replies and resources',
  keywordOnly: 'Paste a post or comment to get tailored reply ideas.',
  targetPost: 'Post',
  targetComment: 'Comment',
  expand: 'Show the full post',
  collapse: 'Show less',
} as const;

export const HISTORY = {
  /** Used only for confirmed posted replies (D04). */
  headingConfirmed: "You've replied to similar posts before",
  /** Drafts and main posts sit here instead, with their provenance stated. */
  headingSaved: 'Saved writing',
  navLabel: 'Your past replies',
  loading: 'Checking your past replies...',
  empty: 'No matching past replies yet.',
  error: "Couldn't search past replies.",
  retry: 'Retry search',
  expand: 'Show full text',
  collapse: 'Show less',
  copy: 'Copy text',
  use: 'Use this idea',
  more: 'Show more matches',
  dateUnknown: 'Date unknown',
} as const;

export const RESOURCES = {
  heading: 'Useful things you can share',
  loading: 'Checking your resources...',
  noMatch: "Nothing worth linking for this one.",
  emptyCatalog: 'Add your first resource to find it here.',
  emptyCatalogAction: 'Open Resources',
  error: "Couldn't check your resources.",
  retry: 'Retry resources',
  add: 'Add to reply',
  addRecommendation: 'Add recommendation',
  copyLink: 'Copy link',
  alreadyAdded: 'Already added',
  showMore: (count: number) => `Show ${count} more resource${count === 1 ? '' : 's'}`,
  englishOnly: 'English resource',
} as const;

export const IDEAS = {
  heading: 'Reply ideas',
  // Said plainly, in the same shape as the two sections above this one, because
  // a heading with nothing under it reads as something that failed to load.
  idle: 'No reply ideas yet.',
  loading: 'Drafting reply ideas...',
  failed: "Couldn't create reply ideas. Your draft is unchanged.",
  rateLimited: 'Reply ideas are temporarily paused. Your draft is unchanged.',
  notConfigured: 'Reply ideas are not set up yet. Everything else still works.',
  withheld: "These suggestions didn't pass the grounding checks, so they aren't shown.",
  retry: 'Try again',
  use: 'Use this',
  suggested: 'Suggested',
  includes: (title: string) => `Includes: ${title}`,
  showMeaning: 'English meaning',
} as const;

/**
 * The formatting toolbar, worded as in Content Studio so the two tools read alike.
 * Nothing here says "markdown is bad"; it says what the platform will do with it.
 */
export const FORMAT = {
  toolbar: 'Formatting',
  bold: 'B',
  boldLabel: 'Bold',
  italic: 'I',
  italicLabel: 'Italic',
  bullets: '• List',
  bulletsLabel: 'Bulleted list',
  numbers: '1. List',
  numbersLabel: 'Numbered list',
  clear: 'Clear style',
  clearLabel: 'Remove bold and italic from the selection',
  count: (length: number, limit: number) =>
    `${length.toLocaleString('en-GB')} / ${limit.toLocaleString('en-GB')} characters`,
  over: (platform: string) => `Over the ${platform} limit`,
  markdownFound: (kinds: string, platform: string) =>
    `This has markdown (${kinds}). ${platform} will show those symbols as typed.`,
  cleanUp: 'Clean up markdown',
  note: 'Bold and italic use special letters. Screen readers may spell them out, so keep them to a few words.',
} as const;

export const EDITOR = {
  heading: 'Your reply',
  label: 'Your reply',
  placeholder: 'Write your reply, or use one of the ideas above.',
  jumpTo: 'Jump to your reply',
  shorter: 'Shorter',
  moreDirect: 'More direct',
  warmer: 'Warmer',
  addExample: 'Add a personal example',
  removeResource: 'Remove resource',
  rewriteReady: 'Review this version before replacing your reply.',
  applyRewrite: 'Apply rewrite',
  keepMine: 'Keep my reply',
  replaceReply: 'Replace reply',
  undo: 'Undo',
  rewriteWithheld: "That rewrite didn't pass the checks, so it isn't shown. Your reply is unchanged.",
  rewriteFailed: "Couldn't rewrite that. Your reply is unchanged.",
} as const;

export const MEANING = {
  heading: 'English meaning',
  stale: 'Your reply changed. Refresh the English meaning.',
  refresh: 'Refresh English meaning',
  loading: 'Translating...',
  failed: "Couldn't refresh the English meaning. Your reply is unchanged.",
} as const;

export const RECORD = {
  copy: 'Copy reply',
  copied: 'Copied',
  copyFailed: "Couldn't copy automatically. Select the text and copy it.",
  editedSinceCopy: 'Edited since copy',
  markPosted: 'Mark posted',
  helper: 'Post it in your feed, then mark it posted here.',
  helperEdited: 'If you changed the reply in the feed, paste that final version here first.',
  saving: 'Saving...',
  saveFailed: "Couldn't save your reply. Your text is still here.",
  retrySave: 'Retry save',
  saved: (platform: string, count: number, target: number) =>
    `Saved. ${platform} ${count}/${target} today.`,
  undoRecorded: 'Undo recorded status',
  undoFailed: "Couldn't undo that. It is still recorded.",
  undoneHelper: 'Undone here. The reply is still on the platform if you posted it.',
  saveAsIdea: 'Save as content idea',
  savingIdea: 'Saving idea...',
  ideaSaved: 'Saved to the Content backlog.',
  ideaFailed: "Couldn't save the idea. Your reply is still recorded.",
  next: 'Next reply',
  signedOut: 'Sign in to save your reply.',
} as const;

export const NAV = {
  title: 'Social Replies',
  menu: 'Menu',
  library: 'Library',
  resources: 'Resources',
  facts: 'Facts',
  settings: 'Settings',
  workspace: 'Write a reply',
} as const;

export const PROGRESS = {
  label: 'Today',
  /** Counts can exceed the target. 11/10 is shown, not clamped (C09). */
  forPlatform: (platform: string, count: number, target: number) =>
    `${platform} ${count}/${target}`,
} as const;

/**
 * Shared copy for the four utility pages (SR-018, D14).
 *
 * A generic "sign in to continue" rather than reusing RECORD.signedOut, because
 * that string is written for the reply workspace specifically and these pages are
 * not asking the owner to save a reply.
 */
export const PAGES = {
  signedOut: 'Sign in to continue.',
  signIn: 'Sign in',
} as const;

/**
 * D05, D14. Library search is POST-based on purpose: the search text is the
 * owner's private writing and must never sit in a URL, browser history or a
 * server log (SEC-05).
 */
export const LIBRARY = {
  heading: 'Library',
  searchLabel: 'Search your past replies',
  searchPlaceholder: 'Search by keyword or phrase',
  search: 'Search',
  searching: 'Searching...',
  empty: 'No matching replies yet.',
  error: "Couldn't search the library.",
  retry: 'Retry search',
  filterPlatform: 'Platform',
  filterProvenance: 'Provenance',
  includeUnknownDates: 'Include replies with an unknown date',
  more: 'Show more matches',
  expand: 'Show full text',
  collapse: 'Show less',
  copy: 'Copy text',
  copied: 'Copied',
  useInReply: 'Use in reply',
  useInReplyHint:
    'Opens the workspace with this as a starting point. It will not overwrite a reply you are already writing there.',
  dateUnknown: 'Date unknown',
  /** Identical wording to PastRepliesSection.tsx, so a reply reads the same way everywhere (D05). */
  provenanceLabel: {
    posted_confirmed: 'Posted',
    user_edited_unconfirmed: 'Draft, not confirmed',
    published_main_post: 'Your own post',
    ai_draft: 'AI draft',
  },
  correct: 'Correct',
  correctHeading: 'Correct this reply',
  correctLabel: 'Corrected text',
  correctReason: 'Reason for the correction (optional)',
  correctSave: 'Save correction',
  correctCancel: 'Cancel',
  correctSaved: 'Correction saved.',
  correctConflict: 'This changed somewhere else. Reload this entry before correcting it again.',
  correctFailed: "Couldn't save the correction. Your text is still here.",
  withdraw: 'Withdraw recorded status',
  withdrawHint:
    "This changes this app's record only. It does not delete or edit the reply on the social platform itself.",
  withdrawConfirm: 'Withdraw',
  withdrawCancel: 'Cancel',
  withdrawSaved: 'Withdrawn from your recorded replies.',
  withdrawFailed: "Couldn't update this reply. Try again.",
} as const;

/**
 * Resource and fact administration (D06, D14, C06).
 *
 * Two rules worth keeping visible in the copy itself: a resource's access wording
 * is never invented (accessNotesHint), and a new fact is never approved by the
 * act of creating it (facts.notApprovedYet).
 */
export const ADMIN = {
  resources: {
    heading: 'Resources',
    subheading: 'The registry that reply ideas can link to. Add, edit or disable; nothing is hard-deleted.',
    empty: 'No resources yet.',
    addTitle: 'Add a resource',
    editTitle: 'Edit resource',
    add: 'Add resource',
    edit: 'Edit',
    titleEn: 'Title (English)',
    titleZhTw: 'Title (Chinese)',
    description: 'Description',
    type: 'Type',
    ownership: 'Ownership',
    canonicalPath: 'Path on your own site',
    zhTwPath: 'Chinese path on your own site',
    externalUrl: 'External link',
    ctaEn: 'Call to action (English)',
    ctaZhTw: 'Call to action (Chinese)',
    allowedPlatforms: 'Allowed platforms',
    accessNotes: 'Access notes',
    accessNotesHint:
      'Only add wording you have verified yourself, for example that a page is free or needs no sign-up. Leave this blank if you are not sure.',
    tags: 'Tags, comma separated',
    aliases: 'Aliases, comma separated',
    active: 'Active',
    verified: 'Verified',
    notVerified: 'Not verified',
    inactiveLabel: 'Inactive',
    save: 'Save resource',
    cancel: 'Cancel',
    disable: 'Disable',
    enable: 'Enable',
    conflict: 'This changed somewhere else. Reload before saving.',
    saveFailed: "Couldn't save this resource. Your changes are still in the form.",
    saved: 'Resource saved.',
    disabled: 'Disabled. It will stop being offered in new replies immediately.',
    enabled: 'Enabled.',
  },
  facts: {
    heading: 'Facts',
    subheading: 'Personal facts a generated reply may draw on, once approved.',
    empty: 'No facts yet.',
    addTitle: 'Add a fact',
    editTitle: 'Edit fact',
    add: 'Add fact',
    edit: 'Edit',
    factText: 'Fact',
    tags: 'Tags, comma separated',
    sensitivity: 'Sensitivity',
    publicSafe: 'Public safe',
    privateOnly: 'Private, context only',
    privateOnlyHint: 'Excluded from generation. It is never eligible to be quoted in a reply.',
    active: 'Active',
    validFrom: 'Valid from',
    validTo: 'Valid to',
    approved: 'Approved for use',
    notApprovedYet: 'New facts are not approved for use. Approve this one explicitly once you have reviewed it.',
    eligible: 'Eligible for generation',
    excluded: 'Excluded from generation',
    reasonNotApproved: 'Not yet approved.',
    reasonInactive: 'Marked inactive.',
    reasonPrivate: 'Marked private, context only.',
    save: 'Save fact',
    cancel: 'Cancel',
    conflict: 'This changed somewhere else. Reload before saving.',
    saveFailed: "Couldn't save this fact. Your changes are still in the form.",
    saved: 'Fact saved.',
  },
} as const;

/**
 * Settings (C10, SR-018). Names and states only: no key value, no service-role
 * value, no arbitrary SQL and no model picker ever appears here.
 */
export const SETTINGS = {
  heading: 'Settings',
  signOutHeading: 'This device',
  signOut: 'Sign out',
  // Said out loud because it is the reason the control exists, and because a
  // draft disappearing without warning would otherwise look like data loss.
  signOutNote: 'Signing out clears the reply saved in this tab. Your saved replies stay.',
  signOutFailed: 'You are signed out on this device. The server did not confirm it, so sign out again elsewhere if you were signed in there.',
  targetsHeading: 'Daily targets',
  targetLinkedin: 'LinkedIn target',
  targetX: 'X target',
  targetThreads: 'Threads target',
  timezone: 'Timezone',
  save: 'Save settings',
  saved: 'Settings saved.',
  saveFailed: "Couldn't save settings. Your changes are still in the form.",
  configHeading: 'Configuration status',
  configHint: 'Names and status only. No key or secret value is ever shown here.',
  configured: 'Configured',
  missing: 'Missing',
  live: 'Live',
  fakeMode: 'Fake (test mode)',
  unconfigured: 'Not configured',
  authRow: 'Sign-in',
  generationRow: 'Reply generation',
  embeddingRow: 'Search embeddings',
  resourceOriginRow: 'Resource link origin',
  timezoneRow: 'Timezone',
} as const;
