#!/usr/bin/env node
/**
 * Rehearses, in the sandbox, customer states that take a year or a payment dispute to reach in real time, by writing
 * the ledger rows those states come from, then recomputing the customer the way the site always does (a reconcile job,
 * run by /api/reconcile). Nothing here is reachable by a customer: it runs on the operator's machine with the sandbox
 * database's service-role key, and refuses to run unless the environment is the sandbox.
 *
 *   node --env-file=<sandbox env file> scripts/rehearse.mjs <command> <customer email> [arguments]
 *
 *   vested <email>                 12 paid months before the customer's first real payment, so the qualifying period
 *                                  has reached 12 months: the releases published up to that payment's start are vested
 *   annual <email>                 a completed annual term before the customer's first real payment: its grant is
 *                                  confirmed, and the same releases are vested
 *   refund <email>                 an approved full refund of the newest rehearsal payment, now: a refund after vesting
 *                                  leaves the vesting in place
 *   chargeback <email>             an approved chargeback of the newest rehearsal payment, now: it withdraws the
 *                                  vesting that relied on it
 *   grant <email> <date> <note>    an operator grant vesting the releases published up to <date> (ISO 8601)
 *   undo <email>                   deletes every row this script wrote for the customer
 *   show <email>                   prints the customer's access, grants and payments
 *
 * Every row it writes is marked: payments `txn_rehearsal_…`, adjustments `adj_rehearsal_…`, operator grants a note
 * starting `Rehearsal:`. `undo` deletes exactly those. Paddle never sends those ids, and reconcile only adds payments
 * Paddle lists, so the rows stay until undone.
 *
 * It reads NEXT_PUBLIC_PADDLE_ENV, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and, to run the reconcile
 * itself, NEXT_PUBLIC_SITE_URL and CRON_SECRET (otherwise it prints the command). It refuses unless
 * NEXT_PUBLIC_PADDLE_ENV is `sandbox` and the Supabase URL is not production's.
 */
import { createClient } from '@supabase/supabase-js';
import { PRODUCTION_SUPABASE_URL } from './production-environment.mjs';

const TXN = 'txn_rehearsal_';
const ADJ = 'adj_rehearsal_';
const NOTE = 'Rehearsal:';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, email, ...rest] = process.argv.slice(2);
const COMMANDS = ['vested', 'annual', 'refund', 'chargeback', 'grant', 'undo', 'show'];
if (!COMMANDS.includes(command) || !email) {
  fail(`Usage: node --env-file=<sandbox env file> scripts/rehearse.mjs <${COMMANDS.join('|')}> <customer email> …`);
}

// The sandbox, and only the sandbox: the same signals the server checks at startup (server-config.ts).
const { NEXT_PUBLIC_PADDLE_ENV, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (NEXT_PUBLIC_PADDLE_ENV !== 'sandbox') {
  fail(`Refusing: NEXT_PUBLIC_PADDLE_ENV is ${JSON.stringify(NEXT_PUBLIC_PADDLE_ENV ?? null)}, not "sandbox".`);
}
if (!NEXT_PUBLIC_SUPABASE_URL || !URL.canParse(NEXT_PUBLIC_SUPABASE_URL))
  fail('Refusing: NEXT_PUBLIC_SUPABASE_URL is not set.');
if (new URL(NEXT_PUBLIC_SUPABASE_URL).origin === new URL(PRODUCTION_SUPABASE_URL).origin) {
  fail("Refusing: NEXT_PUBLIC_SUPABASE_URL is production's database.");
}
if (!SUPABASE_SERVICE_ROLE_KEY)
  fail('Refusing: SUPABASE_SERVICE_ROLE_KEY is not set (the sandbox project’s service-role key).');

const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function query(promise) {
  const { data, error } = await promise;
  if (error) fail(`The database refused: ${error.message}`);
  return data;
}

const customer = await query(
  db.from('customers').select('customer_id').eq('email', email.trim().toLowerCase()).maybeSingle(),
);
if (!customer) fail(`No customer has the email ${email}: subscribe with it in the sandbox first.`);
const customerId = customer.customer_id;

/** `date` moved by whole calendar months, in UTC, as entitlement-policy.ts counts them. */
function addMonths(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  );
}

async function firstRealPayment() {
  const payments = await query(
    db
      .from('payments')
      .select('*')
      .eq('customer_id', customerId)
      .not('transaction_id', 'like', `${TXN}%`)
      .order('period_starts_at')
      .limit(1),
  );
  if (payments.length === 0) {
    fail(
      'The customer has no payment recorded yet. Subscribe in the sandbox and wait for transaction.completed first.',
    );
  }
  return payments[0];
}

async function newestRehearsalPayment() {
  const payments = await query(
    db
      .from('payments')
      .select('transaction_id,subscription_id')
      .eq('customer_id', customerId)
      .like('transaction_id', `${TXN}%`)
      .order('period_starts_at', { ascending: false })
      .limit(1),
  );
  if (payments.length === 0) fail('The customer has no rehearsal payment: run `vested` or `annual` first.');
  return payments[0];
}

// Paid periods before the anchor payment's start, each a copy of it with its own period, as Paddle would have billed.
async function insertPeriods(anchor, periods, interval) {
  const now = new Date().toISOString();
  const rows = periods.map(([startsAt, endsAt], n) => ({
    transaction_id: `${TXN}${customerId}_${interval}_${n}_${startsAt.getTime()}`,
    customer_id: customerId,
    subscription_id: anchor.subscription_id,
    origin: 'subscription_recurring',
    price_id: anchor.price_id,
    billing_interval: interval,
    billing_frequency: 1,
    period_starts_at: startsAt.toISOString(),
    period_ends_at: endsAt.toISOString(),
    subtotal: Math.max(Number(anchor.subtotal), 1),
    discount: 0,
    total: Math.max(Number(anchor.total), 1),
    currency_code: anchor.currency_code,
    completed_at: startsAt.toISOString(),
    last_event_at: now,
  }));
  await query(db.from('payments').upsert(rows, { onConflict: 'transaction_id', ignoreDuplicates: true }));
  return rows.map((row) => `${row.transaction_id}: ${row.period_starts_at} to ${row.period_ends_at}`);
}

