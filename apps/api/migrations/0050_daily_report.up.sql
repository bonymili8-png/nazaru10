-- The morning stable report goes out at most once per UTC day.
ALTER TABLE users ADD COLUMN last_report_on date;
