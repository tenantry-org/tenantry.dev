-- Two feed tokens created at once for a customer who holds 9: the second waits for the first, and once the first
-- commits it is refused at the limit, rather than counting 9 beside the first's uncommitted token and making 11.
-- create_feed_token takes the customer's row for update before it counts. Each creation needs a transaction of its
-- own that commits, which a test's own transaction cannot do, so two dblink connections play them, signing in with the
-- local stack's default password: it runs against the local database only, as package_casing_race.test.sql does
-- (`supabase test db supabase/local-tests`).
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local role postgres;
set local search_path to public, extensions;

select plan(4);

-- Over the network address this test is connected on: loopback connections are trusted without a password, which
-- dblink refuses.
select dblink_connect('first',
  'host=' || host(inet_server_addr()) || ' port=' || inet_server_port() || ' dbname=' || current_database()
    || ' user=postgres password=postgres');
select dblink_connect('second',
  'host=' || host(inet_server_addr()) || ' port=' || inet_server_port() || ' dbname=' || current_database()
    || ' user=postgres password=postgres');

-- The customer and their 9 tokens, committed so both connections see them; removed at the end.
select dblink_exec('first',
  $$insert into public.customers (customer_id, email) values ('ctm_token_race', 'token-race@example.com')$$);
select count(*) from dblink('first',
  $$select public.create_feed_token('ctm_token_race', 'token ' || n, md5('token-race-' || n) || md5('race-token-' || n),
      'tpf_' || n)
    from generate_series(1, 9) n$$) as created(id uuid);

-- The first creates the 10th token and has not committed.
select dblink_exec('first', 'begin');
select * from dblink('first',
  $$select public.create_feed_token('ctm_token_race', 'tenth', md5('token-race-10') || md5('race-token-10'),
      'tpf_10')$$)
  as created(id uuid);

-- The second creates another at the same time.
select dblink_send_query('second',
  $$select public.create_feed_token('ctm_token_race', 'eleventh', md5('token-race-11') || md5('race-token-11'),
      'tpf_11')$$);
select pg_sleep(0.5);

select is(dblink_is_busy('second'), 1, 'the second creation waits for the first to finish');

select dblink_exec('first', 'commit');

select throws_ok(
  $$select * from dblink_get_result('second') as result(id uuid)$$,
  '23514',
  'Customer ctm_token_race already has 10 feed tokens',
  'once the first commits, the second is refused at the limit');

-- Clean up through a connection of its own.
select dblink_disconnect('second');
select dblink_disconnect('first');
select dblink_connect('clean',
  'host=' || host(inet_server_addr()) || ' port=' || inet_server_port() || ' dbname=' || current_database()
    || ' user=postgres password=postgres');
select is(
  (select n from dblink('clean',
    $$select count(*) from public.feed_tokens where customer_id = 'ctm_token_race' and revoked_at is null$$)
    as remote(n bigint)),
  10::bigint,
  'the customer holds 10 tokens, the first creation''s included');
select dblink_exec('clean', $$delete from public.feed_tokens where customer_id = 'ctm_token_race'$$);
select dblink_exec('clean', $$delete from public.customers where customer_id = 'ctm_token_race'$$);
select is(
  (select n from dblink('clean', $$select count(*) from public.customers where customer_id = 'ctm_token_race'$$)
    as remote(n bigint)),
  0::bigint, 'the connections left nothing behind');
select dblink_disconnect('clean');

select * from finish();
rollback;
