import { RowDataPacket } from 'mysql2';
import { pool } from './pool';

let ran = false;

const IMAGES_TABLE = `CREATE TABLE IF NOT EXISTS \`images\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`key\` VARCHAR(255) NOT NULL,
  \`hash\` CHAR(64) NOT NULL,
  \`original_name\` VARCHAR(255) NULL,
  \`size\` BIGINT NOT NULL,
  \`mime\` VARCHAR(100) NOT NULL,
  \`width\` INT NULL,
  \`height\` INT NULL,
  \`user_id\` BIGINT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_key\` (\`key\`),
  UNIQUE KEY \`uk_hash\` (\`hash\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

const USERS_TABLE = `CREATE TABLE IF NOT EXISTS \`users\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`username\` VARCHAR(32) NOT NULL,
  \`password_hash\` VARCHAR(255) NOT NULL,
  \`role\` ENUM('admin','user') NOT NULL DEFAULT 'user',
  \`api_token\` VARCHAR(64) NOT NULL,
  \`email\` VARCHAR(255) NULL,
  \`email_verified\` TINYINT(1) NOT NULL DEFAULT 0,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_username\` (\`username\`),
  UNIQUE KEY \`uk_api_token\` (\`api_token\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

const EMAIL_VERIF_TABLE = `CREATE TABLE IF NOT EXISTS \`email_verifications\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`user_id\` BIGINT NOT NULL,
  \`token\` CHAR(64) NOT NULL,
  \`email\` VARCHAR(255) NOT NULL,
  \`expires_at\` TIMESTAMP NOT NULL,
  \`consumed\` TINYINT(1) NOT NULL DEFAULT 0,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_token\` (\`token\`),
  KEY \`idx_user\` (\`user_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

function dbName(): string {
  return process.env.DB_NAME || 'sbimg';
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [dbName(), table, column],
  );
  return rows.length > 0;
}

async function indexExists(table: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [dbName(), table, indexName],
  );
  return rows.length > 0;
}

export async function migrate(): Promise<void> {
  if (ran) return;
  ran = true;
  const conn = await pool.getConnection();
  try {
    await conn.query(IMAGES_TABLE);
    await conn.query(USERS_TABLE);
    await conn.query(EMAIL_VERIF_TABLE);

    // 幂等加列（老库升级）
    if (!(await columnExists('images', 'user_id'))) {
      await conn.query('ALTER TABLE `images` ADD COLUMN `user_id` BIGINT NULL');
    }
    if (!(await indexExists('images', 'idx_user'))) {
      await conn.query('ALTER TABLE `images` ADD INDEX `idx_user` (`user_id`)');
    }
    if (!(await columnExists('users', 'email'))) {
      await conn.query('ALTER TABLE `users` ADD COLUMN `email` VARCHAR(255) NULL');
    }
    if (!(await columnExists('users', 'email_verified'))) {
      await conn.query('ALTER TABLE `users` ADD COLUMN `email_verified` TINYINT(1) NOT NULL DEFAULT 0');
    }

    // 清理过期未消费的验证记录
    await conn.query(
      'DELETE FROM `email_verifications` WHERE `consumed` = 0 AND `expires_at` < NOW()',
    );

    console.log('[db] 表结构已就绪');
  } finally {
    conn.release();
  }
}
