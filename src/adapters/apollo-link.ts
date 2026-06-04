import type { FetchResult, Operation } from '@apollo/client/core'
import { ApolloLink } from '@apollo/client/link/core'
import type { NextLink } from '@apollo/client/link/core'
import { Observable } from '@apollo/client/utilities'
import type { BufferRateLimiter } from '../limiter'

/**
 * Apollo Link that serializes operations through {@link BufferRateLimiter}.
 *
 * For full RateLimit header sync and HTTP 429 handling, prefer `HttpLink` with
 * {@link createBufferedFetch} instead — this link only applies queue + token-bucket pacing.
 */
export class BufferPacingLink extends ApolloLink {
  constructor(private readonly limiter: BufferRateLimiter) {
    super()
  }

  public override request(operation: Operation, forward: NextLink): Observable<FetchResult> {
    return new Observable<FetchResult>((observer) => {
      let subscription: { unsubscribe: () => void } | undefined

      void this.limiter
        .schedule(
          () =>
            new Promise<void>((resolve, reject) => {
              subscription = forward(operation).subscribe({
                next: (result) => observer.next(result),
                error: (error: unknown) => {
                  observer.error(error)
                  reject(error)
                },
                complete: () => {
                  observer.complete()
                  resolve()
                },
              })
            }),
        )
        .catch((error: unknown) => observer.error(error))

      return () => subscription?.unsubscribe()
    })
  }
}
