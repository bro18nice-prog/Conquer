-- Conquer pilot. Run once in the SQL editor of a NEW Supabase project.
-- Raw routes are private. All writes pass through validated, atomic RPCs.
begin;
create schema if not exists gis;
create extension if not exists postgis with schema gis;
do $$ begin
 if (select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis') <> 'gis' then
  raise exception 'PostGIS există în altă schemă. Adaptează prefixul gis din migrare înainte de rulare.';
 end if;
end $$;
create schema if not exists conquer_private;
revoke all on schema conquer_private from public,anon,authenticated;

create table if not exists conquer_private.groups(
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(name) between 1 and 50),
 owner_id uuid not null references auth.users(id) on delete cascade,
 invite text not null unique default replace(gen_random_uuid()::text,'-',''),
 created_at timestamptz not null default now()
);
create table if not exists conquer_private.members(
 user_id uuid primary key references auth.users(id) on delete cascade,
 group_id uuid not null references conquer_private.groups(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 30),
 color text not null,
 joined_at timestamptz not null default now(),
 unique(group_id,user_id)
);
create index if not exists members_group on conquer_private.members(group_id);
create table if not exists conquer_private.runs(
 id uuid primary key,
 group_id uuid not null references conquer_private.groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 fingerprint text not null,
 points jsonb not null,
 distance_m double precision not null,
 area_m2 double precision not null,
 reason text not null,
 accepted_at timestamptz not null default now(),
 unique(user_id,fingerprint)
);
create index if not exists runs_user_date on conquer_private.runs(user_id,accepted_at);
create table if not exists conquer_private.territories(
 group_id uuid not null references conquer_private.groups(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 geom gis.geometry(MultiPolygon,4326) not null,
 primary key(group_id,user_id)
);
create index if not exists territories_geom on conquer_private.territories using gist(geom);
alter table conquer_private.groups enable row level security;
alter table conquer_private.members enable row level security;
alter table conquer_private.runs enable row level security;
alter table conquer_private.territories enable row level security;
revoke all on all tables in schema conquer_private from public,anon,authenticated;


-- Realtime publishes only a revision number, never route coordinates.
create table if not exists public.conquer_updates(
 group_id uuid primary key references conquer_private.groups(id) on delete cascade,
 revision bigint not null default 1
);
alter table public.conquer_updates enable row level security;
revoke all on public.conquer_updates from public,anon,authenticated;
grant select on public.conquer_updates to authenticated;
create or replace function public.conquer_is_member(gid uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from conquer_private.members m where m.group_id=gid and m.user_id=auth.uid())
$$;
revoke all on function public.conquer_is_member(uuid) from public,anon;
grant execute on function public.conquer_is_member(uuid) to authenticated;
drop policy if exists conquer_member_updates on public.conquer_updates;
create policy conquer_member_updates on public.conquer_updates for select to authenticated
 using(public.conquer_is_member(group_id));
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
 and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='conquer_updates') then
  alter publication supabase_realtime add table public.conquer_updates;
 end if;
end $$;

create or replace function public.conquer_create_group(player_name text,group_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); gid uuid;
begin
 if uid is null then raise exception 'Autentificare necesară.'; end if;
 if player_name is null or char_length(trim(player_name)) not between 1 and 30 or group_name is null or char_length(trim(group_name)) not between 1 and 50 then raise exception 'Nume nevalid.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 if exists(select 1 from conquer_private.members where user_id=uid) then raise exception 'Ești deja într-un grup.'; end if;
 insert into conquer_private.groups(name,owner_id) values(trim(group_name),uid) returning id into gid;
 insert into conquer_private.members(user_id,group_id,name,color) values(uid,gid,trim(player_name),'#d5fc51');
 insert into public.conquer_updates(group_id) values(gid);
 return gid;
end $$;

create or replace function public.conquer_join_group(player_name text,invite_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); gid uuid; existing uuid; n integer; colors text[]:=array['#d5fc51','#a68bfa','#54c9e9','#ff9a76','#ed89c5'];
begin
 if uid is null then raise exception 'Autentificare necesară.'; end if;
 if player_name is null or char_length(trim(player_name)) not between 1 and 30 or invite_code is null or char_length(trim(invite_code))<>32 then raise exception 'Nume sau cod de invitație nevalid.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select id into gid from conquer_private.groups where invite=lower(trim(invite_code)) for update;
 if gid is null then raise exception 'Cod de invitație nevalid.'; end if;
 select group_id into existing from conquer_private.members where user_id=uid;
 if existing=gid then return gid; end if;
 if existing is not null then raise exception 'Ești deja într-un alt grup.'; end if;
 select count(*) into n from conquer_private.members where group_id=gid;
 if n>=5 then raise exception 'Grupul are deja 5 jucători.'; end if;
 insert into conquer_private.members(user_id,group_id,name,color) values(uid,gid,trim(player_name),colors[n+1]);
 update public.conquer_updates set revision=revision+1 where group_id=gid;
 return gid;
