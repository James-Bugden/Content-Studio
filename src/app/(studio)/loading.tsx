import { StateView } from '@/components/state-view';

/** Shared, explicitly labelled loading state for studio routes. */
export default function StudioLoading() {
  return <StateView kind="loading" />;
}
