/**
 * For the editor only. Edge Functions run on Deno, which provides `Deno` and resolves `npm:` imports itself;
 * a plain TypeScript editor does neither and would flag them. Deno never reads this file (index.ts does not
 * import it); `tsconfig.json` beside it is what makes the editor use it.
 */
declare namespace Deno {
  const env: { get(key: string): string | undefined }
  function serve(handler: (request: Request) => Response | Promise<Response>): unknown
}

declare module 'npm:@supabase/supabase-js@2' {
  export * from '@supabase/supabase-js'
}

declare module 'npm:web-push@3' {
  const webpush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void
    sendNotification(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload?: string, options?: Record<string, unknown>): Promise<unknown>
  }
  export default webpush
}
