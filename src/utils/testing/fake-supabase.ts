/**
 * Minimal stand-in for the Supabase query builder in unit tests. Every builder method returns the same
 * chain; `maybeSingle()` resolves to the table's `single` row and awaiting the chain resolves to its
 * `list`. Writes resolve without error.
 */
export interface FakeTable {
  list?: unknown[];
  single?: unknown;
}

type Result = { data: unknown; error: null };

export function fakeSupabase(tables: Record<string, FakeTable>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'in', 'limit', 'update', 'upsert', 'insert']) {
        chain[method] = () => chain;
      }
      chain.maybeSingle = async (): Promise<Result> => ({ data: tables[table]?.single ?? null, error: null });
      chain.then = (resolve: (value: Result) => unknown) => resolve({ data: tables[table]?.list ?? [], error: null });
      return chain;
    },
  };
}