end $$;

create or replace function public.conquer_snapshot()
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); gid uuid; result jsonb;
begin
 if uid is null then raise exception 'Autentificare necesară.'; end if;
 select group_id into gid from conquer_private.members where user_id=uid;
 if gid is null then return null; end if;
 select jsonb_build_object(
 'group',jsonb_build_object('id',g.id,'name',g.name,'invite',g.invite),
 'players',(select coalesce(jsonb_agg(jsonb_build_object('id',m.user_id,'name',m.name,'color',m.color) order by m.joined_at),'[]'::jsonb) from conquer_private.members m where m.group_id=gid),
 'territories',(select coalesce(jsonb_agg(jsonb_build_object('playerId',t.user_id,'polygon',gis.st_asgeojson(t.geom)::jsonb->'coordinates','area',gis.st_area(t.geom::gis.geography,false))),'[]'::jsonb) from conquer_private.territories t where t.group_id=gid)
 ) into result from conquer_private.groups g where g.id=gid;
 return result;
end $$;

create or replace function public.conquer_rotate_invite()
returns text language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); token text;
begin
 if uid is null then raise exception 'Autentificare necesară.'; end if;
 update conquer_private.groups set invite=replace(gen_random_uuid()::text,'-','') where owner_id=uid returning invite into token;
 if token is null then raise exception 'Doar creatorul grupului poate schimba invitația.'; end if;
 return token;
end $$;

create or replace function public.conquer_submit(run_id uuid,points jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); gid uuid; fp text; old conquer_private.runs%rowtype;
 p jsonb; lat double precision; lon double precision; acc double precision; ts double precision;
 prev_ts double precision; first_ts double precision; last_raw_ts double precision;
 point_geom gis.geometry; previous_geom gis.geometry; first_geom gis.geometry;
 vertices gis.geometry[]:=array[]::gis.geometry[];
 line_geom gis.geometry; poly gis.geometry;
 dist double precision:=0; step double precision; m2 double precision:=0; count_good integer:=0;
 reason text:='Teritoriu cucerit'; blocked boolean:=false;
