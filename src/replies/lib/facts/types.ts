import type { FactSensitivity } from '@/replies/lib/contracts/vocabulary';

/**
 * A stored row from C03's `facts` table.
 *
 * This is the one shape the whole facts module works with. Eligibility,
 * selection, context-building and the repository all read and return this
 * same type rather than each inventing a slightly different one, which is how
 * a gate quietly stops matching what the database actually enforces.
 *
 * `valid_from` and `valid_to` are date-only strings (`YYYY-MM-DD`), matching
 * the SQL `date` column: they carry no time zone of their own, so a gate that
 * compares them against a caller's local clock time would be answering a
 * question nobody asked.
 */
export interface Fact {
  id: string;
  user_id: string;
  fact_text: string;
  tags: string[];
  /**
   * Private provenance (who told the model this, which import it came from).
   * It exists so a human can audit a fact, not so a generation provider can
   * read it. Nothing outside the repository and the owner-facing admin layer
   * should ever look inside this value.
   */
  source_reference: unknown;
  approved: boolean;
  sensitivity: FactSensitivity;
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

