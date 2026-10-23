-- Seed data for local development and integration tests.

create schema shop;

create table shop.customers (
  id bigint generated always as identity primary key,
  email text not null unique,
  name text,
  created_at timestamptz not null default now()
);

create table shop.orders (
  id bigint generated always as identity primary key,
  customer_id bigint not null references shop.customers (id),
  total numeric(12, 2) not null,
  status text not null default 'new',
  meta jsonb,
  placed_at timestamptz not null default now()
);

create index orders_customer_id_idx on shop.orders (customer_id);

create view shop.order_totals as
  select customer_id, count(*) as orders, sum(total) as total
    from shop.orders
   group by customer_id;

insert into shop.customers (email, name)
select 'user' || n || '@example.com', 'User ' || n
  from generate_series(1, 500) as n;

insert into shop.orders (customer_id, total, status, meta)
select 1 + (n % 500), round((random() * 500)::numeric, 2),
       (array['new', 'paid', 'shipped'])[1 + n % 3],
       jsonb_build_object('source', 'seed', 'n', n)
  from generate_series(1, 20000) as n;

create sequence shop.ticket_seq;

analyze;
