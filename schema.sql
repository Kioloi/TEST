create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  role text not null default 'unassigned',
  created_at timestamptz not null default now()
);

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'unassigned' where role = 'guest';
alter table public.profiles alter column role set default 'unassigned';
alter table public.profiles
  add constraint profiles_role_check check (role in ('teacher', 'unassigned'));

create unique index if not exists profiles_single_teacher_idx
  on public.profiles (role)
  where role = 'teacher';

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id),
  topic text not null default '',
  prompt text not null default '',
  image_path text,
  choice_a text not null default '',
  choice_b text not null default '',
  choice_c text not null default '',
  choice_d text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.questions add column if not exists topic text not null default '';
alter table public.questions add column if not exists prompt text not null default '';
alter table public.questions add column if not exists image_path text;
alter table public.questions add column if not exists choice_a text not null default '';
alter table public.questions add column if not exists choice_b text not null default '';
alter table public.questions add column if not exists choice_c text not null default '';
alter table public.questions add column if not exists choice_d text not null default '';

create index if not exists questions_created_at_idx on public.questions (created_at desc);

create table if not exists public.question_solutions (
  question_id uuid primary key references public.questions (id) on delete cascade,
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),
  explanation text not null default '',
  explanation_video_url text,
  explanation_video_path text,
  updated_at timestamptz not null default now(),
  check (explanation_video_url is null or explanation_video_url like 'https://%')
);

create table if not exists public.unit_resources (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id),
  title text not null,
  file_path text not null unique,
  file_name text not null,
  file_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists unit_resources_created_at_idx on public.unit_resources (created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_questions_updated_at on public.questions;
create trigger set_questions_updated_at
  before update on public.questions
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_question_solutions_updated_at on public.question_solutions;
create trigger set_question_solutions_updated_at
  before update on public.question_solutions
  for each row execute procedure public.set_updated_at();

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'teacher'
  );
$$;

revoke all on function public.is_teacher() from public, anon;
grant execute on function public.is_teacher() to authenticated;

create or replace function public.create_teacher_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    'unassigned'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_guest_profile_after_signup on auth.users;
drop trigger if exists create_teacher_profile_after_signup on auth.users;
create trigger create_teacher_profile_after_signup
  after insert on auth.users
  for each row execute procedure public.create_teacher_profile();

insert into public.profiles (id, display_name, role)
select id, coalesce(raw_user_meta_data ->> 'display_name', ''), 'unassigned'
from auth.users
on conflict (id) do nothing;

alter table public.profiles enable row level security;
alter table public.questions enable row level security;
alter table public.question_solutions enable row level security;
alter table public.unit_resources enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
revoke all on public.questions from anon, authenticated;
grant select on public.questions to anon, authenticated;
grant insert, update, delete on public.questions to authenticated;
revoke all on public.question_solutions from anon, authenticated;
grant select, insert, update, delete on public.question_solutions to authenticated;
revoke all on public.unit_resources from anon, authenticated;
grant select on public.unit_resources to anon, authenticated;
grant insert, update, delete on public.unit_resources to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "Signed-in class members can review questions" on public.questions;
create policy "Everyone can review questions"
  on public.questions for select to anon, authenticated
  using (true);

drop policy if exists "Teachers can add questions" on public.questions;
create policy "Teachers can add questions"
  on public.questions for insert to authenticated
  with check (public.is_teacher() and created_by = (select auth.uid()));

drop policy if exists "Teachers can edit questions" on public.questions;
create policy "Teachers can edit questions"
  on public.questions for update to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "Teachers can remove questions" on public.questions;
create policy "Teachers can remove questions"
  on public.questions for delete to authenticated
  using (public.is_teacher());

drop policy if exists "Teachers can read question solutions" on public.question_solutions;
create policy "Teachers can read question solutions"
  on public.question_solutions for select to authenticated
  using (public.is_teacher());

drop policy if exists "Teachers can add question solutions" on public.question_solutions;
create policy "Teachers can add question solutions"
  on public.question_solutions for insert to authenticated
  with check (public.is_teacher());

drop policy if exists "Teachers can edit question solutions" on public.question_solutions;
create policy "Teachers can edit question solutions"
  on public.question_solutions for update to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "Teachers can remove question solutions" on public.question_solutions;
create policy "Teachers can remove question solutions"
  on public.question_solutions for delete to authenticated
  using (public.is_teacher());

drop policy if exists "Everyone can read unit resources" on public.unit_resources;
create policy "Everyone can read unit resources"
  on public.unit_resources for select to anon, authenticated
  using (true);

drop policy if exists "Teachers can add unit resources" on public.unit_resources;
create policy "Teachers can add unit resources"
  on public.unit_resources for insert to authenticated
  with check (public.is_teacher() and created_by = (select auth.uid()));