begin
 if uid is null then raise exception 'Autentificare necesară.'; end if;
 select group_id into gid from conquer_private.members where user_id=uid;
 if gid is null then raise exception 'Intră într-un grup înainte de sincronizare.'; end if;
 -- All group claims take the same row lock. No overlap update can interleave.
 perform 1 from conquer_private.groups where id=gid for update;
 if run_id is null or points is null or jsonb_typeof(points)<>'array' then raise exception 'Activitate nevalidă.'; end if;
 if jsonb_array_length(points)>10000 or octet_length(points::text)>2500000 then raise exception 'Activitatea depășește limita pilotului.'; end if;
 fp:=md5(points::text);
 select * into old from conquer_private.runs where id=run_id;
 if found then
  if old.user_id<>uid or old.fingerprint<>fp then raise exception 'Identificator de activitate deja utilizat.'; end if;
  return jsonb_build_object('area',old.area_m2,'distance',old.distance_m,'reason',old.reason,'duplicate',true);
 end if;
 select * into old from conquer_private.runs where user_id=uid and fingerprint=fp;
 if found then return jsonb_build_object('area',old.area_m2,'distance',old.distance_m,'reason',old.reason,'duplicate',true); end if;
 if (select count(*) from conquer_private.runs where user_id=uid and accepted_at>now()-interval '24 hours')>=30 then raise exception 'Limita pilotului este de 30 de activități pe zi.'; end if;

 for p in select value from jsonb_array_elements(points) loop
  if jsonb_typeof(p->'latitude') is distinct from 'number' or jsonb_typeof(p->'longitude') is distinct from 'number' or jsonb_typeof(p->'timestamp') is distinct from 'number' or jsonb_typeof(p->'accuracy') is distinct from 'number' then raise exception 'Punct GPS nevalid.'; end if;
  lat:=(p->>'latitude')::double precision; lon:=(p->>'longitude')::double precision;
  ts:=(p->>'timestamp')::double precision; acc:=(p->>'accuracy')::double precision;
  if lat not between -85 and 85 or lon not between -180 and 180 or acc<0 or ts<=0 then raise exception 'Coordonate GPS nevalide.'; end if;
  if first_ts is null then first_ts:=ts; end if;
  if ts>extract(epoch from now())*1000+300000 or ts<extract(epoch from now()-interval '7 days')*1000 then raise exception 'Activitatea trebuie sincronizată în maximum 7 zile, cu ora telefonului corectă.'; end if;
  if last_raw_ts is not null and ts<=last_raw_ts then blocked:=true; end if;
  last_raw_ts:=ts;
  if ts-first_ts>21600000 then raise exception 'Durata maximă în pilot este de 6 ore.'; end if;
  if acc>35 then continue; end if;
  point_geom:=gis.st_setsrid(gis.st_makepoint(lon,lat),4326);
  count_good:=count_good+1;
  if first_geom is null then first_geom:=point_geom; end if;
  if previous_geom is not null then
   step:=gis.st_distance(previous_geom::gis.geography,point_geom::gis.geography,false);
   dist:=dist+step;
   if ts<=prev_ts or ts-prev_ts>120000 or step/greatest((ts-prev_ts)/1000,0.001)>8 then blocked:=true; end if;
  end if;
  if previous_geom is null or not gis.st_equals(previous_geom,point_geom) then vertices:=array_append(vertices,point_geom); end if;
  previous_geom:=point_geom;prev_ts:=ts;
 end loop;
 if count_good<4 then reason:='Prea puține puncte GPS pentru o captură.';
 elsif blocked then reason:='Traseu salvat fără captură: întrerupere GPS sau viteză nevalidă.';
 elsif dist<200 then reason:='Pentru captură, parcurge cel puțin 200 m.';
 elsif gis.st_distance(first_geom::gis.geography,previous_geom::gis.geography,false)>40 then reason:='Traseu deschis. Revino la maximum 40 m de punctul de start.';
 elsif coalesce(array_length(vertices,1),0)<3 then reason:='Bucla nu delimitează o suprafață.';
 else
  line_geom:=gis.st_makeline(vertices);
  if not gis.st_isclosed(line_geom) then line_geom:=gis.st_addpoint(line_geom,gis.st_startpoint(line_geom)); end if;
  if gis.st_npoints(line_geom)<4 or not gis.st_issimple(line_geom) then reason:='Buclă intersectată. În pilot, folosește un singur contur simplu.';
  else
   poly:=gis.st_makepolygon(line_geom);
   if not gis.st_isvalid(poly) then reason:='Contur nevalid.';poly:=null;
   else
    m2:=gis.st_area(poly::gis.geography,false);
    if m2<500 then reason:='Suprafața minimă este 500 m².';m2:=0;poly:=null;
    elsif m2>10000000 then reason:='Suprafața depășește limita pilotului: 10 km².';m2:=0;poly:=null;
    end if;
   end if;
  end if;
 end if;
 if poly is not null then
  update conquer_private.territories set geom=gis.st_multi(gis.st_collectionextract(gis.st_difference(geom,poly),3))
   where group_id=gid and user_id<>uid and gis.st_intersects(geom,poly);
  delete from conquer_private.territories where group_id=gid and gis.st_isempty(geom);
  insert into conquer_private.territories(group_id,user_id,geom) values(gid,uid,gis.st_multi(poly))
   on conflict(group_id,user_id) do update set geom=gis.st_multi(gis.st_union(conquer_private.territories.geom,excluded.geom));
 end if;
 insert into conquer_private.runs(id,group_id,user_id,fingerprint,points,distance_m,area_m2,reason)
  values(run_id,gid,uid,fp,points,dist,m2,reason);
 update public.conquer_updates set revision=revision+1 where group_id=gid;
 return jsonb_build_object('area',m2,'distance',dist,'reason',reason,'duplicate',false);
end $$;

-- Fail closed: no default PUBLIC execution on security-definer entry points.
revoke all on function public.conquer_create_group(text,text) from public,anon;
revoke all on function public.conquer_join_group(text,text) from public,anon;
revoke all on function public.conquer_snapshot() from public,anon;
revoke all on function public.conquer_rotate_invite() from public,anon;
revoke all on function public.conquer_submit(uuid,jsonb) from public,anon;
grant execute on function public.conquer_create_group(text,text) to authenticated;
grant execute on function public.conquer_join_group(text,text) to authenticated;
grant execute on function public.conquer_snapshot() to authenticated;
grant execute on function public.conquer_rotate_invite() to authenticated;
grant execute on function public.conquer_submit(uuid,jsonb) to authenticated;
commit;

