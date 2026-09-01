/**
 * Generic reactive snapshot store — mirrors DSH's reactive-list pattern
 * (`.getSnapshot()` + `.subscribe()` returning an unsubscribe function).
 *
 * Used by SessionService and WorkspaceService to provide the reactive
 * data surface that client-side DSH modules expect.
 */

export class ReactiveSnapshot<T> {
  private state: T
  private readonly subscribers = new Set<(snapshot: T) => void>()

  constructor(initial: T) {
    this.state = initial
  }

  getSnapshot(): T {
    return this.state
  }

  subscribe(fn: (snapshot: T) => void): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  setSnapshot(next: T): void {
    this.state = next
    for (const fn of this.subscribers) {
      try {
        fn(next)
      } catch {
        // Subscriber errors must not break the notification loop.
      }
    }
  }
}
