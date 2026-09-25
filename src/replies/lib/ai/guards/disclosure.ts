import type { ProviderIdea } from '../types';

/**
 * Disclosure and injection outcomes (SEC-04).
 *
 * The injection defence is architectural: the generator has no tools, no browsing
 * and no secrets, so there is nothing for a pasted instruction to command. What this
 * module checks is the one thing that *could* still go wrong, which is the model
 * writing something into the reply that should not leave the machine, or announcing
 * that it has been re-instructed.
 *
 * It is not a content filter. It does not touch text the owner wrote.
 */

export interface DisclosureFinding {
  position: number;
  kind: 'credential_shape' | 'contact_details' | 'instruction_leak' | 'compliance_announcement';
  detail: string;
}

const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\b(?:api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*\S{8,}/i,
];

const CONTACT_DETAILS: readonly RegExp[] = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
  /\+?\d[\d\s().-]{8,}\d/,
];

/** The model narrating that it has been redirected, which means it partly was. */
const INSTRUCTION_LEAK: readonly RegExp[] = [
  /\byour (?:system )?(?:prompt|instructions?) (?:are|is|says?)\b/i,
  /\bmy (?:system )?(?:prompt|instructions?) (?:are|is|says?)\b/i,
  /\bignore (?:the )?(?:previous|prior|above) instructions?\b/i,
  /\bas (?:an? )?(?:AI|language model|assistant)\b/i,
  /\bi (?:have|will) (?:now )?(?:been )?(?:re)?(?:instructed|configured|programmed)\b/i,
];

export function checkDisclosure(ideas: ProviderIdea[]): DisclosureFinding[] {
  const findings: DisclosureFinding[] = [];

  for (const idea of ideas) {
    const text = `${idea.reply_text}\n${idea.english_meaning ?? ''}\n${idea.cta_text ?? ''}`;

    for (const pattern of CREDENTIAL_SHAPES) {
      if (pattern.test(text)) {
        findings.push({
          position: idea.position,
          kind: 'credential_shape',
          detail: 'The reply contains something shaped like a credential.',
        });
        break;
      }
    }

    for (const pattern of CONTACT_DETAILS) {
      if (pattern.test(text)) {
        findings.push({
          position: idea.position,
          kind: 'contact_details',
          detail: 'The reply contains contact details, which are never added automatically.',
        });
        break;
      }
    }

    for (const pattern of INSTRUCTION_LEAK) {
      if (pattern.test(text)) {
        findings.push({
          position: idea.position,
          kind: 'instruction_leak',
          detail: 'The reply talks about its own instructions rather than replying.',
        });
        break;
      }
    }
  }

  return findings;
}

