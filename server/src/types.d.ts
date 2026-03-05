declare module 'better-sqlite3-session-store' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  import session from 'express-session';
  function SqliteStore(session: any): any;
  export = SqliteStore;
}
