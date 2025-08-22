import { int, sqliteTable, text, real } from 'drizzle-orm/sqlite-core';

// Users table based on the existing table definition
export const usersTable = sqliteTable('users', {
  id: int().primaryKey(),
  name: text(),
  password: text(),
  active: int(), // TINYINT maps to int in SQLite
  token: text(),
  lastSyncedAt: text(), // DATETIME as text in SQLite
});

// Datapoints table based on the existing table definition
export const datapointsTable = sqliteTable('datapoints', {
  id: int().primaryKey(),
  form: int().notNull(),
  user: int().notNull(),
  administrationId: int(),
  submitter: text(),
  name: text(),
  geo: text(),
  submitted: int(), // TINYINT maps to int in SQLite
  duration: real(),
  createdAt: text(), // DATETIME as text in SQLite
  submittedAt: text(), // DATETIME as text in SQLite
  syncedAt: text(), // DATETIME as text in SQLite
  json: text(),
  uuid: text(),
  repeats: text(),
  draftId: int(), // Added field for draftId
});

// Forms table based on the existing table definition
export const formsTable = sqliteTable('forms', {
  id: int().primaryKey(),
  parentId: int(), // INTEGER NULL
  userId: int(), // INTEGER NULL  
  formId: int().notNull(),
  version: text(), // VARCHAR(255)
  latest: int(), // TINYINT maps to int in SQLite
  name: text(), // VARCHAR(255)
  json: text(),
  createdAt: text(), // DATETIME as text in SQLite
});