async function adjust(action) {
  const payment = await newestRehearsalPayment();
  const now = new Date().toISOString();
  const adjustmentId = `${ADJ}${action}_${customerId}_${Date.now()}`;
  await query(
    db.from('payment_adjustments').insert({
      adjustment_id: adjustmentId,
      transaction_id: payment.transaction_id,
      customer_id: customerId,
      subscription_id: payment.subscription_id,
      action,
      type: 'full',
      item_types: ['full'],
      status: 'approved',
      approved_at: now,
      last_event_at: now,
    }),
  );
  return [`${adjustmentId}: an approved ${action} of ${payment.transaction_id}`];
}

async function show() {
  const [state, grants, payments, adjustments] = await Promise.all([
    query(db.from('active_subscriptions').select('*').eq('customer_id', customerId).maybeSingle()),
    query(
      db
        .from('vested_entitlements')
        .select('kind,started_at,vested_through,status,withdrawn_reason,note')
        .eq('customer_id', customerId)
        .order('started_at'),
    ),
    query(
      db
        .from('payments')
        .select('transaction_id,billing_interval,period_starts_at,period_ends_at,status')
        .eq('customer_id', customerId)
        .order('period_starts_at'),
    ),
    query(
      db
        .from('payment_adjustments')
        .select('adjustment_id,transaction_id,action,type,status,approved_at')
        .eq('customer_id', customerId),
    ),
  ]);
  console.log(JSON.stringify({ customerId, access: state, grants, payments, adjustments }, null, 2));
}

async function reconcile() {
  // A reconcile job for this customer, as the reconcile run queues them (customer_jobs), so it runs even for a lapsed
  // customer the run would not pick, in order with the customer's other jobs.
  const at = new Date().toISOString();
  await query(
    db
      .from('customer_jobs')
      .upsert(
        { id: `reconcile_${customerId}_${at}`, kind: 'reconcile', customer_id: customerId, occurred_at: at },
        { onConflict: 'id', ignoreDuplicates: true },
      ),
  );

  const { NEXT_PUBLIC_SITE_URL, CRON_SECRET } = process.env;
  const command = `curl -X POST ${NEXT_PUBLIC_SITE_URL ?? '<sandbox site>'}/api/reconcile -H "Authorization: Bearer $CRON_SECRET"`;
  if (!NEXT_PUBLIC_SITE_URL || !CRON_SECRET) {
    console.log(`Queued a reconcile of ${customerId}. Run it now:\n  ${command}`);
    return;
  }
  const response = await fetch(`${NEXT_PUBLIC_SITE_URL}/api/reconcile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  if (!response.ok) {
    console.log(`The reconcile answered ${response.status}; the job stays queued. Run it with:\n  ${command}`);
    return;
  }
  console.log(`Reconciled: ${await response.text()}`);
  await show();
}

let written;
switch (command) {
  case 'show':
    await show();
    process.exit(0);
    break;
  case 'vested': {
    const anchor = await firstRealPayment();
    const start = new Date(anchor.period_starts_at);
    const periods = Array.from({ length: 12 }, (_, n) => [addMonths(start, n - 12), addMonths(start, n - 11)]);
    written = await insertPeriods(anchor, periods, 'month');
    break;
  }
  case 'annual': {
    const anchor = await firstRealPayment();
    const start = new Date(anchor.period_starts_at);
    written = await insertPeriods(anchor, [[addMonths(start, -12), start]], 'year');
    break;
  }
  case 'refund':
  case 'chargeback':
    written = await adjust(command);
    break;
  case 'grant': {
    const [through, ...noteWords] = rest;
    if (!through || Number.isNaN(new Date(through).getTime())) {
      fail('Usage: grant <email> <vested-through date, ISO 8601> <note>');
    }
    if (noteWords.length === 0) fail('An operator grant needs a note saying why.');
    const now = new Date().toISOString();
    await query(
      db.from('vested_entitlements').insert({
        customer_id: customerId,
        kind: 'operator',
        started_at: now,
        vested_through: new Date(through).toISOString(),
        status: 'confirmed',
        confirmed_at: now,
        note: `${NOTE} ${noteWords.join(' ')}`,
      }),
    );
    written = [`an operator grant vested through ${new Date(through).toISOString()}`];
    break;
  }
  case 'undo': {
    const payments = await query(
      db
        .from('payments')
        .delete()
        .eq('customer_id', customerId)
        .like('transaction_id', `${TXN}%`)
        .select('transaction_id'),
    );
    const adjustments = await query(
      db
        .from('payment_adjustments')
        .delete()
        .eq('customer_id', customerId)
        .like('adjustment_id', `${ADJ}%`)
        .select('adjustment_id'),
    );
    const grants = await query(
      db
        .from('vested_entitlements')
        .delete()
        .eq('customer_id', customerId)
        .eq('kind', 'operator')
        .like('note', `${NOTE}%`)
        .select('id'),
    );
    written = [
      `deleted ${payments.length} payments, ${adjustments.length} adjustments and ${grants.length} operator grants`,
    ];
    break;
  }
}

console.log(`${command} for ${customerId}:\n  ${written.join('\n  ')}`);
await reconcile();
