// Bindings shared by both Workers. Keep in sync with wrangler.toml.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
  }
}

type Env = Cloudflare.Env;
