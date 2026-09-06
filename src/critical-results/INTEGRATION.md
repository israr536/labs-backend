Integration checklist:
- Add CriticalResultsModule to AppModule (or the module owning result/report routes).
- Add a Prisma CriticalResult model and migration before enabling the service in production.
- Create the critical event transactionally with result creation/update so the event cannot be lost between evaluation and notification tracking.
- Add audit entries for detection, notification attempts, acknowledgement and release/amendment actions.
- Expose pending critical results only within the authenticated user's lab tenant.
- Do not send patient/clinician data through unaudited background jobs.