drop policy if exists "Teachers can remove unit resources" on public.unit_resources;
create policy "Teachers can remove unit resources"
  on public.unit_resources for delete to authenticated
  using (public.is_teacher());

create or replace function public.save_mcq_question(
  p_question_id uuid,
  p_topic text,
  p_prompt text,
  p_image_path text,
  p_choice_a text,
  p_choice_b text,
  p_choice_c text,
  p_choice_d text,
  p_correct_option text,
  p_explanation text,
  p_explanation_video_url text,
  p_explanation_video_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_id uuid := coalesce(p_question_id, gen_random_uuid());
begin
  if not public.is_teacher() then
    raise exception 'Teacher access is required to manage questions.';
  end if;
  if coalesce(trim(p_prompt), '') = ''
    or coalesce(trim(p_choice_a), '') = ''
    or coalesce(trim(p_choice_b), '') = ''
    or coalesce(trim(p_choice_c), '') = ''
    or coalesce(trim(p_choice_d), '') = '' then
    raise exception 'Enter the question and all four answer choices.';
  end if;
  if coalesce(p_correct_option, '') not in ('A', 'B', 'C', 'D') then
    raise exception 'Choose the correct answer.';
  end if;
  if coalesce(trim(p_explanation), '') = ''
    and coalesce(trim(p_explanation_video_url), '') = ''
    and p_explanation_video_path is null then
    raise exception 'Add a text or video explanation.';
  end if;
  if coalesce(trim(p_explanation_video_url), '') <> ''
    and p_explanation_video_url not like 'https://%' then
    raise exception 'Video links must use HTTPS.';
  end if;

  if exists (select 1 from public.questions where id = saved_id) then
    update public.questions
    set topic = coalesce(p_topic, ''),
        prompt = p_prompt,
        image_path = p_image_path,
        choice_a = p_choice_a,
        choice_b = p_choice_b,
        choice_c = p_choice_c,
        choice_d = p_choice_d
    where id = saved_id;
  else
    insert into public.questions (
      id, created_by, topic, prompt, image_path, choice_a, choice_b, choice_c, choice_d
    )
    values (
      saved_id, (select auth.uid()), coalesce(p_topic, ''), p_prompt, p_image_path,
      p_choice_a, p_choice_b, p_choice_c, p_choice_d
    );
  end if;

  insert into public.question_solutions (
    question_id, correct_option, explanation, explanation_video_url, explanation_video_path
  )
  values (
    saved_id, p_correct_option, coalesce(p_explanation, ''),
    nullif(trim(p_explanation_video_url), ''), p_explanation_video_path
  )
  on conflict (question_id) do update
  set correct_option = excluded.correct_option,
      explanation = excluded.explanation,
      explanation_video_url = excluded.explanation_video_url,
      explanation_video_path = excluded.explanation_video_path;

  return saved_id;
end;
$$;

create or replace function public.check_mcq_answer(p_question_id uuid, p_choice text)
returns table (
  is_correct boolean,
  correct_option text,
  explanation text,
  explanation_video_url text,
  explanation_video_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_option text := upper(trim(coalesce(p_choice, '')));
begin
  if selected_option not in ('A', 'B', 'C', 'D') then
    raise exception 'Choose A, B, C, or D.';
  end if;
  if not exists (
    select 1
    from public.questions as question
    join public.question_solutions as solution on solution.question_id = question.id
    where question.id = p_question_id
  ) then
    raise exception 'This question or its answer explanation is unavailable.';
  end if;

  return query
  select solution.correct_option = selected_option,
         solution.correct_option,
         solution.explanation,
         solution.explanation_video_url,
         solution.explanation_video_path
  from public.questions as question
  join public.question_solutions as solution on solution.question_id = question.id
  where question.id = p_question_id;
end;
$$;

revoke all on function public.save_mcq_question(uuid, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.save_mcq_question(uuid, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
revoke all on function public.check_mcq_answer(uuid, text) from public;
grant execute on function public.check_mcq_answer(uuid, text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('class-media', 'class-media', true, 104857600)
on conflict (id) do update
set public = true, file_size_limit = 104857600;

drop policy if exists "Class members can view question media" on storage.objects;
drop policy if exists "Teachers can upload question media" on storage.objects;
drop policy if exists "Teachers can update question media" on storage.objects;
drop policy if exists "Teachers can delete question media" on storage.objects;
drop policy if exists "Teachers can upload class media" on storage.objects;
drop policy if exists "Teachers can update class media" on storage.objects;
drop policy if exists "Teachers can delete class media" on storage.objects;

create policy "Teachers can upload class media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'class-media' and public.is_teacher());

create policy "Teachers can update class media"
  on storage.objects for update to authenticated
  using (bucket_id = 'class-media' and public.is_teacher())
  with check (bucket_id = 'class-media' and public.is_teacher());

create policy "Teachers can delete class media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'class-media' and public.is_teacher());
