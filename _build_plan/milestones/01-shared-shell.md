# M1 prompt — Shared shell and route integration

Move the implemented Social Replies product into Content Studio. Namespace UI
under `/replies` and APIs under `/api/replies`; use the existing Auth.js Google
owner session as the single browser login. Keep Supabase access server-only and
preserve all reply safety, idempotency, draft-recovery and fake-mode contracts.
Add shared navigation and deterministic combined-app tests. Do not implement
historical imports or change Content Studio's Sheet authority.

