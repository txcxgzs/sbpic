import { pool } from './pool';

let ran = false;

const SCHEMA = `CREATE TABLE IF NOT EXISTS \`images\` (
  \`id\` BIGINT NOT NULL AUTO_INCREMENT,
  \`key\` VARCHAR(255) NOT NULL,
  \`hash\` CHAR(64) NOT NULL,
  \`original_name\` VARCHAR(255) NULL,
  \`size\` BIGINT NOT NULL,
  \`mime\` VARCHAR(100) NOT NULL,
  \`width\` INT NULL,
  \`height\` INT NULL,
  \`created_at\` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_key\` (\`key\`),
  UNIQUE KEY \`uk_hash\` (\`hash\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

export async function migrate(): Promise<void> {
  if (ran) return;
  ran = true;
  const conn = await pool.getConnection();
  try {
    await conn.query(SCHEMA);
    console.log('[db] 表结构已就绪');
  } finally {
    conn.release();
  }
}
