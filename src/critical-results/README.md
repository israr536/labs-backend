# Critical results

Critical-result records are intentionally separate from ordinary result values. A critical event should be created only when the laboratory's configured critical interval says that the entered result is an alert value.

Lifecycle:

1. Result evaluation detects CRITICAL_LOW or CRITICAL_HIGH.
2. A critical-result record is created/updated for the current result version.
3. Staff can record each notification attempt, including method, recipient, timestamp, staff member, outcome and note.
4. Successful communication can be acknowledged.
5. Audit history remains the source of truth for who changed the clinical record.

Do not seed universal critical thresholds. Critical intervals are laboratory-, method-, population- and clinician-dependent and must be configured/validated by each laboratory.
