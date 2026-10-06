import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBillingDeps, type FakeBillingDeps } from '@/test/fake-billing-deps';
import { memory } from '@/test/memory-billing-store';
import { testServerConfig } from '@/test/server-config';
import { syncCustomer } from './customer-access';

let deps: FakeBillingDeps;

beforeEach(() => {
  deps = fakeBillingDeps();
  memory.reset();
  memory.state.emails.set('ctm_1', 'buyer@example.com');
});

const OCTOBER = new Date('2026-10-01T00:00:00Z');
const NOVEMBER = new Date('2026-11-01T00:00:00Z');
const DECEMBER = new Date('2026-12-01T00:00:00Z');

/** A subscription of ctm_1 as Paddle's newest event left it (status is Paddle's); its period does not matter here. */
interface SubscriptionChange {
  subscriptionId?: string;
  status?: string;
  graceStartedAt?: Date;
  currentPeriodEndsAt?: Date;
}

/** Records a subscription change and syncs the customer, as applying a Paddle event does; returns the change. */
async function entitle({ subscriptionId, status, graceStartedAt }: SubscriptionChange = {}) {
  memory.subscribe('ctm_1', { subscriptionId, status, graceStartedAt });
  return (await syncCustomer('ctm_1', deps)).change;
}

/** Syncs the customer with no new event, as reconcile does; returns what happened to the licence. */
async function reconcileLicence() {
  return (await syncCustomer('ctm_1', deps)).licence;
}

function emailSubjects(): string[] {
  return deps.sendEmail.mock.calls.map(([message]) => message.subject);
}

/** The links in the emails sent, which go to this environment's site (testServerConfig's https://sandbox.example.com). */
function emailLinks(): string[] {
  return deps.sendEmail.mock.calls.flatMap(([message]) =>
    [...message.html.matchAll(/<a href="([^"]+)" style="display/g)].map(([, href]) => href),
  );
}

