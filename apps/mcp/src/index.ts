// Founder Cockpit — mcp Worker. Scaffold only: real routes arrive in a later gate.
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ ok: true, service: 'mcp' });
    }
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
