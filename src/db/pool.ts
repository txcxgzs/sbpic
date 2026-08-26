import mysql from 'mysql2/promise';
import { config } from '../config';

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
});

export interface ImageRow {
  id: number;
  key: string;
  hash: string;
  original_name: string | null;
  size: number;
  mime: string;
  width: number | null;
  height: number | null;
  user_id: number | null;
  created_at: Date;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: 'admin' | 'user';
  api_token: string;
  email: string | null;
  email_verified: number;
  created_at: Date;
}

export interface SettingRow {
  key: string;
  value: string | null;
  updated_at: Date;
}
