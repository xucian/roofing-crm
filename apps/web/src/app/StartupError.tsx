export function StartupError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="startup-error">
      <h1>The CRM could not start</h1>
      <p>{message}</p>
      <p>
        Reload the page. If this keeps happening, the deployment&apos;s /config.json needs fixing
        (docs/runbook.md).
      </p>
    </main>
  );
}
