/**
 * Minimal stand-in for the Supabase query builder in unit tests. Every builder method returns the same
 * chain; `maybeSingle()` resolves to the table's `single` row and awaiting the chain resolves to its
 * `list`. Writes resolve without error. `rpc(name)` resolves to what the matching `rpcs` handler returns.
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

export function fakeSupabase(
  tables: Record<string, FakeTable>,
  calls?: FakeCall[],
  rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {},
) {
  return {
    async rpc(name: string, args: Record<string, unknown> = {}): Promise<Result> {
      calls?.push({ table: `rpc:${name}`, method: 'rpc', args: [args] });
      return { data: rpcs[name]?.(args) ?? null, error: null };
    },
    from(table: string) {
      // A settled promise carrying the builder's methods, so awaiting the chain gives the table's list.
      const listed: Promise<Result> = Promise.resolve({ data: tables[table]?.list ?? [], error: null });
      const chain = listed as Promise<Result> & Record<string, unknown>;
      for (const method of ['select', 'eq', 'gt', 'in', 'order', 'limit', 'update', 'upsert', 'insert', 'delete']) {
        chain[method] = (...args: unknown[]) => {
          calls?.push({ table, method, args });
          return chain;
        };
      }
      chain.maybeSingle = async (): Promise<Result> => ({ data: tables[table]?.single ?? null, error: null });
      return chain;
    },
  };
}
