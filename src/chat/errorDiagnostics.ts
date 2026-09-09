/**
 * Human-friendly rephrasings for the raw error messages that the model-fetch
 * path surfaces. Extracted into a standalone module so it can be unit-tested
 * without pulling in the `vscode` runtime.
 */

const DIAGNOSTIC_RULES: readonly [patterns: readonly string[], hint: string][] = [
  [['404'], 'If your Server URL already includes "/v1", remove that suffix — the extension appends it automatically.'],
  [['401', '403'], 'Authentication failed. Paste just the key (no leading "Bearer ") into the API Key setting.'],
  [['abort'], 'The request was aborted. If your server is slow to start, increase the requestTimeout setting.'],
  [['enotfound', 'eai_again'], 'The hostname could not be resolved (DNS). If VS Code is running in a Dev Container, WSL, or a Remote-SSH session, that environment may not resolve internal hostnames the way your local machine does — try the server\'s IP address, or verify the host is resolvable from where the extension runs.'],
  [['etimedout', 'ehostunreach', 'enetunreach'], 'The host resolved but did not respond (timeout/unreachable). Check the port, any firewall or VPN, and that the machine running VS Code can route to the server.'],
  [['econnrefused'], 'Nothing is listening on that host and port. Confirm the server is up and bound to a reachable interface (e.g. start vLLM with --host 0.0.0.0) and that the port is correct.'],
  [['certificate', 'self-signed', 'self signed', 'cert'], 'TLS certificate problem. For an internal or self-signed HTTPS endpoint, either use an http:// URL or install the server\'s CA certificate.'],
  [['econnreset'], 'The connection was reset. A proxy, TLS mismatch (http:// vs https://), or the server closing the socket early can cause this.'],
  [['failed to fetch', 'fetch failed'], 'Is your inference server running and reachable at the configured URL?'],
];

/**
 * Translate a raw fetch-models error message into something the user can act on.
 * Most common failures are easy to diagnose from the text alone — surface the
 * remediation inline so the user doesn't have to dig through the output panel.
 */
export function diagnoseModelFetchError(message: string): string {
  const lower = message.toLowerCase();
  for (const [patterns, hint] of DIAGNOSTIC_RULES) {
    if (patterns.some((p) => lower.includes(p))) {
      return `${message}\n${hint}`;
    }
  }
  return message;
}
