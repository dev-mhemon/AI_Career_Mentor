// D001: legacy migrations are archival only. All schema changes use supabase/migrations.
throw new Error(
  'Legacy TypeORM migration runner disabled: use the reviewed Supabase chain',
);
export {};
