# Critical results

Critical-result records are separate from ordinary LOW/NORMAL/HIGH result flags. An event is created only when a laboratory-configured `criticalLow` or `criticalHigh` threshold is crossed.

## Production lifecycle

1. A result is saved to `OrderResult`.
2. A PostgreSQL trigger evaluates the configured critical thresholds in the same transaction.
3. A current `CriticalResult` occurrence is created with the value, direction, threshold and reference-range snapshot.
4. Every notification attempt is stored in `CriticalNotificationAttempt`.
5. Successful phone/electronic notification requires read-back/receipt confirmation.
6. The critical event becomes `NOTIFIED`, then staff can explicitly acknowledge it.
7. All notification and acknowledgement actions create audit records.
8. If a result changes, the previous critical occurrence is retained as `SUPERSEDED` and a new occurrence is created when appropriate.

The queue is tenant-isolated by `labId`.

## Important clinical rule

Do not seed universal critical thresholds. Critical limits are laboratory-, method-, population- and clinician-dependent and must be configured and validated by each laboratory. WHO laboratory quality guidance calls for immediate notification of critical results, documented notification attempts, verifiable communication, and continued attempts when the requester cannot initially be reached.