describe('syncCustomer', () => {
  it('records access, issues a licence and welcomes the customer when access starts', async () => {
    await expect(entitle()).resolves.toBe('started');

    expect(memory.state.access.get('ctm_1')).toBe('active');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(emailSubjects()).toEqual(['Welcome to Tenantry Pro: create a feed token to install it']);
    expect(emailLinks()).toEqual(['https://sandbox.example.com/dashboard/pro']);
  });

  it('keeps the one licence through repeated events, renewals and other subscriptions: it does not expire', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.clearAllMocks();

    await expect(entitle()).resolves.toBe('unchanged');
    // Renewal: the billing period moves on. More subscriptions start and one is cancelled.
    await entitle({ currentPeriodEndsAt: NOVEMBER });
    await entitle({ subscriptionId: 'sub_2', currentPeriodEndsAt: OCTOBER });
    await entitle({ subscriptionId: 'sub_3', currentPeriodEndsAt: DECEMBER });
    await expect(entitle({ subscriptionId: 'sub_3', status: 'canceled' })).resolves.toBe('unchanged');

    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.issueLicence).not.toHaveBeenCalled();
    expect(memory.state.access.get('ctm_1')).toBe('active');
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('keeps access while a subscription is in grace, and ends it with the last entitled subscription', async () => {
    await entitle();
    await entitle({ subscriptionId: 'sub_2' });
    vi.clearAllMocks();

    await expect(entitle({ status: 'past_due', graceStartedAt: new Date() })).resolves.toBe('unchanged');
    await expect(entitle({ subscriptionId: 'sub_2', status: 'canceled' })).resolves.toBe('unchanged');
    expect(memory.state.access.get('ctm_1')).toBe('grace');
    expect(deps.sendEmail).not.toHaveBeenCalled();

    await expect(entitle({ status: 'canceled' })).resolves.toBe('ended');
    expect(memory.state.access.get('ctm_1')).toBe('lapsed');
    // The key is kept: it does not decide which releases they may use, and they may keep using the vested ones.
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
    expect(emailLinks()).toEqual(['https://sandbox.example.com/#pricing']);
  });

  it('sends a test customer no email and the operator no alert, whatever happens to its access', async () => {
    memory.state.testCustomers.add('ctm_1');
    // A licence that cannot be issued is alerted on for any other customer.
    deps.issueLicence.mockImplementationOnce(() => {
      throw new Error('signing key missing');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(entitle()).resolves.toBe('started');
    await expect(reconcileLicence()).resolves.toBe('issued');
    await expect(entitle({ status: 'canceled' })).resolves.toBe('ended');

    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.alertOperator).not.toHaveBeenCalled();
  });

  it('does nothing for a customer whose only subscription never entitled them', async () => {
    await expect(entitle({ status: 'canceled' })).resolves.toBe('unchanged');

    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('in manual mode records access but issues no licence, and still ends access and says so', async () => {
    deps.config = testServerConfig({ provisioning: 'manual' });

    await expect(entitle()).resolves.toBe('started');
    expect(memory.state.access.get('ctm_1')).toBe('active');
    expect(memory.licences('ctm_1')).toEqual([]);
    expect(deps.sendEmail).not.toHaveBeenCalled();

    await expect(entitle({ status: 'canceled' })).resolves.toBe('ended');
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('records nothing when reading the subscriptions fails, so the event is retried whole', async () => {
    vi.spyOn(deps.store, 'listSubscriptions').mockRejectedValueOnce(new Error('database unavailable'));

    await expect(entitle()).rejects.toThrow('database unavailable');
    expect(memory.state.access.size).toBe(0);

    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'started' });
    expect(deps.sendEmail).toHaveBeenCalledOnce();
  });
});

describe('licence issuance failures', () => {
  const alerts = () => deps.alertOperator.mock.calls.map(([subject, detail]) => ({ subject, detail }));
  const failSigning = (message: string) =>
    deps.issueLicence.mockImplementation(() => {
      throw new Error(message);
    });
  // Back to the fake's own signing.
  const repairSigning = () => deps.issueLicence.mockReset();

  it('records a signing failure, alerts once, and issues the licence on reconcile once the key is repaired', async () => {
    failSigning('error:1E08010C:DECODER routines::unsupported');

    // The purchase: access starts, but the licence cannot be signed.
    await expect(entitle()).resolves.toBe('started');
    expect(memory.state.access.get('ctm_1')).toBe('active');
    expect(memory.licences('ctm_1')).toEqual([]);
    expect(memory.state.licenceFailures.get('ctm_1')).toEqual({
      attempts: 1,
      lastError: 'error:1E08010C:DECODER routines::unsupported',
    });
    expect(alerts()).toEqual([expect.objectContaining({ subject: 'Licence issuance failed for customer ctm_1' })]);

    // Reconcile retries while the key is still broken: recorded, but no second alert.
    await expect(reconcileLicence()).resolves.toBe('failed');
    expect(memory.state.licenceFailures.get('ctm_1')?.attempts).toBe(2);
    expect(alerts()).toHaveLength(1);

    // The key is repaired; the next reconcile issues the licence, with no new purchase or event.
    repairSigning();
    await expect(reconcileLicence()).resolves.toBe('issued');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(memory.state.licenceFailures.has('ctm_1')).toBe(false);

    await expect(reconcileLicence()).resolves.toBe('current');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(alerts()).toHaveLength(1);
  });

  it('treats a failure to store the licence the same way, recording the database error message', async () => {
    // Supabase reports errors as plain objects, not Error instances.
    vi.spyOn(deps.store, 'recordLicence').mockRejectedValueOnce({
      code: 'P0001',
      message: 'licence storage unavailable',
    });

    await entitle();
    expect(memory.state.licenceFailures.get('ctm_1')?.lastError).toBe('licence storage unavailable');
    expect(alerts()[0].detail).toContain('licence storage unavailable');
    expect(alerts()).toHaveLength(1);

    await expect(reconcileLicence()).resolves.toBe('issued');
    expect(memory.state.licenceFailures.size).toBe(0);
  });

  it('signs nothing for a returning customer, who keeps the licence issued after the first failures', async () => {
    failSigning('signing failed');
    await entitle();
    await reconcileLicence();
    expect(alerts()).toHaveLength(1);

    repairSigning();
    await expect(reconcileLicence()).resolves.toBe('issued');
    const [licence] = memory.licences('ctm_1');

    // The customer leaves and subscribes again while signing is broken: they keep their key, so nothing fails.
    await entitle({ status: 'canceled' });
    failSigning('signing failed');
    await entitle();

    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(memory.state.licenceFailures.has('ctm_1')).toBe(false);
    expect(alerts()).toHaveLength(1);
  });

  it('alerts even when the failure cannot be recorded', async () => {
    failSigning('signing failed');
    vi.spyOn(deps.store, 'recordLicenceFailure').mockRejectedValue(new Error('database unavailable'));

    await entitle();
    await reconcileLicence();

    expect(alerts()).toHaveLength(2);
  });

  it('forgets the failures when access ends', async () => {
    failSigning('signing failed');
    await entitle();

    await entitle({ status: 'canceled' });

    expect(memory.state.licenceFailures.size).toBe(0);
    await expect(reconcileLicence()).resolves.toBeNull();
  });
});

describe('grace period', () => {
  const PAST_DUE = new Date('2026-10-01T00:00:00Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The renewal on 1 October fails: Paddle moves the subscription into its next billing period, unpaid.
  const pastDue = { status: 'past_due', graceStartedAt: PAST_DUE, currentPeriodEndsAt: NOVEMBER };

  it('keeps access and the licence within grace', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.clearAllMocks();
    vi.setSystemTime(PAST_DUE);

    await expect(entitle(pastDue)).resolves.toBe('unchanged');

    expect(memory.state.access.get('ctm_1')).toBe('grace');
    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.sendEmail).not.toHaveBeenCalled();

    // Reconcile during grace changes nothing.
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'unchanged', licence: 'current' });
  });

  it('ends access when grace is over, with no event from Paddle', async () => {
    await entitle();
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    // The daily reconcile after grace has ended.
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'ended', licence: null });

    expect(memory.state.access.get('ctm_1')).toBe('lapsed');
    expect(memory.licences('ctm_1')).toHaveLength(1);
    expect(emailSubjects()).toEqual(['Your Tenantry Pro subscription has ended']);
  });

  it('restores active access, with the same licence, when the payment is recovered within grace', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));
    await expect(entitle({ status: 'active', currentPeriodEndsAt: NOVEMBER })).resolves.toBe('unchanged');

    expect(memory.state.access.get('ctm_1')).toBe('active');
    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.sendEmail).not.toHaveBeenCalled();

    // Grace no longer applies: the recovered subscription stays entitled after the old grace end.
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'unchanged' });
  });

  it("keeps access through another subscription when one subscription's grace ends", async () => {
    await entitle();
    await entitle({ subscriptionId: 'sub_2', currentPeriodEndsAt: NOVEMBER });
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await expect(syncCustomer('ctm_1', deps)).resolves.toMatchObject({ change: 'unchanged' });

    expect(memory.state.access.get('ctm_1')).toBe('active');
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  it('starts access again, with the same licence, when a payment is recovered after grace ended', async () => {
    await entitle();
    const [licence] = memory.licences('ctm_1');
    vi.setSystemTime(PAST_DUE);
    await entitle(pastDue);
    vi.setSystemTime(new Date('2026-10-31T04:00:00Z'));
    await syncCustomer('ctm_1', deps);
    vi.clearAllMocks();

    vi.setSystemTime(new Date('2026-11-02T00:00:00Z'));
    await expect(entitle({ status: 'active', currentPeriodEndsAt: new Date('2026-12-01T00:00:00Z') })).resolves.toBe(
      'started',
    );
    expect(memory.licences('ctm_1')).toEqual([licence]);
    expect(deps.issueLicence).not.toHaveBeenCalled();
  });
});

