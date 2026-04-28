/**
 * Fastify app construction. Single route: `POST /auth/token`.
 *
 * Kept thin so app construction is testable via Fastify's `inject()` without
 * spinning up an HTTP listener. The exchanger is dependency-injected, so
 * tests pass a mock and verify request/response semantics deterministically.
 */

import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ExchangeError, type Exchanger } from './exchange.js';

export type ServerOptions = {
  readonly exchanger: Exchanger;
  readonly corsOrigins?: readonly string[];
  /** Pass to override Fastify's default logger (e.g., for silent tests). */
  readonly logger?: boolean | object;
};

const RequestSchema = z.object({
  code: z.string().min(1),
  code_verifier: z.string().min(1),
  redirect_uri: z.string().url(),
});

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? true,
  });

  if (opts.corsOrigins !== undefined && opts.corsOrigins.length > 0) {
    await app.register(cors, {
      origin: [...opts.corsOrigins],
      credentials: false,
      methods: ['POST', 'OPTIONS'],
      allowedHeaders: ['content-type'],
    });
  }

  // Health probe — useful for orchestrators that want to know the sidecar
  // is alive without actually attempting an exchange.
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.post('/auth/token', async (req, reply) => {
    const parseResult = RequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: parseResult.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      });
    }
    const { code, code_verifier, redirect_uri } = parseResult.data;
    try {
      const result = await opts.exchanger.exchange({
        code,
        codeVerifier: code_verifier,
        redirectUri: redirect_uri,
      });
      // Return the standard OAuth response shape (snake_case) so the client
      // can use it the way it would a direct OIDC response.
      return reply.send({
        access_token: result.accessToken,
        token_type: result.tokenType,
        ...(result.refreshToken !== undefined ? { refresh_token: result.refreshToken } : {}),
        ...(result.idToken !== undefined ? { id_token: result.idToken } : {}),
        ...(result.expiresIn !== undefined ? { expires_in: result.expiresIn } : {}),
        ...(result.scope !== undefined ? { scope: result.scope } : {}),
      });
    } catch (e) {
      if (e instanceof ExchangeError) {
        const status =
          e.code === 'invalid_redirect_uri' || e.code === 'invalid_request' ? 400 : 502;
        return reply.status(status).send({
          error: e.code,
          error_description: e.message,
        });
      }
      req.log.error({ err: e }, 'unexpected exchange failure');
      return reply.status(500).send({
        error: 'internal_error',
        error_description: 'Unexpected exchange failure.',
      });
    }
  });

  return app;
}
