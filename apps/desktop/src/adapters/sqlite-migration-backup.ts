import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { backup, DatabaseSync } from 'node:sqlite';

export async function backupBeforeSqliteMigration(database: DatabaseSync, databasePath: string, targetVersion: number): Promise<string | undefined> {
  const row = database.prepare('PRAGMA user_version').get() as { readonly user_version?: unknown } | undefined;
  const sourceVersion = row?.user_version;
  if (!Number.isSafeInteger(sourceVersion) || (sourceVersion as number) < 0 || (sourceVersion as number) >= targetVersion) return undefined;
  if (sourceVersion === 0 && !(database.prepare("SELECT 1 AS present FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' LIMIT 1").get())) return undefined;

  const backupPath = `${databasePath}.migration-backup.sqlite`;
  const stagingPath = `${backupPath}.${randomUUID()}.tmp`;
  try {
    await backup(database, stagingPath);
    await promoteVerifiedMigrationBackup(stagingPath, backupPath, sourceVersion as number);
    return backupPath;
  } finally { await rm(stagingPath, { force: true }); }
}

export async function promoteVerifiedMigrationBackup(stagingPath: string, backupPath: string, sourceVersion: number): Promise<void> {
  const snapshot = new DatabaseSync(stagingPath, { readOnly: true, timeout: 5_000, defensive: true });
  try {
    const version = snapshot.prepare('PRAGMA user_version').get() as { readonly user_version?: unknown } | undefined;
    const integrity = snapshot.prepare('PRAGMA quick_check').get() as { readonly quick_check?: unknown } | undefined;
    if (version?.user_version !== sourceVersion || integrity?.quick_check !== 'ok') throw new Error('SQLite migration backup verification failed');
  } finally { snapshot.close(); }
  await rename(stagingPath, backupPath);
}
