// SQLite CURRENT_TIMESTAMP values ('YYYY-MM-DD HH:MM:SS') are UTC without a
// timezone suffix: parse them as UTC so they display in local time.
const parseSqliteDate = (value) => new Date(`${value.replace(' ', 'T')}Z`);

export { parseSqliteDate };
