-- Licences do not expire.
--
-- A licence was a JWT that expired at the end of the billing period, reissued on every renewal, so a customer
-- had to replace the key in their configuration each month or year. Now a customer is issued one key when
-- their access starts and keeps it: Tenantry.Pro accepts any key Tenantry signed, and the subscription gates
-- the private package feed (and so new versions), not the key. Ending access still revokes the customer's
-- licences here, so the portal stops showing them, and a customer who subscribes again gets a new one.
--
-- Existing licences keep working in Tenantry.Pro whatever their exp claim, so none needs reissuing.

alter table public.licences drop column expires_at;
