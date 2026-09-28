/**
 * Minimal stand-in for the Supabase query builder in unit tests. Every builder method returns the same
 * chain; `maybeSingle()` resolves to the table's `single` row and awaiting the chain resolves to its
 * `list`. Writes resolve without error.
 */
export interface FakeTable {
  list?: unknown[];
  single?: unknown;
}

/** A builder call, recorded when `fakeSupabase` is given a `calls` array. */
export interface FakeCall {
  table: string;
  method: string;
  args: unknown[];
}

type Result = { data: unknown; error: null };

export function fakeSupabase(tables: Record<string, FakeTable>, calls?: FakeCall[]) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'limit', 'update', 'upsert', 'insert']) {
        chain[method] = (...args: unknown[]) => {
          calls?.push({ table, method, args });
          return chain;
        };
      }
      chain.maybeSingle = async (): Promise<Result> => ({ data: tables[table]?.single ?? null, error: null });
      chain.then = (resolve: (value: Result) => unknown) => resolve({ data: tables[table]?.list ?? [], error: null });
      return chain;
    },
  };
}
