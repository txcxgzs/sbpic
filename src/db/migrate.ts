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
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_username\` (\`username\`),
  UNIQUE KEY \`uk_api_token\` (\`api_token\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

async function columnExists(table: string, column: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
    [config_db_name(), table, column],
  );
  return rows.length > 0;
}

function config_db_name(): string {
  // 避免与 config 模块循环依赖，从 process.env 兜底（migrate 运行时 env 已加载）
  return process.env.DB_NAME || 'sbimg';
}

async function indexExists(table: string, indexName: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
    [config_db_name(), table, indexName],
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

    // 幂等加列（老库升级）
    if (!(await columnExists('images', 'user_id'))) {
      await conn.query('ALTER TABLE `images` ADD COLUMN `user_id` BIGINT NULL');
    }
    if (!(await indexExists('images', 'idx_user'))) {
      await conn.query('ALTER TABLE `images` ADD INDEX `idx_user` (`user_id`)');
    }

    console.log('[db] 表结构已就绪');
  } finally {
    conn.release();
  }
}
