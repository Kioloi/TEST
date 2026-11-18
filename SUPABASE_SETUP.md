# Connect the teacher account and class content

Students can browse unit files and answer questions without signing in. The teacher signs in to upload materials and manage the question bank. Supabase row-level security enforces teacher-only changes; answer keys are stored separately and returned only after a student submits an answer.

## 1. Create a Supabase project

Create a project in your own Supabase account. In **Project Settings → API** (or **API Keys**), copy the project URL and the **anon/public** key. Never put a `service_role` or secret key in this website.

## 2. Create the tables and permissions

Open the project's **SQL Editor**, paste in [`schema.sql`](./schema.sql), and run it. The script creates the public question and unit-material lists, a public media bucket for class files, the protected answer key, the answer-check function, and teacher-only write policies. It also limits the database to one teacher profile.

The class files and media are intentionally public so students do not need accounts. Upload only material intended for students to see.

## 3. Add the project settings

Edit [`backend-config.js`](./backend-config.js):

```js
window.APP_CONFIG = {
  supabaseUrl: "https://your-project.supabase.co",
  supabaseAnonKey: "your-anon-public-key",
};
```

The anon/public key is expected to be visible in a browser. Database policies protect teacher-only changes and the answer key. Do not use a `service_role` key here.

## 4. Set up exactly one teacher account

1. In Supabase **Authentication → Settings**, turn off public sign-ups. Keep email/password sign-in enabled.
2. In **Authentication → Users**, create the teacher's one account. Students do not need accounts.
3. If email confirmation is enabled, confirm the teacher account.
4. In the SQL Editor, replace the example address and run:

   ```sql
   update public.profiles
   set role = 'teacher'
   where id = (select id from auth.users where email = 'teacher@example.com');
   ```

5. Add the URL where you run the website (for example `http://127.0.0.1:5500`) under **Authentication → URL Configuration → Redirect URLs**.
6. Run the website with a local web server, such as VS Code's Live Server extension. Do not open `index.html` directly.

The database permits only one profile with the `teacher` role. New or existing non-teacher profiles cannot manage files or questions.

## Using the site

- **Unit review:** the teacher uploads PPT, PPTX, or PDF files; students can open them without signing in.
- **Regents review:** the teacher adds an MCQ, optional image, choices A–D, the correct answer, and a text and/or video explanation. Students answer or skip. The explanation appears after they submit.
- **Challenge:** students practice a shuffled set, skip questions, and see a score at the end.

Question answer keys are not included in the public question list. The answer-check function returns the correct answer and explanation after a choice is submitted.

## Existing data

Previously saved unit notes or offline questions are not automatically imported into the shared class library. Re-add any materials you want to share after the teacher account is set up. Old question records from the earlier backend do not contain MCQ choices or answer keys, so rebuild those as new questions.
