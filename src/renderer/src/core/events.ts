export type Listener<T> = (payload: T) => void

/** Minimal typed event emitter. */
export class Emitter<M extends { [k: string]: any }> {
  private map = new Map<keyof M, Set<Listener<any>>>()

  on<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void {
    let s = this.map.get(type)
    if (!s) this.map.set(type, (s = new Set()))
    s.add(fn)
    return () => this.off(type, fn)
  }
  off<K extends keyof M>(type: K, fn: Listener<M[K]>): void {
    this.map.get(type)?.delete(fn)
  }
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const s = this.map.get(type)
    if (!s) return
    for (const fn of [...s]) {
      try {
        fn(payload)
      } catch (e) {
        console.error(`[events] listener for "${String(type)}" threw`, e)
      }
    }
  }
}
