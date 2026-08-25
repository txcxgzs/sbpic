declare module 'express-mysql-session' {
  import express from 'express';
  import session from 'express-session';

  interface MySQLStoreOptions {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    clearExpired?: boolean;
    checkExpirationInterval?: number;
    expiration?: number;
    createDatabaseTable?: boolean;
    schema?: {
      tableName?: string;
      columnNames?: Record<string, string>;
    };
  }

  class MySQLStore extends session.Store {
    constructor(options?: MySQLStoreOptions);
    close(cb?: () => void): void;
  }

  // 该模块默认导出的是一个工厂函数：MySQLStore(session) => MySQLStoreClass
  function MySQLStoreFactory(expressSession: typeof session): typeof MySQLStore;
  export = MySQLStoreFactory;
}
