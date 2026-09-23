/**
 * Shared UI patterns (CS-006). Import from '@/components'. Client components carry
 * their own 'use client' directive, so this barrel is safe from server components.
 * None of these modules may import env, auth, integrations or application code.
 */
export { AppShell, PRIMARY_NAV, type AppShellProps } from './app-shell';
export { NavLink } from './nav-link';
export { PageHeader, type PageHeaderProps } from './page-header';
export { StatusBadge, GateChip, NextAction, STATUS_LOOK, gateLook } from './status';
export { StateView, ErrorState, STATE_KINDS, STATE_LOOK, ERROR_STATE_KIND, type StateKind, type StateViewProps } from './state-view';
export { CapabilityBanner, capabilityMessage } from './capability-banner';
export { FilterBar, sanitiseFilterValue, nextFilterQuery, type FilterDef, type FilterOption } from './filter-bar';
export { SourceLink, isSafeHref } from './source-link';
export { InlineResult, TONES, type ResultTone } from './inline-result';
export { ToastProvider, ToastProvider as Toaster, useToast } from './toaster';
export { ConflictDialog, type ConflictAction, type ConflictDialogProps } from './conflict-dialog';
export { RecoveryPanel, STEP_LOOK, type RecoveryStep, type RecoveryStepStatus, type RecoveryPanelProps } from './recovery-panel';
export { useDirtyGuard, useAnyDirty } from './use-dirty-guard';
export { GuardedLink, type GuardedLinkProps } from './guarded-link';
export { useLeaveConfirmation } from './leave-confirm';
export { ModalDialog, type ModalDialogProps } from './modal-dialog';
export { buttonClass, type ButtonVariant } from './button-styles';