describe('vesting emails', () => {
  const subjects = () => deps.sendEmail.mock.calls.map(([message]) => message.subject);
  const alerts = () => deps.alertOperator.mock.calls.map(([subject]) => subject);

  async function pay(transactionId: string, startsAt: string, endsAt: string, interval = 'month', priceId?: string) {
    await memory.store.recordPayment({
      transactionId,
      customerId: 'ctm_1',
      subscriptionId: 'sub_1',
      origin: 'subscription_recurring',
      priceId: priceId ?? (interval === 'year' ? 'pri_01year' : 'pri_01month'),
      billingInterval: interval,
      billingFrequency: 1,
      periodStartsAt: startsAt,
      periodEndsAt: endsAt,
      subtotal: 3900,
      discount: 0,
      total: 3900,
      tax: 0,
      currencyCode: 'GBP',
      occurredAt: startsAt,
    });
  }

  const month = (n: number) => new Date(Date.UTC(2026, n, 1)).toISOString();

  it('loses nothing when the offer prices change: time paid at an earlier price still counts, renewals included', async () => {
    memory.subscribe('ctm_1');
    for (let n = 0; n < 12; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    await syncCustomer('ctm_1', deps, new Date('2027-01-01T01:00:00Z'));
    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-01-01T00:00:00Z'));

    // New prices are configured; a subscriber on the old monthly price renews at it.
    deps.config = testServerConfig({
      paddle: { ...testServerConfig().paddle, prices: { month: 'pri_02month', year: 'pri_02year' } },
    });
    await pay('txn_12', month(12), month(13));
    await syncCustomer('ctm_1', deps, new Date('2027-02-01T00:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-02-01T00:00:00Z'));
    expect([...memory.state.offeredPrices].sort()).toEqual(['pri_01month', 'pri_01year', 'pri_02month', 'pri_02year']);
  });

  it('tells the customer once when their paid time vests, not as the vested-through date moves on', async () => {
    memory.subscribe('ctm_1');
    for (let n = 0; n < 12; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    await syncCustomer('ctm_1', deps, new Date('2026-12-15T00:00:00Z'));
    vi.clearAllMocks();

    await syncCustomer('ctm_1', deps, new Date('2027-01-01T01:00:00Z'));
    expect(subjects()).toEqual(['Your Tenantry Pro releases are vested']);
    const [message] = deps.sendEmail.mock.calls[0];
    expect(message.html).toContain('1 January 2027');
    expect(message.html).toContain('href="https://sandbox.example.com/dashboard/pro"');
    vi.clearAllMocks();

    await pay('txn_12', month(12), month(13));
    await syncCustomer('ctm_1', deps, new Date('2027-02-01T01:00:00Z'));
    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-02-01T00:00:00Z'));
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.alertOperator).not.toHaveBeenCalled();
  });

  it('tells the customer and alerts the operator when an annual grant is withdrawn by a refund', async () => {
    memory.subscribe('ctm_1');
    await pay('txn_year', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year');
    await syncCustomer('ctm_1', deps, new Date('2026-01-05T00:00:00Z'));
    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-01-01T00:00:00Z'));
    vi.clearAllMocks();

    await memory.store.recordPaymentAdjustment({
      adjustmentId: 'adj_1',
      transactionId: 'txn_year',
      customerId: 'ctm_1',
      subscriptionId: 'sub_1',
      action: 'refund',
      type: 'full',
      itemTypes: ['full'],
      status: 'approved',
      amount: 3900,
      currencyCode: 'GBP',
      createdAt: '2026-01-08T00:00:00Z',
      updatedAt: '2026-01-08T00:00:00Z',
      occurredAt: '2026-01-08T00:00:00Z',
    });
    await syncCustomer('ctm_1', deps, new Date('2026-01-08T01:00:00Z'));

    expect(subjects()).toEqual(['Your Tenantry Pro vested releases have changed']);
    const [message] = deps.sendEmail.mock.calls[0];
    expect(message.html).toContain('Your annual term no longer vests the releases published up to 1 January 2027');
    expect(message.html).toContain('because money paid for it was refunded or credited');
    expect(message.html).toContain('No releases are vested now.');
    expect(alerts()).toEqual(['Grant withdrawn for customer ctm_1']);

    // Recomputing again changes nothing, and sends nothing.
    vi.clearAllMocks();
    await syncCustomer('ctm_1', deps, new Date('2026-01-09T00:00:00Z'));
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.alertOperator).not.toHaveBeenCalled();
  });

  it('gives the date of an operator grant, as the feed does, when the computed grants vest less', async () => {
    memory.state.operatorGrants.set('ctm_1', [new Date('2026-07-01T00:00:00Z')]);
    memory.subscribe('ctm_1');
    await pay('txn_year', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year');
    await syncCustomer('ctm_1', deps, new Date('2026-01-05T00:00:00Z'));
    await memory.store.recordPaymentAdjustment({
      adjustmentId: 'adj_1',
      transactionId: 'txn_year',
      customerId: 'ctm_1',
      subscriptionId: 'sub_1',
      action: 'refund',
      type: 'full',
      itemTypes: ['full'],
      status: 'approved',
      amount: 3900,
      currencyCode: 'GBP',
      createdAt: '2026-01-08T00:00:00Z',
      updatedAt: '2026-01-08T00:00:00Z',
      occurredAt: '2026-01-08T00:00:00Z',
    });
    vi.clearAllMocks();

    await syncCustomer('ctm_1', deps, new Date('2026-01-08T01:00:00Z'));
    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toBeNull();
    expect(subjects()).toEqual(['Your Tenantry Pro vested releases have changed']);
    expect(deps.sendEmail.mock.calls[0][0].html).toContain('Your vested-through date is now 1 July 2026');
    vi.clearAllMocks();

    memory.subscribe('ctm_1', { status: 'canceled' });
    await syncCustomer('ctm_1', deps, new Date('2026-01-09T00:00:00Z'));
    expect(subjects()).toEqual(['Your Tenantry Pro subscription has ended']);
    expect(deps.sendEmail.mock.calls[0][0].html).toContain('Your vested-through date is 1 July 2026.');
  });

  it('sends no vesting email for a grant that vests nothing beyond an operator grant', async () => {
    memory.state.operatorGrants.set('ctm_1', [new Date('2027-07-01T00:00:00Z')]);
    memory.subscribe('ctm_1');
    await pay('txn_year', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year');
    await syncCustomer('ctm_1', deps, new Date('2026-01-05T00:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(subjects()).not.toContain('Your Tenantry Pro releases are vested');
  });

  it('tells the customer when their paid time vests under a longer operator grant, which their date stays at', async () => {
    memory.state.operatorGrants.set('ctm_1', [new Date('2027-07-01T00:00:00Z')]);
    memory.subscribe('ctm_1');
    for (let n = 0; n < 12; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    await syncCustomer('ctm_1', deps, new Date('2026-12-15T00:00:00Z'));
    vi.clearAllMocks();

    await syncCustomer('ctm_1', deps, new Date('2027-01-01T01:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(subjects()).toEqual(['Your Tenantry Pro releases are vested']);
    expect(deps.sendEmail.mock.calls[0][0].html).toContain('Your paid time has reached 12 paid months');
    expect(deps.sendEmail.mock.calls[0][0].html).toContain('on or before 1 July 2027, your vested-through date');
  });

  async function refund(adjustmentId: string, transactionId: string, at: string, amount = 3900) {
    await memory.store.recordPaymentAdjustment({
      adjustmentId,
      transactionId,
      customerId: 'ctm_1',
      subscriptionId: 'sub_1',
      action: 'refund',
      type: amount >= 3900 ? 'full' : 'partial',
      itemTypes: [amount >= 3900 ? 'full' : 'partial'],
      status: 'approved',
      amount,
      currencyCode: 'GBP',
      createdAt: at,
      updatedAt: at,
      occurredAt: at,
    });
  }

  it('tells the customer and the operator when a refund of a month takes their vesting away', async () => {
    memory.subscribe('ctm_1');
    for (let n = 0; n < 14; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    await syncCustomer('ctm_1', deps, new Date('2027-01-10T00:00:00Z'));
    vi.clearAllMocks();

    // March 2026 refunded: its 31 days are no longer counted, so 12 months are counted only on 1 February 2027.
    await refund('adj_march', 'txn_2', '2027-01-11T00:00:00Z');
    await syncCustomer('ctm_1', deps, new Date('2027-01-11T01:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toBeNull();
    expect(subjects()).toEqual(['Your Tenantry Pro vested releases have changed']);
    const [message] = deps.sendEmail.mock.calls[0];
    expect(message.html).toContain('Your paid time no longer vests the releases published up to 10 January 2027');
    expect(message.html).toContain('because money it relied on was refunded, credited or charged back');
    expect(message.html).toContain('No releases are vested now.');
    expect(alerts()).toEqual(['Vested releases taken away for customer ctm_1']);
  });

  it('says nothing when a refund of an early month leaves 12 months: the date stays the end of the paid time served', async () => {
    memory.subscribe('ctm_1');
    for (let n = 0; n < 26; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    await syncCustomer('ctm_1', deps, new Date('2028-02-10T00:00:00Z'));
    vi.clearAllMocks();

    // January 2026 refunded: 25 months kept, still vested through the paid time served.
    await refund('adj_first', 'txn_0', '2028-02-11T00:00:00Z');
    await syncCustomer('ctm_1', deps, new Date('2028-02-11T00:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2028-02-11T00:00:00Z'));
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.alertOperator).not.toHaveBeenCalled();
  });

  it('tells the customer when a refund of a month before a gap takes their vesting away', async () => {
    memory.subscribe('ctm_1');
    // Six months in 2026, a gap of a year, six months from January 2027: vested on 1 July 2027 (by the allowance).
    for (let n = 0; n < 6; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    for (let n = 12; n < 18; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    await syncCustomer('ctm_1', deps, new Date('2027-07-05T00:00:00Z'));
    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-07-01T00:00:00Z'));
    vi.clearAllMocks();

    await refund('adj_feb', 'txn_1', '2027-07-06T00:00:00Z');
    await syncCustomer('ctm_1', deps, new Date('2027-07-06T01:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toBeNull();
    expect(subjects()).toEqual(['Your Tenantry Pro vested releases have changed']);
    expect(deps.sendEmail.mock.calls[0][0].html).toContain(
      'Your paid time no longer vests the releases published up to 1 July 2027',
    );
    expect(alerts()).toEqual(['Vested releases taken away for customer ctm_1']);
  });

  it('says the vested-through date moves forward as paid time is served', async () => {
    memory.subscribe('ctm_1');
    for (let n = 0; n < 12; n++) await pay(`txn_${n}`, month(n), month(n + 1));
    await syncCustomer('ctm_1', deps, new Date('2027-01-01T01:00:00Z'));

    const [message] = deps.sendEmail.mock.calls.filter(
      ([m]) => m.subject === 'Your Tenantry Pro releases are vested',
    )[0];
    expect(message.html).toContain('moves forward as further paid time is served');
    expect(message.html).not.toContain('end of each paid month');
  });

  it.each([
    [6, 'and no releases are vested, so the package feed now serves you none'],
    [12, 'You have paid for time up to 1 January 2027, which brings your paid time to 12 paid months.'],
  ])(
    'tells a customer cancelled mid-month with nothing refunded that the time paid for still runs only if it reaches 12 months: %i paid',
    async (paidMonths, wording) => {
      memory.subscribe('ctm_1');
      for (let n = 0; n < paidMonths; n++) await pay(`txn_${n}`, month(n), month(n + 1));
      const cancelledAt = new Date(Date.UTC(2026, paidMonths - 1, 15));
      await syncCustomer('ctm_1', deps, cancelledAt);
      vi.clearAllMocks();

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(cancelledAt);
      memory.subscribe('ctm_1', { status: 'canceled' });
      await syncCustomer('ctm_1', deps, new Date(cancelledAt.getTime() + 10 * 60 * 1000));
      vi.useRealTimers();

      expect(subjects()).toEqual(['Your Tenantry Pro subscription has ended']);
      expect(deps.sendEmail.mock.calls[0][0].html).toContain(wording);
    },
  );

  it.each([
    [6, 'Your vested-through date is 1 March 2026. The vested releases'],
    [12, 'Your vested-through date is 1 March 2026, and it moves on to 1 January 2027 as the time you have paid for'],
  ])(
    'says the date of an operator grant moves on after a mid-month cancel only if paid time reaches 12 months: %i paid',
    async (paidMonths, wording) => {
      memory.state.operatorGrants.set('ctm_1', [new Date('2026-03-01T00:00:00Z')]);
      memory.subscribe('ctm_1');
      for (let n = 0; n < paidMonths; n++) await pay(`txn_${n}`, month(n), month(n + 1));
      const cancelledAt = new Date(Date.UTC(2026, paidMonths - 1, 15));
      await syncCustomer('ctm_1', deps, cancelledAt);
      vi.clearAllMocks();

      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(cancelledAt);
      memory.subscribe('ctm_1', { status: 'canceled' });
      await syncCustomer('ctm_1', deps, new Date(cancelledAt.getTime() + 10 * 60 * 1000));
      vi.useRealTimers();

      expect(subjects()).toEqual(['Your Tenantry Pro subscription has ended']);
      expect(deps.sendEmail.mock.calls[0][0].html).toContain(wording);
    },
  );

  it('tells the customer an annual term is vested when it is paid, and not again at its end', async () => {
    memory.subscribe('ctm_1');
    await pay('txn_year', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year');
    await syncCustomer('ctm_1', deps, new Date('2026-01-01T00:10:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-01-01T00:00:00Z'));
    const vested = deps.sendEmail.mock.calls.filter(([m]) => m.subject === 'Your Tenantry Pro releases are vested');
    expect(vested).toHaveLength(1);
    const [[message]] = vested;
    expect(message.html).toContain(
      'Your annual term is paid, so every Tenantry Pro release published on or before 1 January 2027',
    );
    expect(message.html).toContain('including those published later in the term');
    expect(message.html).toContain("A refund, credit or chargeback of any of the term's payments withdraws them");
    expect(message.html).not.toContain('moves forward as your paid time is served');
    vi.clearAllMocks();

    // The term ends: its 12 paid months vest as paid time too, through the same date.
    await syncCustomer('ctm_1', deps, new Date('2027-01-01T04:00:00Z'));
    expect(subjects()).not.toContain('Your Tenantry Pro releases are vested');
  });

  it('tells the customer when a second annual term vests the next year', async () => {
    memory.subscribe('ctm_1');
    await pay('txn_year_1', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year');
    await syncCustomer('ctm_1', deps, new Date('2026-01-01T00:10:00Z'));
    vi.clearAllMocks();

    await pay('txn_year_2', '2027-01-01T00:00:00Z', '2028-01-01T00:00:00Z', 'year');
    await syncCustomer('ctm_1', deps, new Date('2027-01-01T00:10:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2028-01-01T00:00:00Z'));
    expect(subjects()).toEqual(['Your Tenantry Pro releases are vested']);
    expect(deps.sendEmail.mock.calls[0][0].html).toContain('1 January 2028, the end of the term');
  });

  it('keeps an annual term vested when the subscription is cancelled a day in, and withdraws it on a chargeback', async () => {
    memory.subscribe('ctm_1');
    await pay('txn_year', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year');
    await syncCustomer('ctm_1', deps, new Date('2026-01-01T00:10:00Z'));

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-02T00:00:00Z'));
    memory.subscribe('ctm_1', { status: 'canceled' });
    await syncCustomer('ctm_1', deps, new Date('2026-01-02T00:10:00Z'));
    vi.useRealTimers();

    expect(memory.state.entitlementStates.get('ctm_1')).toMatchObject({
      access: { status: 'lapsed' },
      vestedThrough: new Date('2027-01-01T00:00:00Z'),
    });
    vi.clearAllMocks();

    await memory.store.recordPaymentAdjustment({
      adjustmentId: 'adj_dispute',
      transactionId: 'txn_year',
      customerId: 'ctm_1',
      subscriptionId: 'sub_1',
      action: 'chargeback',
      type: 'full',
      itemTypes: ['full'],
      status: 'approved',
      amount: 3900,
      currencyCode: 'GBP',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
      occurredAt: '2026-02-01T00:00:00Z',
    });
    await syncCustomer('ctm_1', deps, new Date('2026-02-01T01:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toBeNull();
    expect(subjects()).toEqual(['Your Tenantry Pro vested releases have changed']);
    expect(deps.sendEmail.mock.calls[0][0].html).toContain(
      'Your annual term no longer vests the releases published up to 1 January 2027, because a payment it relied on was charged back',
    );
    expect(alerts()).toEqual(['Grant withdrawn for customer ctm_1']);
  });

  it('restores an annual term, and says so, when its chargeback is reversed', async () => {
    memory.subscribe('ctm_1');
    await pay('txn_year', '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 'year');
    const dispute = {
      adjustmentId: 'adj_dispute',
      transactionId: 'txn_year',
      customerId: 'ctm_1',
      subscriptionId: 'sub_1',
      action: 'chargeback',
      type: 'full',
      itemTypes: ['full'],
      status: 'approved',
      amount: 3900,
      currencyCode: 'GBP',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
      occurredAt: '2026-02-01T00:00:00Z',
    };
    await memory.store.recordPaymentAdjustment(dispute);
    await syncCustomer('ctm_1', deps, new Date('2026-02-01T01:00:00Z'));
    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toBeNull();
    vi.clearAllMocks();

    // The dispute is won: Paddle marks the chargeback reversed.
    await memory.store.recordPaymentAdjustment({
      ...dispute,
      status: 'reversed',
      updatedAt: '2026-03-01T00:00:00Z',
      occurredAt: '2026-03-01T00:00:00Z',
    });
    await syncCustomer('ctm_1', deps, new Date('2026-03-01T01:00:00Z'));

    expect(memory.state.entitlementStates.get('ctm_1')?.vestedThrough).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(subjects()).toEqual(['Your Tenantry Pro releases are vested']);
  });
});
